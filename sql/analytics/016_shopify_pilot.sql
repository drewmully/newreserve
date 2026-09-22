-- REVIEW ONLY. Isolated database only; apply after 001/003/004/013/014/015.
-- Nothing is scheduled, certified, selected, or exposed to anonymous clients.
begin;
create table lean_private.pilot_environment (
  singleton boolean primary key default true check(singleton),
  project_ref text not null check(project_ref ~ '^[a-z]{20}$' and project_ref <> 'xnfjdbpjuaezxjgargto'),
  approval_ref text not null check(length(trim(approval_ref)) > 0)
);
create table lean_private.pilot_runs (
  run_id uuid primary key,
  publication_id text not null unique references lean_private.publications,
  shop text not null check(shop ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  order_gid text not null check(order_gid ~ '^gid://shopify/Order/[1-9][0-9]*$'),
  policy jsonb not null check(jsonb_typeof(policy)='object'),
  approval_ref text not null check(length(trim(approval_ref))>0),
  actor_ref text not null check(length(trim(actor_ref))>0),
  version text not null check(version='shopify-pilot-v1'),
  state text not null default 'pending' check(state in ('pending','leased','done','failed')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  lease_token uuid, lease_until timestamptz,
  source jsonb, source_fingerprint text,
  completed_at timestamptz, created_at timestamptz not null default now(),
  check((source is null)=(source_fingerprint is null))
);
alter table lean_private.pilot_environment enable row level security;
alter table lean_private.pilot_runs enable row level security;
revoke all on lean_private.pilot_environment,lean_private.pilot_runs from public;
-- Physical, single-order SAMPLE table for a separately approved PostHog import.
-- No selected-publication join: these are explicitly unverified test results.
create table lean_analytics.pilot_store_daily (
  like lean_private.report_store_daily including defaults including constraints,
  run_id uuid not null references lean_private.pilot_runs,
  sample_scope text not null default 'single_order' check(sample_scope='single_order'),
  certification text not null default 'unverified' check(certification='unverified'),
  primary key(run_id,report_date)
);
alter table lean_analytics.pilot_store_daily enable row level security;
revoke all on lean_analytics.pilot_store_daily from public;
-- This group cannot log in. Creating an actual hosted login is a separate approval.
create role lean_pilot_reader nologin noinherit;
grant usage on schema lean_analytics to lean_pilot_reader;
grant select on lean_analytics.pilot_store_daily to lean_pilot_reader;
create policy pilot_read on lean_analytics.pilot_store_daily for select to lean_pilot_reader using(true);

create function public.lean_pilot_register(
  p_run_id uuid,p_shop text,p_order_gid text,p_policy jsonb,p_approval text,p_actor text
) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare existing lean_private.pilot_runs; pub text := 'pilot:'||p_run_id::text;
begin
  if not exists(select 1 from lean_private.pilot_environment) then raise exception 'isolated environment not registered'; end if;
  if p_approval is null or length(trim(p_approval))=0 or p_actor is null or length(trim(p_actor))=0
    or p_policy is null or jsonb_typeof(p_policy)<>'object'
    or coalesce(p_policy->>'financialApprovalRef','')=''
    or coalesce(p_policy#>>'{decision,approvalRef}','')=''
    or p_policy->>'saleClock' is distinct from 'paid_at'
    or p_policy->>'refundClock' is distinct from 'refund_created_at' then raise exception 'approval required'; end if;
  -- Serialize registration so an ambiguous response can be retried identically.
  lock table lean_private.pilot_runs in share row exclusive mode;
  select * into existing from lean_private.pilot_runs where run_id=p_run_id;
  if found then
    if existing.shop is distinct from p_shop or existing.order_gid is distinct from p_order_gid or
       existing.policy is distinct from p_policy or existing.approval_ref is distinct from p_approval or
       existing.actor_ref is distinct from p_actor then raise exception 'run scope immutable'; end if;
    return;
  end if;
  insert into lean_private.publications(publication_id,contract_version) values(pub,'lean-v1-draft.1');
  insert into lean_private.pilot_runs(run_id,publication_id,shop,order_gid,policy,approval_ref,actor_ref,version)
    values(p_run_id,pub,p_shop,p_order_gid,p_policy,p_approval,p_actor,'shopify-pilot-v1');
end $$;

create function public.lean_pilot_claim(p_run_id uuid,p_token uuid,p_project_ref text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.pilot_runs;
begin
  if p_token is null or not exists(select 1 from lean_private.pilot_environment where project_ref=p_project_ref)
    then raise exception 'isolated target mismatch'; end if;
  select * into r from lean_private.pilot_runs where run_id=p_run_id for update;
  if not found then raise exception 'unknown approved run'; end if;
  if r.state='done' then return jsonb_build_object('state','done'); end if;
  if r.state='leased' and r.lease_until>clock_timestamp() then return jsonb_build_object('state','busy'); end if;
  if r.attempts>=5 then return jsonb_build_object('state','exhausted'); end if;
  update lean_private.pilot_runs set state='leased',attempts=attempts+1,lease_token=p_token,
    lease_until=clock_timestamp()+interval '120 seconds' where run_id=p_run_id;
  return jsonb_build_object('state','claimed','shop',r.shop,'orderGid',r.order_gid,'policy',r.policy,
    'publication',r.publication_id,'version',r.version,'source',r.source);
end $$;

create function public.lean_pilot_retain(p_run_id uuid,p_token uuid,p_source jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.pilot_runs;
begin
  select * into r from lean_private.pilot_runs where run_id=p_run_id for update;
  if not found or r.state<>'leased' or r.lease_token is distinct from p_token or
    r.lease_until<=clock_timestamp() then return false; end if;
  if p_source is null or jsonb_typeof(p_source)<>'object' or
    p_source#>>'{commerce,shop}' is distinct from r.shop or
    p_source#>>'{commerce,order,id}' is distinct from r.order_gid or
    p_source#>>'{commerce,apiVersion}' is distinct from '2026-07' then raise exception 'source scope mismatch'; end if;
  if r.source is not null and r.source is distinct from p_source then raise exception 'source immutable'; end if;
  update lean_private.pilot_runs set source=p_source,source_fingerprint=md5(p_source::text) where run_id=p_run_id;
  return true;
end $$;

create function public.lean_pilot_finish(p_run_id uuid,p_token uuid,p_facts jsonb,p_reports jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.pilot_runs; t text; row jsonb; order_key text;
begin
  select * into r from lean_private.pilot_runs where run_id=p_run_id for update;
  if not found or r.state<>'leased' or r.lease_token is distinct from p_token or
    r.lease_until<=clock_timestamp() then return false; end if;
  if r.source is null then raise exception 'retain source first'; end if;
  if p_facts is null or jsonb_typeof(p_facts)<>'object' or
    p_reports is null or jsonb_typeof(p_reports)<>'array' or
    jsonb_array_length(p_reports) not between 1 and 4 or
    jsonb_typeof(p_facts->'orders') is distinct from 'array' or
    jsonb_array_length(p_facts->'orders')<>1 then raise exception 'invalid pilot batch'; end if;
  row := p_facts->'orders'->0; order_key := row->>'order_id';
  if row->>'shop_id' is distinct from r.shop or
    'gid://shopify/Order/'||(row->>'source_order_id') is distinct from r.order_gid or
    row->>'eligibility_status' is distinct from 'eligible' or
    row->>'source_currency' is distinct from 'USD' then raise exception 'fact scope mismatch'; end if;
  foreach t in array array['customers','identity_map','order_item_offers','sessions','marketing_spend_daily','order_attribution'] loop
    if p_facts->t is distinct from '[]'::jsonb then raise exception 'unsupported pilot domain'; end if;
  end loop;
  foreach t in array array['orders','order_items','sales_ledger','payments'] loop
    if jsonb_typeof(p_facts->t) is distinct from 'array' or jsonb_array_length(p_facts->t)=0 then raise exception 'missing facts'; end if;
    for row in select value from jsonb_array_elements(p_facts->t) loop
      if row->>'publication_id' is distinct from r.publication_id or row->>'order_id' is distinct from order_key
        then raise exception 'mixed fact scope'; end if;
      if t='payments' and (row->'cash_eligible' is distinct from 'false'::jsonb or
          row->'cash_amount_usd' is distinct from 'null'::jsonb or row->'settled_at' is distinct from 'null'::jsonb)
        then raise exception 'settlement unproven'; end if;
    end loop;
    execute format('insert into lean_private.%I select * from jsonb_populate_recordset(null::lean_private.%I,$1)',t,t)
      using p_facts->t;
  end loop;
  for row in select value from jsonb_array_elements(p_reports) loop
    if row->>'publication_id' is distinct from r.publication_id or row->>'shop_id' is distinct from r.shop
      or row->>'definition_version' is distinct from 'shopify-pilot-v1'
      or row->'collected_cash_usd' is distinct from 'null'::jsonb
      or row->'new_customers' is distinct from 'null'::jsonb or row->'spend_usd' is distinct from 'null'::jsonb
      or row->'ncac_usd' is distinct from 'null'::jsonb or row->'mer' is distinct from 'null'::jsonb
      then raise exception 'invalid sample report'; end if;
  end loop;
  insert into lean_analytics.pilot_store_daily
    select v.*,r.run_id,'single_order','unverified'
    from jsonb_populate_recordset(null::lean_private.report_store_daily,p_reports) v;
  update lean_private.pilot_runs set state='done',completed_at=clock_timestamp(),lease_token=null,lease_until=null where run_id=p_run_id;
  -- Do NOT create certifications or modify production selection pointers.
  return true;
end $$;
create function public.lean_pilot_fail(p_run_id uuid,p_token uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
  update lean_private.pilot_runs set state='failed',lease_token=null,lease_until=null
    where run_id=p_run_id and state='leased' and lease_token=p_token and lease_until>clock_timestamp();
  return found;
end $$;
revoke all on function public.lean_pilot_register(uuid,text,text,jsonb,text,text) from public;
revoke all on function public.lean_pilot_claim(uuid,uuid,text) from public;
revoke all on function public.lean_pilot_retain(uuid,uuid,jsonb) from public;
revoke all on function public.lean_pilot_finish(uuid,uuid,jsonb,jsonb) from public;
revoke all on function public.lean_pilot_fail(uuid,uuid) from public;
revoke all on function public.lean_pilot_register(uuid,text,text,jsonb,text,text) from service_role;
-- Supabase may have default per-role function grants in public; PUBLIC revoke
-- alone is not sufficient. Remove any inherited creation-time grants explicitly.
do $$
declare role_name text; function_name regprocedure;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      for function_name in select oid::regprocedure from pg_proc
        where pronamespace='public'::regnamespace and proname in (
          'lean_pilot_register','lean_pilot_claim','lean_pilot_retain','lean_pilot_finish','lean_pilot_fail')
      loop execute format('revoke all on function %s from %I',function_name,role_name); end loop;
    end if;
  end loop;
end $$;
-- Registration/environment changes deliberately have NO service-role grant.
grant execute on function public.lean_pilot_claim(uuid,uuid,text) to service_role;
grant execute on function public.lean_pilot_retain(uuid,uuid,jsonb) to service_role;
grant execute on function public.lean_pilot_finish(uuid,uuid,jsonb,jsonb) to service_role;
grant execute on function public.lean_pilot_fail(uuid,uuid) to service_role;
commit;
