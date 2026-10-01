-- PRIVATE REVIEW ONLY. Additive to 017/047/050/052. No grant row, token, source,
-- scope, timer or enabled delivery is seeded. Existing routes remain unchanged.
begin;
create table lean_private.observed_delivery_authorization (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  revision bigint not null check(revision>0),
  project_ref text not null check(project_ref='xnfjdbpjuaezxjgargto'),
  shop text not null check(shop='mullybox-store.myshopify.com'),
  source_id text not null check(source_id='01a0f3c6-8758-0000-378b-d15c40a96f3a'),
  audience text not null check(audience='posthog:353503:source:01a0f3c6-8758-0000-378b-d15c40a96f3a'),
  path text not null check(path='/api/analytics/reports/observed-current'),
  manifest_sha256 text not null check(manifest_sha256='6cf527d8ef508e033160c20f43848734ff31b6558890a5771bebbffc1b2f123a'),
  scope_sha256 text not null check(scope_sha256 ~ '^[a-f0-9]{64}$'),
  token_sha256 text not null check(token_sha256 ~ '^[a-f0-9]{64}$'),
  approval_ref text not null check(length(trim(approval_ref)) between 1 and 512),
  delivery_approval_ref text not null check(length(trim(delivery_approval_ref)) between 1 and 512),
  not_before timestamptz not null,
  expires_at timestamptz not null,
  check(isfinite(not_before) and isfinite(expires_at) and expires_at>not_before and
    extract(epoch from expires_at-not_before)<=604800)
);
alter table lean_private.observed_delivery_authorization enable row level security;
create function lean_private.observed_delivery_revision_guard() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if new.enabled and to_regclass('lean_private.workbook_runtime_authorization') is not null then
    if exists(select 1 from lean_private.workbook_runtime_authorization where token_sha256=new.token_sha256) then
      raise exception 'observed grant requires a distinct workbook-independent token digest';
    end if;
  end if;
  if tg_op='INSERT' then
    if new.revision<>1 then raise exception 'initial observed authorization revision must be one'; end if;
    return new;
  end if;
  if new.revision<>old.revision+1 then raise exception 'exact next observed authorization revision required'; end if;
  if new.enabled then
    if new.token_sha256=old.token_sha256 or new.approval_ref=old.approval_ref then
      raise exception 'rotation or renewal requires a new token digest and approval';
    end if;
  elsif (to_jsonb(new)-array['enabled','revision']) is distinct from
    (to_jsonb(old)-array['enabled','revision']) then
    raise exception 'disable may change only enabled and revision';
  end if;
  return new;
end $$;
create trigger observed_delivery_revision_guard before insert or update on lean_private.observed_delivery_authorization
for each row execute function lean_private.observed_delivery_revision_guard();

create function lean_private.observed_delivery_scope_hash() returns text
language sql stable set search_path=pg_catalog as $$
  select encode(sha256(convert_to(jsonb_build_object('shop',shop,'project',project_ref,'policy',policy,
    'from',to_char(from_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'until',to_char(until_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'UTF8')),'hex')
  from lean_private.pipeline_scope
  where shop='mullybox-store.myshopify.com' and project_ref='xnfjdbpjuaezxjgargto';
$$;

-- Lock order for authority + scope changes: authorization -> pipeline_scope ->
-- 050 delivery. Owner changes spanning these objects must use the same order.
-- READ COMMITTED is required; old RR snapshots cannot attest current revocation.
create function lean_private.observed_delivery_snapshot(p_project_ref text) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare a lean_private.observed_delivery_authorization; g lean_private.production_report_delivery; result jsonb;
begin
  if current_setting('transaction_isolation')<>'read committed' then return null; end if;
  lock table lean_private.observed_delivery_authorization in share mode;
  select * into a from lean_private.observed_delivery_authorization
    where singleton and enabled and project_ref=p_project_ref for share;
  if not found or clock_timestamp()<a.not_before or clock_timestamp()>=a.expires_at then return null; end if;
  perform 1 from lean_private.pipeline_scope where shop=a.shop and project_ref=a.project_ref for share;
  if not found or lean_private.observed_delivery_scope_hash() is distinct from a.scope_sha256 then return null; end if;
  select * into g from lean_private.production_report_delivery where singleton for share;
  if not found or not g.enabled or g.approval_ref is distinct from a.delivery_approval_ref then return null; end if;
  result:=jsonb_build_object('revision',a.revision::text,
    'snapshot_hash',encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex'),
    'token_sha256',a.token_sha256,'project_ref',a.project_ref,'shop',a.shop,'source_id',a.source_id,
    'audience',a.audience,'path',a.path,'manifest_sha256',a.manifest_sha256,'scope_sha256',a.scope_sha256,
    'approval_ref',a.approval_ref,
    'not_before',to_char(a.not_before at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'expires_at',to_char(a.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  if octet_length(result::text)>8192 or clock_timestamp()>=a.expires_at then return null; end if;
  return result;
end $$;

-- One statement snapshot covers 050 metrics, ordered heads, scope and health.
-- No new report store. The opaque generation changes only with source heads or
-- approved scope, not with clock ticks. Observed freshness is not certification.
create function lean_private.observed_delivery_payload(p_expires_at timestamptz) returns jsonb
language plpgsql stable set search_path=pg_catalog as $$
declare base jsonb; cfg lean_private.pipeline_scope; heads jsonb; pub text;
  observed_revision timestamptz; processed_at timestamptz; checked_at timestamptz:=clock_timestamp();
  head_count bigint; mismatches bigint; missing_product bigint;
  pending bigint; leased bigint; expired bigint; dead bigint;
  state text; status jsonb; stores jsonb; products jsonb; result jsonb;
begin
  base:=public.lean_production_reports_read();
  if base is null then return null; end if;
  select * into strict cfg from lean_private.pipeline_scope
    where shop='mullybox-store.myshopify.com' and project_ref='xnfjdbpjuaezxjgargto';
  select coalesce(jsonb_agg(jsonb_build_array(h.order_gid,h.work_id::text,
      to_char(h.revision at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by h.order_gid),'[]'::jsonb),
    count(*),max(h.revision),max(w.completed_at),
    count(*) filter(where s.policy is distinct from cfg.policy or s.from_time is distinct from cfg.from_time or
      s.until_time is distinct from cfg.until_time or w.state<>'done' or w.completed_at is null),
    count(*) filter(where not exists(select 1 from lean_private.report_product_daily p where p.publication_id=s.publication_id))
  into heads,head_count,observed_revision,processed_at,mismatches,missing_product
  from lean_private.pipeline_heads h join lean_private.pipeline_snapshots s using(work_id)
    join lean_private.work w using(work_id) where h.shop=cfg.shop;
  pub:='observed:'||encode(sha256(convert_to(jsonb_build_object(
    'scope',lean_private.observed_delivery_scope_hash(),'heads',heads)::text,'UTF8')),'hex');
  select count(*) filter(where w.state='pending'),count(*) filter(where w.state='leased'),
    count(*) filter(where w.state='leased' and w.lease_until<=checked_at),count(*) filter(where w.state='dead')
  into pending,leased,expired,dead
  from lean_private.work w join lean_private.receipts r using(receipt_id)
  where r.source='shopify' and lean_private.receipt_shop(r.business_key)=cfg.shop;
  state:=case when not cfg.enabled then 'disabled'
    when mismatches>0 or missing_product>0 or dead>0 then 'failed'
    when pending>0 or leased>0 or expired>0 then 'pending' else 'idle' end;
  select coalesce(jsonb_agg(r||jsonb_build_object('shop_id',cfg.shop,'publication_id',pub,
    'snapshot_checked_at',to_char(checked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    order by r->>'report_date',r->>'definition_version'),'[]'::jsonb)
    into stores from jsonb_array_elements(base->'store_daily') r;
  select coalesce(jsonb_agg(r||jsonb_build_object('shop_id',cfg.shop,'publication_id',pub,
    'snapshot_checked_at',to_char(checked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    order by r->>'report_date',r->>'definition_version',r->>'sku_bucket'),'[]'::jsonb)
    into products from jsonb_array_elements(base->'product_daily') r;
  status:=jsonb_build_object('shop_id',cfg.shop,'publication_id',pub,'definition_version','shopify-observed-v1',
    'report_scope','webhook_observed_only','certified',false,'complete_window',false,
    'freshness_scope','matched_observed_snapshot','producer_liveness','not_proven',
    'checked_at',to_char(checked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'valid_until',to_char(least(p_expires_at,checked_at+interval '30 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'last_processed_at',to_char(processed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'source_observed_revision_at',to_char(observed_revision at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'scope_from',to_char(cfg.from_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'scope_until',to_char(cfg.until_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'scope_enabled',cfg.enabled,'operational_state',state,'head_count',head_count::text,
    'pending_work',pending::text,'leased_work',leased::text,'expired_work',expired::text,'dead_work',dead::text,
    'head_scope_mismatches',mismatches::text,'missing_product_heads',missing_product::text);
  result:=jsonb_build_object('store_daily',stores,'product_daily',products,
    'acquisition_daily','[]'::jsonb,'customer_cohorts','[]'::jsonb,'funnel_daily','[]'::jsonb,
    'report_status',jsonb_build_array(
      status||jsonb_build_object('resource_name','store_daily','row_count',jsonb_array_length(stores)::text),
      status||jsonb_build_object('resource_name','product_daily','row_count',jsonb_array_length(products)::text)));
  if octet_length(result::text)>4194304 or clock_timestamp()>=p_expires_at then return null; end if;
  return result;
end $$;
create function public.lean_observed_delivery_auth(p_project_ref text) returns jsonb
language sql security definer set search_path=pg_catalog as $$
  select lean_private.observed_delivery_snapshot(p_project_ref);
$$;
create function public.lean_observed_delivery_read(p_project_ref text,p_revision text,p_snapshot_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare a jsonb; result jsonb;
begin
  a:=lean_private.observed_delivery_snapshot(p_project_ref);
  if a is null or a->>'revision' is distinct from p_revision or
    a->>'snapshot_hash' is distinct from p_snapshot_hash then return null; end if;
  result:=lean_private.observed_delivery_payload((a->>'expires_at')::timestamptz);
  if lean_private.observed_delivery_snapshot(p_project_ref) is distinct from a then return null; end if;
  return result;
end $$;

create function lean_private.observed_delivery_acl_check() returns void
language plpgsql set search_path=pg_catalog as $$
declare fn regprocedure; runtime boolean; owner_id oid; r text;
begin
  select relowner into owner_id from pg_class where oid='lean_private.observed_delivery_authorization'::regclass;
  if exists(select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
      where c.oid='lean_private.observed_delivery_authorization'::regclass and a.grantee<>owner_id) or
    exists(select 1 from pg_attribute c cross join lateral aclexplode(c.attacl) a
      where c.attrelid='lean_private.observed_delivery_authorization'::regclass and a.grantee<>owner_id)
    then raise exception 'unexpected observed authorization table or column grant'; end if;
  foreach r in array array['anon','authenticated','service_role','lean_posthog_reader'] loop
    if exists(select 1 from pg_roles where rolname=r) and
      (has_table_privilege(r,'lean_private.observed_delivery_authorization','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or
       has_any_column_privilege(r,'lean_private.observed_delivery_authorization','SELECT,INSERT,UPDATE,REFERENCES'))
      then raise exception 'unexpected effective observed authorization privilege'; end if;
  end loop;
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='lean_private' and p.proname in ('observed_delivery_revision_guard','observed_delivery_scope_hash',
      'observed_delivery_snapshot','observed_delivery_payload','observed_delivery_acl_check')) or
      (n.nspname='public' and p.proname in ('lean_observed_delivery_auth','lean_observed_delivery_read'))
  loop
    select pronamespace='public'::regnamespace into runtime from pg_proc where oid=fn;
    if exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid=fn and (p.proowner<>owner_id or a.grantee<>owner_id and
        not(runtime and a.grantee='service_role'::regrole and a.privilege_type='EXECUTE' and not a.is_grantable)))
      then raise exception 'unexpected observed delivery function privilege'; end if;
    foreach r in array array['anon','authenticated','service_role','lean_posthog_reader'] loop
      if exists(select 1 from pg_roles where rolname=r) and
        has_function_privilege(r,fn,'EXECUTE') is distinct from (runtime and r='service_role')
        then raise exception 'unexpected effective observed delivery execute'; end if;
    end loop;
  end loop;
end $$;
revoke all on lean_private.observed_delivery_authorization from public,anon,authenticated,service_role;
do $acl$
declare fn regprocedure;
begin
  if exists(select 1 from pg_roles where rolname='lean_posthog_reader') then
    revoke all on lean_private.observed_delivery_authorization from lean_posthog_reader;
  end if;
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='lean_private' and p.proname in ('observed_delivery_revision_guard','observed_delivery_scope_hash',
      'observed_delivery_snapshot','observed_delivery_payload','observed_delivery_acl_check')) or
      (n.nspname='public' and p.proname in ('lean_observed_delivery_auth','lean_observed_delivery_read'))
  loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
    if exists(select 1 from pg_roles where rolname='lean_posthog_reader') then
      execute format('revoke all on function %s from lean_posthog_reader',fn);
    end if;
  end loop;
end $acl$;
grant execute on function public.lean_observed_delivery_auth(text),public.lean_observed_delivery_read(text,text,text) to service_role;
select lean_private.observed_delivery_acl_check();
commit;
