-- PRIVATE REVIEW ONLY. Requires current 053 + customer_generation_full_integration,
-- not its renamed pre-privacy helper. No row, token, approval or activation is seeded.
-- Separate /reports/workbook path. SQL050 and /reports/production stay unchanged.
-- Owner transition must lock selected_publications before changing 053 delivery.
begin;
do $dependency$
begin
  if to_regprocedure('public.lean_production_workbook_reports_read(text)') is null or
    to_regprocedure('public.lean_workbook_read_before_customer_generation(text)') is null or
    to_regprocedure('lean_private.customer_generation_full_check(text,text,boolean)') is null
    then raise exception 'current privacy-wrapped workbook reader required'; end if;
end $dependency$;

create table lean_private.workbook_runtime_authorization (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  mode text not null check(mode='workbook'),
  revision bigint not null check(revision>0),
  project_ref text not null check(project_ref='xnfjdbpjuaezxjgargto'),
  source_id text not null check(source_id='01a0f3c6-8758-0000-378b-d15c40a96f3a'),
  audience text not null check(audience='posthog:353503:source:01a0f3c6-8758-0000-378b-d15c40a96f3a'),
  path text not null check(path='/api/analytics/reports/workbook'),
  manifest_sha256 text not null check(manifest_sha256='ede0c179ef4a9f1b28625691823cb8410ae54fdce2af341de915f4a0593df6f3'),
  run_id text not null references lean_private.full_builds,
  publication_id text not null check(publication_id='full:'||run_id),
  result_hash text not null check(length(result_hash) between 1 and 128),
  shop text not null check(length(trim(shop)) between 1 and 512),
  token_sha256 text not null check(token_sha256 ~ '^[a-f0-9]{64}$'),
  approval_ref text not null check(length(trim(approval_ref)) between 1 and 512),
  delivery_approval_ref text not null check(length(trim(delivery_approval_ref)) between 1 and 512),
  not_before timestamptz not null,
  expires_at timestamptz not null,
  check(isfinite(not_before) and isfinite(expires_at) and
    expires_at>not_before and expires_at<=not_before+interval '1 hour')
);
alter table lean_private.workbook_runtime_authorization enable row level security;

create function lean_private.workbook_runtime_change_lock() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  lock table lean_private.selected_publications in share row exclusive mode;
  return null;
end $$;
create trigger workbook_runtime_change_lock before insert or update or delete
on lean_private.workbook_runtime_authorization for each statement
execute function lean_private.workbook_runtime_change_lock();
create function lean_private.workbook_runtime_revision_guard() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if new.revision<=old.revision then raise exception 'workbook runtime revision must advance'; end if;
  return new;
end $$;
create trigger workbook_runtime_revision_guard before update
on lean_private.workbook_runtime_authorization for each row
execute function lean_private.workbook_runtime_revision_guard();

-- Private auth metadata, never part of a delivered HTTP response.
-- Both RPCs use selection -> authorization -> delivery -> full-build lock order.
create function lean_private.workbook_runtime_snapshot(p_project_ref text)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare a lean_private.workbook_runtime_authorization;
  g lean_private.production_workbook_delivery; f lean_private.full_builds; result jsonb;
begin
  -- Locks cannot refresh an already-established repeatable-read/serializable
  -- snapshot. Only READ COMMITTED may observe the current serving/authority state.
  if current_setting('transaction_isolation')<>'read committed' then return null; end if;
  lock table lean_private.selected_publications in share mode;
  select * into a from lean_private.workbook_runtime_authorization
    where singleton and enabled and project_ref=p_project_ref for share;
  if not found or clock_timestamp()<a.not_before or clock_timestamp()>=a.expires_at then return null; end if;
  select * into g from lean_private.production_workbook_delivery where singleton for share;
  if not found or not g.enabled or (g.run_id,g.project_ref,g.shop,g.approval_ref) is distinct from
    (a.run_id,a.project_ref,a.shop,a.delivery_approval_ref) then return null; end if;
  select * into f from lean_private.full_builds where run_id=a.run_id for share;
  if not found or not f.enabled or f.completed_at is null or f.project_ref<>a.project_ref or
    f.result_hash<>a.result_hash then return null; end if;
  result:=jsonb_build_object('revision',a.revision::text,
    'snapshot_hash',encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex'),
    'token_sha256',a.token_sha256,'project_ref',a.project_ref,'source_id',a.source_id,
    'audience',a.audience,'path',a.path,'manifest_sha256',a.manifest_sha256,
    'run_id',a.run_id,'publication_id',a.publication_id,'result_hash',a.result_hash,
    'shop',a.shop,'approval_ref',a.approval_ref,
    'not_before',to_char(a.not_before at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'expires_at',to_char(a.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  if octet_length(result::text)>8192 or clock_timestamp()>=a.expires_at then return null; end if;
  return result;
end $$;
create function public.lean_workbook_runtime_auth(p_project_ref text)
returns jsonb language sql security definer set search_path=pg_catalog as $$
  select lean_private.workbook_runtime_snapshot(p_project_ref);
$$;
create function public.lean_workbook_runtime_read(p_project_ref text,p_revision text,p_snapshot_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a jsonb; result jsonb;
begin
  a:=lean_private.workbook_runtime_snapshot(p_project_ref);
  if a is null or a->>'revision' is distinct from p_revision or
    a->>'snapshot_hash' is distinct from p_snapshot_hash then return null; end if;
  -- Deliberately call the current public function: includes current customer
  -- authority checks, removal rules, cutoff, selected-domain state and no fallback.
  result:=public.lean_production_workbook_reports_read(p_project_ref);
  if result is null or octet_length(result::text)>4194304 or
    jsonb_typeof(result->'report_status') is distinct from 'array' or
    jsonb_array_length(result->'report_status')<>5 or
    exists(select 1 from jsonb_array_elements(result->'report_status') s
      where s->>'publication_id' is distinct from a->>'publication_id' or
        s->>'shop_id' is distinct from a->>'shop') then return null; end if;
  -- Recheck time after the actual reader, not transaction-start now().
  if lean_private.workbook_runtime_snapshot(p_project_ref) is distinct from a then return null; end if;
  return result;
end $$;

-- Run once in this migration and available owner-only for later approval audits.
-- Explicit column ACLs survive table REVOKE; inspect them separately. Inherited
-- owner/role privileges are checked by effective privilege functions, not OID 10.
create function lean_private.workbook_runtime_acl_check() returns void
language plpgsql set search_path=pg_catalog as $$
declare fn regprocedure; runtime boolean; owner_id oid;
begin
  select relowner into owner_id from pg_class where oid='lean_private.workbook_runtime_authorization'::regclass;
  if exists(select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
    where c.oid='lean_private.workbook_runtime_authorization'::regclass and a.grantee<>owner_id) or
    exists(select 1 from pg_attribute c cross join lateral aclexplode(c.attacl) a
      where c.attrelid='lean_private.workbook_runtime_authorization'::regclass and a.grantee<>owner_id) or
    exists(select 1 from unnest(array['anon','authenticated','service_role','lean_posthog_reader']) r
      where has_table_privilege(r,'lean_private.workbook_runtime_authorization',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or
        has_any_column_privilege(r,'lean_private.workbook_runtime_authorization','SELECT,INSERT,UPDATE,REFERENCES'))
    then raise exception 'unexpected workbook runtime table or column privilege'; end if;
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='lean_private' and p.proname in ('workbook_runtime_change_lock',
      'workbook_runtime_revision_guard','workbook_runtime_snapshot','workbook_runtime_acl_check')) or
      (n.nspname='public' and p.proname in ('lean_workbook_runtime_auth','lean_workbook_runtime_read'))
  loop
    select pronamespace='public'::regnamespace into runtime from pg_proc where oid=fn;
    if exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid=fn and a.grantee<>p.proowner and not(runtime and a.grantee='service_role'::regrole
        and a.privilege_type='EXECUTE' and not a.is_grantable)) or
      exists(select 1 from unnest(array['anon','authenticated','service_role','lean_posthog_reader']) r
        where has_function_privilege(r,fn,'EXECUTE') is distinct from (runtime and r='service_role'))
      then raise exception 'unexpected workbook runtime execute privilege'; end if;
  end loop;
end $$;
revoke all on lean_private.workbook_runtime_authorization from public,anon,authenticated,service_role,lean_posthog_reader;
do $acl$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='lean_private' and p.proname in ('workbook_runtime_change_lock',
      'workbook_runtime_revision_guard','workbook_runtime_snapshot','workbook_runtime_acl_check')) or
      (n.nspname='public' and p.proname in ('lean_workbook_runtime_auth','lean_workbook_runtime_read'))
  loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role,lean_posthog_reader',fn);
  end loop;
end $acl$;
grant execute on function public.lean_workbook_runtime_auth(text),
  public.lean_workbook_runtime_read(text,text,text) to service_role;
select lean_private.workbook_runtime_acl_check();
commit;
