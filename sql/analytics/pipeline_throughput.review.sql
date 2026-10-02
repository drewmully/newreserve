-- PRIVATE REVIEW ONLY. Empty/default off. No scope, grant, cron or source action.
-- Additive to017/047/052. Parent must wrap installation in exact catalog guards.
begin;
create table lean_private.pipeline_throughput_grants (
  grant_id text primary key check(length(grant_id) between 1 and 150),
  project_ref text not null check(project_ref='xnfjdbpjuaezxjgargto'),
  shop text not null check(shop='mullybox-store.myshopify.com'),
  scope_sha256 text not null check(scope_sha256 ~ '^[a-f0-9]{64}$'),
  approval_ref text not null check(length(trim(approval_ref))>0),
  actor_ref text not null check(length(trim(actor_ref))>0),
  enabled boolean not null default false,
  not_before timestamptz not null, expires_at timestamptz not null,
  max_extra_claims integer not null check(max_extra_claims between 1 and 10000),
  max_native_requests integer not null check(max_native_requests between 8 and 80000),
  max_batch_claims integer not null check(max_batch_claims between 1 and 19),
  max_batch_native_requests integer not null check(max_batch_native_requests between 8 and 152),
  extra_claims_used integer not null default 0 check(extra_claims_used>=0 and extra_claims_used<=max_extra_claims),
  native_permits_used integer not null default 0 check(native_permits_used>=0 and native_permits_used<=max_native_requests),
  batch_token uuid, batch_deadline timestamptz, batch_claims integer not null default 0,
  batch_native integer not null default 0, held boolean not null default false,
  current_work_id bigint, current_work_token uuid, current_work_native integer not null default 0,
  check(isfinite(not_before) and isfinite(expires_at) and not_before<expires_at
    and expires_at-not_before<=interval '7 days'),
  check((batch_token is null)=(batch_deadline is null)),
  check((current_work_id is null)=(current_work_token is null)),
  check(current_work_id is null or batch_token is not null),
  check(batch_claims between 0 and 19 and batch_native between 0 and 152 and current_work_native between 0 and 8)
);
create unique index pipeline_throughput_one_enabled on lean_private.pipeline_throughput_grants(project_ref,shop) where enabled;
alter table lean_private.pipeline_throughput_grants enable row level security;
revoke all on lean_private.pipeline_throughput_grants from public,anon,authenticated,service_role;

create function lean_private.pipeline_throughput_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if (to_jsonb(old)-array['enabled','extra_claims_used','native_permits_used','batch_token','batch_deadline',
      'batch_claims','batch_native','held','current_work_id','current_work_token','current_work_native'])
    is distinct from
    (to_jsonb(new)-array['enabled','extra_claims_used','native_permits_used','batch_token','batch_deadline',
      'batch_claims','batch_native','held','current_work_id','current_work_token','current_work_native'])
    or new.extra_claims_used<old.extra_claims_used or new.native_permits_used<old.native_permits_used
    or (old.held and not new.held)
    or (not old.enabled and new.enabled and (old.extra_claims_used>0 or old.batch_token is not null))
    then raise exception 'throughput terms and consumed authority immutable'; end if;
  return new;
end $$;
create trigger immutable_pipeline_throughput before update on lean_private.pipeline_throughput_grants
for each row execute function lean_private.pipeline_throughput_immutable();

create function lean_private.pipeline_throughput_scope_hash() returns text
language sql stable set search_path=pg_catalog as $$
  select encode(sha256(convert_to(jsonb_build_object('shop',shop,'project',project_ref,'policy',policy,
    'from',to_char(from_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'until',to_char(until_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'UTF8')),'hex')
  from lean_private.pipeline_scope
  where shop='mullybox-store.myshopify.com' and project_ref='xnfjdbpjuaezxjgargto';
$$;

create function public.lean_pipeline_throughput_begin(p_project_ref text,p_shop text,p_token uuid,p_deadline timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare g lean_private.pipeline_throughput_grants; cfg lean_private.pipeline_scope; h jsonb; deadline timestamptz;
begin
  if current_setting('transaction_isolation')<>'read committed' or p_token is null or
    p_project_ref is distinct from 'xnfjdbpjuaezxjgargto' or p_shop is distinct from 'mullybox-store.myshopify.com'
    then raise exception 'throughput context'; end if;
  -- Serializes first admission, grants and held attempts for this fixed target.
  perform pg_advisory_xact_lock(hashtextextended('pipeline_throughput:'||p_project_ref,0));
  if exists(select 1 from lean_private.pipeline_throughput_grants
      where project_ref=p_project_ref and shop=p_shop and batch_token is not null) then
    return jsonb_build_object('state','held'); -- never steal even an expired lease
  end if;
  select * into g from lean_private.pipeline_throughput_grants
    where project_ref=p_project_ref and shop=p_shop and enabled for update;
  if not found then return jsonb_build_object('state','off'); end if;
  if g.held then return jsonb_build_object('state','held'); end if;
  if clock_timestamp()<g.not_before or clock_timestamp()>=g.expires_at
    then return jsonb_build_object('state','off'); end if;
  deadline:=least(p_deadline,g.expires_at);
  if p_deadline is null or not isfinite(p_deadline) or p_deadline>clock_timestamp()+interval '180 seconds'
    or deadline<clock_timestamp()+interval '65 seconds'
    then return jsonb_build_object('state','deadline'); end if;
  select * into cfg from lean_private.pipeline_scope
    where project_ref=p_project_ref and shop=p_shop for share;
  if not found or not cfg.enabled or lean_private.pipeline_throughput_scope_hash() is distinct from g.scope_sha256 or
    cfg.policy->>'sourceProjection' not in ('financial_no_geo','financial_no_geo_order_size') or
    cfg.policy->>'sourceProjection' is null or
    cfg.policy->>'sourceRetention' is distinct from 'financial_allowlist_v1' or
    cfg.policy->>'retainedReports' is distinct from 'product-v1'
    then return jsonb_build_object('state','scope_changed'); end if;
  h:=public.lean_pipeline_health(p_project_ref,p_shop);
  if h->'enabled' is distinct from 'true'::jsonb or (h->>'leased')::bigint is distinct from 0::bigint or
    (h->>'dead')::bigint is distinct from 0::bigint or (h->>'expiredLeases')::bigint is distinct from 0::bigint or
    (h->>'pending') is null or (h->>'pending')::bigint<0
    then return jsonb_build_object('state','blocked'); end if;
  if (h->>'pending')::bigint=0 then return jsonb_build_object('state','idle'); end if;
  if g.extra_claims_used>=g.max_extra_claims or g.max_native_requests-g.native_permits_used<8
    then return jsonb_build_object('state','budget_exhausted'); end if;
  update lean_private.pipeline_throughput_grants set batch_token=p_token,batch_deadline=deadline,
    batch_claims=0,batch_native=0 where grant_id=g.grant_id;
  return jsonb_build_object('state','ready','deadline',deadline,
    'maxClaims',least(g.max_batch_claims,g.max_extra_claims-g.extra_claims_used),
    'maxNativeRequests',least(g.max_batch_native_requests,g.max_native_requests-g.native_permits_used));
end $$;

create function public.lean_pipeline_throughput_step(
  p_project_ref text,p_shop text,p_token uuid,p_operation text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare g lean_private.pipeline_throughput_grants; cfg lean_private.pipeline_scope;
  r jsonb; ok boolean; work_token uuid; w lean_private.work;
begin
  if current_setting('transaction_isolation')<>'read committed' or p_token is null or
    p_project_ref is distinct from 'xnfjdbpjuaezxjgargto' or p_shop is distinct from 'mullybox-store.myshopify.com' or
    p_args is null or jsonb_typeof(p_args)<>'object'
    then raise exception 'throughput context'; end if;
  select * into g from lean_private.pipeline_throughput_grants
    where project_ref=p_project_ref and shop=p_shop and batch_token=p_token for update;
  if not found or not g.enabled or g.held or clock_timestamp()>=g.batch_deadline or clock_timestamp()>=g.expires_at
    then raise exception 'throughput authority unavailable'; end if;
  select * into cfg from lean_private.pipeline_scope
    where project_ref=p_project_ref and shop=p_shop for share;
  if not found or not cfg.enabled or lean_private.pipeline_throughput_scope_hash() is distinct from g.scope_sha256
    then raise exception 'throughput scope changed'; end if;

  if p_operation='lean_pipeline_claim' then
    if g.current_work_id is not null or g.batch_claims>=g.max_batch_claims or
      g.extra_claims_used>=g.max_extra_claims or
      least(g.max_batch_native_requests-g.batch_native,g.max_native_requests-g.native_permits_used)<8 or
      g.batch_deadline<clock_timestamp()+interval '65 seconds' or
      p_args->>'p_project_ref' is distinct from p_project_ref or p_args->>'p_shop' is distinct from p_shop
      then raise exception 'throughput claim budget'; end if;
    work_token:=(p_args->>'p_token')::uuid;
    r:=public.lean_pipeline_claim(work_token,p_project_ref,p_shop);
    if r->>'state'='claimed' then
      -- Already-claimed snapshots keep their policy. Refuse drift; never reset it.
      if r->'policy' is distinct from cfg.policy or (r->>'fromTime')::timestamptz is distinct from cfg.from_time or
        (r->>'untilTime')::timestamptz is distinct from cfg.until_time
        then raise exception 'throughput frozen policy changed'; end if;
      update lean_private.pipeline_throughput_grants set
        extra_claims_used=extra_claims_used+1,batch_claims=batch_claims+1,
        current_work_id=(r->>'workId')::bigint,current_work_token=work_token,current_work_native=0
        where grant_id=g.grant_id;
    end if;
  elsif p_operation='native_request' then
    if g.current_work_id is null or p_args<>'{}'::jsonb or g.current_work_native>=8 or
      g.batch_native>=g.max_batch_native_requests or g.native_permits_used>=g.max_native_requests
      then raise exception 'throughput source budget'; end if;
    select * into w from lean_private.work where work_id=g.current_work_id;
    if not found or w.state<>'leased' or w.lease_token is distinct from g.current_work_token::text or
      w.lease_until<=clock_timestamp() then raise exception 'throughput work lease'; end if;
    update lean_private.pipeline_throughput_grants set native_permits_used=native_permits_used+1,
      batch_native=batch_native+1,current_work_native=current_work_native+1 where grant_id=g.grant_id;
    r:='true'::jsonb; -- burn one permit BEFORE the one native HTTP request
  else
    if g.current_work_id is null or (p_args->>'p_work_id')::bigint is distinct from g.current_work_id or
      (p_args->>'p_token')::uuid is distinct from g.current_work_token then raise exception 'throughput work binding'; end if;
    case p_operation
      when 'lean_pipeline_retain' then
        ok:=public.lean_pipeline_retain(g.current_work_id,g.current_work_token,p_args->'p_source');
      when 'lean_pipeline_finish_extended' then
        ok:=public.lean_pipeline_finish_extended(g.current_work_id,g.current_work_token,
          p_args->'p_facts',p_args->'p_reports',p_args->'p_product_reports',nullif(p_args->'p_order_item_sizes','null'::jsonb));
      when 'lean_pipeline_exclude_before_window' then
        ok:=public.lean_pipeline_exclude_before_window(g.current_work_id,g.current_work_token);
      when 'lean_pipeline_fail' then
        ok:=public.lean_pipeline_fail(g.current_work_id,g.current_work_token,p_args->>'p_code');
      else raise exception 'throughput operation not allowed';
    end case;
    r:=to_jsonb(ok);
    if ok and p_operation in ('lean_pipeline_finish_extended','lean_pipeline_exclude_before_window') then
      update lean_private.pipeline_throughput_grants set current_work_id=null,current_work_token=null,current_work_native=0
        where grant_id=g.grant_id;
    elsif not ok or p_operation='lean_pipeline_fail' then
      update lean_private.pipeline_throughput_grants set held=true where grant_id=g.grant_id;
    end if;
  end if;
  -- A late delegate commit rolls back in THIS transaction. Caller abort alone
  -- does not prove this check ran, nor that an earlier commit did not succeed.
  if clock_timestamp()>=g.batch_deadline or clock_timestamp()>=g.expires_at
    then raise exception 'throughput deadline'; end if;
  return r;
end $$;

create function public.lean_pipeline_throughput_close(p_project_ref text,p_shop text,p_token uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare g lean_private.pipeline_throughput_grants;
begin
  if current_setting('transaction_isolation')<>'read committed' or p_token is null
    then raise exception 'throughput context'; end if;
  select * into g from lean_private.pipeline_throughput_grants
    where project_ref=p_project_ref and shop=p_shop and batch_token=p_token for update;
  if not found or g.held or g.current_work_id is not null or clock_timestamp()>=g.batch_deadline
    then return false; end if;
  update lean_private.pipeline_throughput_grants set batch_token=null,batch_deadline=null
    where grant_id=g.grant_id;
  return true;
end $$;

do $acl$
declare p record; role_name text;
begin
  for p in select x.oid::regprocedure signature from pg_proc x join pg_namespace n on n.oid=x.pronamespace
    where (n.nspname='lean_private' and x.proname in ('pipeline_throughput_immutable','pipeline_throughput_scope_hash'))
      or (n.nspname='public' and x.proname in ('lean_pipeline_throughput_begin','lean_pipeline_throughput_step','lean_pipeline_throughput_close'))
  loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',p.signature);
    if exists(select 1 from pg_roles where rolname='lean_posthog_reader') then
      execute format('revoke all on function %s from lean_posthog_reader',p.signature);
    end if;
    if exists(select 1 from pg_proc x cross join lateral aclexplode(x.proacl) a
      where x.oid=p.signature::oid and a.grantee<>x.proowner)
      then raise exception 'throughput unexpected function grant'; end if;
    for role_name in select rolname from pg_roles where rolname in ('anon','authenticated','service_role','lean_posthog_reader') loop
      if has_function_privilege(role_name,p.signature::oid,'EXECUTE')
        then raise exception 'throughput unexpected effective execute'; end if;
    end loop;
  end loop;
  if exists(select 1 from pg_roles where rolname='lean_posthog_reader') then
    revoke all on lean_private.pipeline_throughput_grants from lean_posthog_reader;
  end if;
  if exists(select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
    where c.oid='lean_private.pipeline_throughput_grants'::regclass and a.grantee<>c.relowner)
    then raise exception 'throughput unexpected table grant'; end if;
  for role_name in select rolname from pg_roles where rolname in ('anon','authenticated','service_role','lean_posthog_reader') loop
    if has_table_privilege(role_name,'lean_private.pipeline_throughput_grants','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(role_name,'lean_private.pipeline_throughput_grants','SELECT,INSERT,UPDATE,REFERENCES')
      then raise exception 'throughput unexpected effective table privilege'; end if;
  end loop;
end $acl$;
grant execute on function public.lean_pipeline_throughput_begin(text,text,uuid,timestamptz),
  public.lean_pipeline_throughput_step(text,text,uuid,text,jsonb),
  public.lean_pipeline_throughput_close(text,text,uuid) to service_role;
commit;
