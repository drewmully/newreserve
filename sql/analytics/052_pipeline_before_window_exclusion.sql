-- Owner-reviewed additive RPC after017. No registration, data rewrite or view change.
-- Queue done means terminal, NOT successful materialization. Only this explicit
-- before-window reason is new; after-window/catalog/mapping failures are unchanged.
begin;
create function public.lean_pipeline_exclude_before_window(p_work_id bigint,p_token uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare w lean_private.work; s lean_private.pipeline_snapshots; r lean_private.receipts;
  created timestamptz; revised timestamptz; event_time timestamptz;
  gid text; expected text; refund_id text; refund jsonb; k text; t text; occupied boolean;
  clock_pattern constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$';
begin
  -- Same scope-before-work order as claim/finish; current enabled gate, frozen window.
  perform 1 from lean_private.pipeline_scope c join lean_private.pipeline_snapshots x on x.shop=c.shop
    where x.work_id=p_work_id and c.enabled for update of c;
  if not found then return false; end if;
  select * into w from lean_private.work where work_id=p_work_id for update;
  if not found or p_token is null or w.state<>'leased' or w.lease_token is distinct from p_token::text
    or w.lease_until is null or w.lease_until<=clock_timestamp() then return false; end if;
  select * into strict s from lean_private.pipeline_snapshots where work_id=p_work_id;
  select * into strict r from lean_private.receipts where receipt_id=w.receipt_id;
  if jsonb_typeof(s.source) is distinct from 'object' or
    jsonb_typeof(s.source->'commerce') is distinct from 'object' or
    jsonb_typeof(s.source#>'{commerce,order}') is distinct from 'object' or
    jsonb_typeof(s.source->'financial') is distinct from 'object' or
    jsonb_typeof(s.source->'refunds') is distinct from 'array' or
    s.source#>>'{commerce,shop}' is distinct from s.shop or
    s.source#>>'{commerce,apiVersion}' is distinct from '2026-07' or
    not isfinite(s.from_time) or not isfinite(s.until_time) or s.from_time>=s.until_time
    then raise exception 'invalid exclusion source scope'; end if;
  if s.source#>'{commerce,projection}' is distinct from s.policy->'sourceProjection' or
    (s.policy ? 'sourceProjection' and s.policy->'sourceProjection' not in
      ('"financial_no_geo"'::jsonb,'"financial_no_geo_order_size"'::jsonb))
    then raise exception 'exclusion projection mismatch'; end if;
  gid:=s.source#>>'{commerce,order,id}';
  if gid is null or gid !~ '^gid://shopify/Order/[1-9][0-9]*$' or gid is distinct from s.order_gid or
    s.source#>>'{financial,id}' is distinct from gid or
    s.source#>'{financial,updatedAt}' is distinct from s.source#>'{commerce,order,updatedAt}'
    then raise exception 'exclusion source identity mismatch'; end if;
  foreach k in array array['createdAt','updatedAt'] loop
    if jsonb_typeof(s.source#>array['commerce','order',k]) is distinct from 'string' or
      (s.source#>>array['commerce','order',k]) !~ clock_pattern
      then raise exception 'invalid exclusion clock'; end if;
  end loop;
  created:=(s.source#>>'{commerce,order,createdAt}')::timestamptz;
  revised:=(s.source#>>'{commerce,order,updatedAt}')::timestamptz;
  if not isfinite(created) or not isfinite(revised) or revised<created or
    revised is distinct from s.revision then raise exception 'invalid exclusion revision'; end if;
  if created>=s.from_time then raise exception 'order not before snapshot window'; end if;
  if r.source<>'shopify' or r.topic not in ('orders/paid','orders/updated','orders/cancelled','refunds/create') or
    jsonb_typeof(r.payload) is distinct from 'object' or
    lean_private.receipt_shop(r.business_key) is distinct from s.shop or
    r.business_key::jsonb is distinct from jsonb_build_array(s.shop,coalesce(r.payload->>'admin_graphql_api_id',r.payload->>'id'))
    then raise exception 'invalid exclusion receipt'; end if;
  expected:=case when r.topic='refunds/create' then r.payload->>'order_id'
    else coalesce(r.payload->>'admin_graphql_api_id',r.payload->>'id') end;
  if expected ~ '^[1-9][0-9]*$' then expected:='gid://shopify/Order/'||expected; end if;
  if expected is distinct from gid then raise exception 'exclusion receipt order mismatch'; end if;
  foreach k in array array['created_at','updated_at'] loop
    if r.payload ? k then
      if jsonb_typeof(r.payload->k) is distinct from 'string' or (r.payload->>k) !~ clock_pattern
        then raise exception 'invalid exclusion receipt clock'; end if;
      event_time:=(r.payload->>k)::timestamptz;
      if not isfinite(event_time) then raise exception 'invalid exclusion receipt clock'; end if;
    end if;
  end loop;
  if r.topic='refunds/create' then
    refund_id:=coalesce(r.payload->>'admin_graphql_api_id',r.payload->>'id');
    if refund_id ~ '^[1-9][0-9]*$' then refund_id:='gid://shopify/Refund/'||refund_id; end if;
    if refund_id is null or refund_id !~ '^gid://shopify/Refund/[1-9][0-9]*$' or
      (select count(*) from jsonb_array_elements(s.source->'refunds') x where x->>'id'=refund_id)<>1
      then raise exception 'exclusion refund not visible'; end if;
    select x into refund from jsonb_array_elements(s.source->'refunds') x where x->>'id'=refund_id;
    if refund#>>'{order,id}' is distinct from gid or jsonb_typeof(refund->'updatedAt') is distinct from 'string' or
      (refund->>'updatedAt') !~ clock_pattern then raise exception 'invalid exclusion refund'; end if;
    event_time:=(refund->>'updatedAt')::timestamptz;
    if not isfinite(event_time) or
      (coalesce(r.payload->>'updated_at',r.payload->>'created_at') is not null and
        event_time<coalesce(r.payload->>'updated_at',r.payload->>'created_at')::timestamptz)
      then raise exception 'exclusion refund behind event'; end if;
  elsif r.payload ? 'updated_at' and revised<(r.payload->>'updated_at')::timestamptz then
    raise exception 'exclusion source behind event';
  end if;
  -- No side effects to an existing materialization.046 sidecars require order_items,
  -- so the base fact check also fences those without introducing a046 dependency.
  perform 1 from lean_private.publications where publication_id=s.publication_id and state='candidate' for share;
  if not found then raise exception 'exclusion requires candidate'; end if;
  foreach t in array array['customers','identity_map','orders','order_items','sales_ledger','payments',
    'sessions','marketing_spend_daily','order_attribution','order_item_offers','coverage','certifications',
    'selected_publications','report_store_daily','report_product_daily','report_acquisition_daily',
    'report_customer_cohorts','report_funnel_daily'] loop
    execute format('select exists(select 1 from lean_private.%I where publication_id=$1)',t)
      into occupied using s.publication_id;
    if occupied then raise exception 'exclusion publication already materialized'; end if;
  end loop;
  if exists(select 1 from lean_private.pipeline_heads h join lean_private.pipeline_snapshots x using(work_id)
      where x.publication_id=s.publication_id) or
    exists(select 1 from lean_private.projections where receipt_id=w.receipt_id)
    then raise exception 'exclusion already projected'; end if;
  -- Recheck after validation: an expired lease must never be completed.
  update lean_private.work set state='done',last_error_code='excluded_before_window',
    completed_at=clock_timestamp(),lease_token=null,lease_until=null
    where work_id=p_work_id and state='leased' and lease_token=p_token::text and lease_until>clock_timestamp();
  return found;
end $$;
revoke all on function public.lean_pipeline_exclude_before_window(bigint,uuid) from public,anon,authenticated,service_role;
do $acl$ begin
  -- Match050's known default-grantee handling on this NEW object only.
  if exists(select 1 from pg_roles where rolname='lean_posthog_reader') then
    revoke all on function public.lean_pipeline_exclude_before_window(bigint,uuid) from lean_posthog_reader;
  end if;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.oid='public.lean_pipeline_exclude_before_window(bigint,uuid)'::regprocedure and a.grantee<>p.proowner)
    then raise exception 'unexpected exclusion function grantee'; end if;
end $acl$;
grant execute on function public.lean_pipeline_exclude_before_window(bigint,uuid) to service_role;

-- Preserve existing health fields and ACL. done is total terminal queue work,
-- including exclusions; neither done nor done-excluded proves financial reports.
create or replace function public.lean_pipeline_health(p_project_ref text,p_shop text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb; enabled boolean;
begin
  select c.enabled into enabled from lean_private.pipeline_scope c where shop=p_shop and project_ref=p_project_ref;
  if not found then raise exception 'unapproved target'; end if;
  select jsonb_build_object('enabled',enabled,'pending',count(*) filter(where w.state='pending'),
    'leased',count(*) filter(where w.state='leased'),'dead',count(*) filter(where w.state='dead'),
    'done',count(*) filter(where w.state='done'),
    'excluded',count(*) filter(where w.state='done' and w.last_error_code='excluded_before_window'),
    'oldestPendingSeconds',coalesce(extract(epoch from clock_timestamp()-min(r.received_at)
      filter(where w.state in ('pending','leased'))),0),
    'expiredLeases',count(*) filter(where w.state='leased' and w.lease_until<=clock_timestamp()))
    into result from lean_private.work w join lean_private.receipts r using(receipt_id)
      where lean_private.receipt_shop(r.business_key)=p_shop;
  return result;
end $$;
commit;
