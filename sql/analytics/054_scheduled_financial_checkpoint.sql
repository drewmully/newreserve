-- Default empty. No job, activation, schedule, token, or source call is installed.
-- Requires 018/027. Owner registers one exact closed-day financial checkpoint.
begin;
-- Preserve the reviewed 027 implementation behind an owner-only helper.
-- The public legacy entry point must not bypass a checkpoint binding.
do $$
begin
  if md5(pg_get_functiondef('public.lean_history_commit(text,text,text,integer,text,text,boolean,jsonb)'::regprocedure))
       is distinct from 'de4e013720255cf6b503e81277128d9f' then
    raise exception 'financial checkpoint requires reviewed 027 commit'; end if;
  if (select proowner from pg_proc where
      oid='public.lean_history_commit(text,text,text,integer,text,text,boolean,jsonb)'::regprocedure)
      is distinct from current_user::regrole::oid then
    raise exception 'financial checkpoint requires original commit owner'; end if;
end $$;
create table lean_private.financial_checkpoints (
  run_id text primary key references lean_private.history_jobs,
  project_ref text not null check(project_ref='xnfjdbpjuaezxjgargto'),
  shop text not null check(shop='mullybox-store.myshopify.com'),
  inventory jsonb not null check(jsonb_typeof(inventory)='array' and jsonb_array_length(inventory) between 1 and 5),
  inventory_ref text not null check(length(trim(inventory_ref))>0),
  approval_ref text not null check(length(trim(approval_ref))>0),
  actor_ref text not null check(length(trim(actor_ref))>0),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  enabled boolean not null default false,
  lease_token uuid, attempted_at timestamptz, completed_at timestamptz,
  check(isfinite(created_at) and isfinite(expires_at) and expires_at>created_at
    and expires_at<=created_at+interval '24 hours'),
  check((lease_token is null)=(attempted_at is null)),
  check(completed_at is null or attempted_at is not null)
);
create unique index one_enabled_financial_checkpoint on lean_private.financial_checkpoints(enabled) where enabled;
alter table lean_private.financial_checkpoints enable row level security;
revoke all on lean_private.financial_checkpoints from public,anon,authenticated,service_role,lean_posthog_reader;
create function lean_private.financial_checkpoint_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if (to_jsonb(old)-array['enabled','lease_token','attempted_at','completed_at']) is distinct from
     (to_jsonb(new)-array['enabled','lease_token','attempted_at','completed_at']) or
     old.attempted_at is not null and
       (old.lease_token,old.attempted_at) is distinct from (new.lease_token,new.attempted_at) or
     old.completed_at is not null and old.completed_at is distinct from new.completed_at then
    raise exception 'financial checkpoint immutable; register a new run';
  end if;
  return new;
end $$;
create trigger immutable_financial_checkpoint before update on lean_private.financial_checkpoints
  for each row execute function lean_private.financial_checkpoint_immutable();

do $$
declare original text;
begin
  original:=pg_get_functiondef('public.lean_history_commit(text,text,text,integer,text,text,boolean,jsonb)'::regprocedure);
  -- The exact definition was pinned above. Copy the reviewed body without
  -- changing its SQL, then preserve the public function's OID with OR REPLACE.
  execute replace(original,'CREATE OR REPLACE FUNCTION public.lean_history_commit(',
    'CREATE FUNCTION lean_private.history_commit_checkpoint_027(');
end $$;
revoke all on function lean_private.history_commit_checkpoint_027(text,text,text,integer,text,text,boolean,jsonb)
  from public,anon,authenticated,service_role,lean_posthog_reader;
create or replace function public.lean_history_commit(p_run text,p_project_ref text,p_shop text,p_expected_page integer,
  p_expected_cursor text,p_next_cursor text,p_complete boolean,p_rows jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'history commit requires read committed'; end if;
  -- Serialize with history registration/commit and inspect the binding in a
  -- fresh RC statement. Every bound run is denied, even disabled or expired.
  perform 1 from lean_private.history_jobs where run_id=p_run for update;
  if not found then raise exception 'unapproved history target'; end if;
  if exists(select 1 from lean_private.financial_checkpoints where run_id=p_run) then
    raise exception 'bound history requires financial checkpoint commit'; end if;
  return lean_private.history_commit_checkpoint_027(p_run,p_project_ref,p_shop,p_expected_page,
    p_expected_cursor,p_next_cursor,p_complete,p_rows);
end $$;
revoke all on function public.lean_history_commit(text,text,text,integer,text,text,boolean,jsonb)
  from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_history_commit(text,text,text,integer,text,text,boolean,jsonb) to service_role;

create function public.lean_financial_checkpoint_claim(p_project_ref text,p_shop text,p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c lean_private.financial_checkpoints; h lean_private.history_jobs;
  item jsonb; created timestamptz; updated timestamptz; previous timestamptz; ids text[]:='{}';
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'financial checkpoint requires read committed'; end if;
  if p_project_ref is distinct from 'xnfjdbpjuaezxjgargto' or
     p_shop is distinct from 'mullybox-store.myshopify.com' or p_token is null then
    raise exception 'financial checkpoint target';
  end if;
  select * into c from lean_private.financial_checkpoints where enabled for update;
  if not found then return jsonb_build_object('state','disabled'); end if;
  if c.project_ref<>p_project_ref or c.shop<>p_shop then raise exception 'financial checkpoint target'; end if;
  if c.completed_at is not null then return jsonb_build_object('state','complete'); end if;
  -- Never reclaim an attempted or ambiguous invocation, including after expiry.
  if c.attempted_at is not null then return jsonb_build_object('state','held'); end if;
  if c.expires_at<=clock_timestamp()+interval '70 seconds' then return jsonb_build_object('state','expired'); end if;
  select * into strict h from lean_private.history_jobs where run_id=c.run_id for update;
  if not h.enabled or h.complete or h.page_count<>0 or h.row_count<>0 or h.cursor is not null or
     h.project_ref<>c.project_ref or h.shop<>c.shop or h.scan_basis<>'created_at' or
     h.approval_ref<>c.approval_ref or h.actor_ref<>c.actor_ref or
     h.max_pages<>1 or h.page_size<jsonb_array_length(c.inventory) or
     h.until_time>clock_timestamp() or h.from_time<clock_timestamp()-interval '60 days' or
     h.from_time is distinct from date_trunc('day',h.from_time at time zone 'America/New_York') at time zone 'America/New_York' or
     h.until_time is distinct from
       ((h.from_time at time zone 'America/New_York')+interval '1 day') at time zone 'America/New_York'
    then raise exception 'financial checkpoint history bounds'; end if;
  for item in select value from jsonb_array_elements(c.inventory) loop
    created:=(item->>'createdAt')::timestamptz; updated:=(item->>'updatedAt')::timestamptz;
    if item->>'id' is null or item->>'id' !~ '^gid://shopify/Order/[1-9][0-9]*$' or
       item->>'id'=any(ids) or created is null or updated is null or not isfinite(created) or not isfinite(updated) or
       created<h.from_time or created>=h.until_time or created<previous or updated<created or updated>clock_timestamp() or
       (select count(*) from jsonb_object_keys(item))<>3 then raise exception 'financial checkpoint inventory'; end if;
    ids:=array_append(ids,item->>'id'); previous:=created;
  end loop;
  update lean_private.financial_checkpoints set lease_token=p_token,attempted_at=clock_timestamp() where run_id=c.run_id;
  return jsonb_build_object('state','claimed','runId',c.run_id,'inventory',c.inventory,
    'fromTime',h.from_time,'untilTime',h.until_time,'pageSize',h.page_size);
end $$;

create function public.lean_financial_checkpoint_commit(p_run text,p_project_ref text,p_shop text,
  p_token uuid,p_rows jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare c lean_private.financial_checkpoints; item jsonb; expected jsonb; n integer:=0; ok boolean;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'financial checkpoint requires read committed'; end if;
  select * into c from lean_private.financial_checkpoints where run_id=p_run for update;
  if not found or not c.enabled or c.completed_at is not null or c.lease_token is distinct from p_token or
     p_token is null or c.attempted_at is null or c.expires_at<=clock_timestamp() or
     c.project_ref is distinct from p_project_ref or c.shop is distinct from p_shop then return false; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<>jsonb_array_length(c.inventory) or
     octet_length(p_rows::text)>8000000 or
     p_rows::text ~ '"(customer|email|phone|cartToken|shippingAddress|customAttributes|orderSize)"[[:space:]]*:'
    then raise exception 'financial checkpoint source bounds'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    expected:=c.inventory->n; n:=n+1;
    if item#>>'{source,commerce,projection}' is distinct from 'financial_no_geo' or
       item#>>'{source,commerce,shop}' is distinct from c.shop or
       item#>>'{source,commerce,apiVersion}' is distinct from '2026-07' or
       item#>>'{source,commerce,order,id}' is distinct from expected->>'id' or
       (item#>>'{source,commerce,order,createdAt}')::timestamptz is distinct from (expected->>'createdAt')::timestamptz or
       (item#>>'{source,commerce,order,updatedAt}')::timestamptz is distinct from (expected->>'updatedAt')::timestamptz or
       item#>>'{source,financial,id}' is distinct from expected->>'id' or
       (item#>>'{source,financial,updatedAt}')::timestamptz is distinct from (expected->>'updatedAt')::timestamptz
      then raise exception 'financial checkpoint source mismatch'; end if;
  end loop;
  ok:=lean_private.history_commit_checkpoint_027(p_run,p_project_ref,p_shop,0,null,null,true,p_rows);
  if not ok then return false; end if;
  if c.expires_at<=clock_timestamp() then raise exception 'financial checkpoint expired during commit'; end if;
  update lean_private.financial_checkpoints set completed_at=clock_timestamp() where run_id=p_run;
  return true;
end $$;
revoke all on function public.lean_financial_checkpoint_claim(text,text,uuid),
  public.lean_financial_checkpoint_commit(text,text,text,uuid,jsonb) from public,anon,authenticated,service_role,lean_posthog_reader;
revoke all on function lean_private.financial_checkpoint_immutable() from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_financial_checkpoint_claim(text,text,uuid),
  public.lean_financial_checkpoint_commit(text,text,text,uuid,jsonb) to service_role;
do $$
declare r text; f regprocedure;
begin
  foreach r in array array['anon','authenticated','service_role','lean_posthog_reader'] loop
    if has_function_privilege(r,
      'lean_private.history_commit_checkpoint_027(text,text,text,integer,text,text,boolean,jsonb)','EXECUTE') then
      raise exception 'financial checkpoint legacy helper execution denied'; end if;
  end loop;
  if exists(select 1 from pg_proc p,
    lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid='lean_private.history_commit_checkpoint_027(text,text,text,integer,text,text,boolean,jsonb)'::regprocedure
      and a.grantee<>p.proowner) then raise exception 'financial checkpoint legacy helper grant denied'; end if;
  foreach r in array array['anon','authenticated','lean_posthog_reader'] loop
    foreach f in array array[
      'public.lean_financial_checkpoint_claim(text,text,uuid)'::regprocedure,
      'public.lean_financial_checkpoint_commit(text,text,text,uuid,jsonb)'::regprocedure
    ] loop
      if has_function_privilege(r,f,'EXECUTE') then
        raise exception 'financial checkpoint inherited execution denied'; end if;
    end loop;
  end loop;
end $$;
commit;
