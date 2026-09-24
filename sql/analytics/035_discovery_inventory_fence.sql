-- Forward-only after 034. No registration, activation, source read or release.
-- Defense in depth: even a caller bypassing the TypeScript consumer cannot
-- commit a publication with sources differing from its pinned inventory.
begin;
create function lean_private.report_inventory_fence() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare inventory jsonb := new.policy->'sourceInventory'; item jsonb;
begin
  if new.completed_at is null or not(new.policy ? 'sourceInventory') then return new; end if;
  if jsonb_typeof(inventory) is distinct from 'object' or
    inventory->'version' is distinct from '1'::jsonb or
    inventory->>'projectRef' is distinct from new.project_ref or
    inventory->>'shop' is distinct from new.shop or
    coalesce(inventory->>'digest','') !~ '^[a-f0-9]{64}$' or
    jsonb_typeof(inventory->'orders') is distinct from 'array' or
    jsonb_array_length(inventory->'orders')>100 then raise exception 'invalid source inventory'; end if;
  for item in select value from jsonb_array_elements(inventory->'orders') loop
    if coalesce(item->>'id','') !~ '^gid://shopify/Order/[1-9][0-9]*$' or
      item->>'createdAt' is null or item->>'updatedAt' is null or
      not isfinite((item->>'createdAt')::timestamptz) or not isfinite((item->>'updatedAt')::timestamptz) or
      (item->>'updatedAt')::timestamptz < (item->>'createdAt')::timestamptz
      then raise exception 'invalid source inventory order'; end if;
  end loop;
  if (select count(distinct value->>'id') from jsonb_array_elements(inventory->'orders'))
    <>jsonb_array_length(inventory->'orders') then raise exception 'duplicate source inventory order'; end if;
  if exists(select 1 from unnest(new.history_runs) id
    left join lean_private.history_jobs h on h.run_id=id
    where h.run_id is null or not h.enabled or not h.complete or
      h.project_ref<>new.project_ref or h.shop<>new.shop)
    then raise exception 'incomplete inventory dependencies'; end if;
  if exists (
    with expected as (
      select value->>'id' id,(value->>'createdAt')::timestamptz created,
        (value->>'updatedAt')::timestamptz updated,new.shop shop
      from jsonb_array_elements(inventory->'orders')
    ), actual as (
      select x#>>'{source,commerce,order,id}' id,
        (x#>>'{source,commerce,order,createdAt}')::timestamptz created,
        (x#>>'{source,commerce,order,updatedAt}')::timestamptz updated,
        x#>>'{source,commerce,shop}' shop
      from lean_private.history_pages p cross join lateral jsonb_array_elements(p.rows) x
      where p.run_id=any(new.history_runs)
    )
    (select * from expected except select * from actual)
    union all (select * from actual except select * from expected)
  ) then raise exception 'source inventory mismatch'; end if;
  return new;
end $$;
create trigger report_inventory_fence before insert or update of completed_at on lean_private.report_builds
  for each row execute function lean_private.report_inventory_fence();
revoke all on function lean_private.report_inventory_fence()
  from public,anon,authenticated,service_role,lean_posthog_reader;
commit;
