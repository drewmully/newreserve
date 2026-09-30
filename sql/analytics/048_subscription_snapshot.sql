-- REVIEW ONLY. Requires 001's lean_private schema and existing Supabase roles.
-- One GET / one page per owner-registered run. No source, grant to readers, or activation.
begin;
create table lean_private.subscription_runs (
  run_id text primary key check(run_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  project_ref text not null check(project_ref ~ '^[a-z]{20}$'),
  shop text not null check(shop='mullybox-store.myshopify.com'),
  token_sha256 text not null check(token_sha256 ~ '^[a-f0-9]{64}$'),
  binding_ref text not null check(binding_ref ~ '^[A-Za-z0-9:/._-]{1,200}$'),
  approval_ref text not null check(length(trim(approval_ref)) between 1 and 200),
  traffic_approval_ref text not null check(length(trim(traffic_approval_ref)) between 1 and 200),
  actor_ref text not null check(length(trim(actor_ref)) between 1 and 200),
  policy jsonb not null check(jsonb_typeof(policy)='object' and policy->'recurringValue' is not distinct from 'null'::jsonb),
  page_size integer not null check(page_size between 1 and 100),
  max_rows integer not null check(max_rows between 1 and 100),
  max_bytes integer not null check(max_bytes between 1 and 4000000),
  status_filter text check(status_filter in ('ACTIVE','PAUSED','CANCELLED','EXPIRED')),
  enabled boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  attempts integer not null default 0 check(attempts between 0 and 1),
  started_at timestamptz, completed_at timestamptz,
  last_error text check(last_error='source_or_projection_failed'),
  payload jsonb, result_hash text,
  check(isfinite(expires_at) and expires_at>created_at and expires_at<=created_at+interval '7 days'),
  check((completed_at is null)=(payload is null) and (payload is null)=(result_hash is null))
);
create table lean_private.subscription_gate (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  lease_run text references lean_private.subscription_runs,
  lease_token uuid, lease_until timestamptz not null default '-infinity',
  next_allowed_at timestamptz not null default '-infinity',
  permits integer not null default 0 check(permits between 0 and 1)
);
insert into lean_private.subscription_gate(singleton) values(true);
alter table lean_private.subscription_runs enable row level security;
alter table lean_private.subscription_gate enable row level security;
revoke all on lean_private.subscription_runs,lean_private.subscription_gate from public,anon,authenticated,service_role;

create function lean_private.subscription_scope_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if (to_jsonb(old)-array['enabled','attempts','started_at','completed_at','last_error','payload','result_hash'])
    is distinct from (to_jsonb(new)-array['enabled','attempts','started_at','completed_at','last_error','payload','result_hash'])
    or old.payload is not null and (to_jsonb(old)-'enabled') is distinct from (to_jsonb(new)-'enabled')
    then raise exception 'subscription scope/result immutable'; end if;
  return new;
end $$;
create trigger subscription_scope_immutable before update on lean_private.subscription_runs
  for each row execute function lean_private.subscription_scope_immutable();

create function public.lean_subscription_claim(p_run text,p_project text,p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
declare r lean_private.subscription_runs; g lean_private.subscription_gate;
begin
  if p_token is null then raise exception 'subscription token required'; end if;
  select * into strict g from lean_private.subscription_gate where singleton for update;
  select * into r from lean_private.subscription_runs where run_id=p_run and project_ref=p_project for update;
  if not found then raise exception 'unapproved subscription target'; end if;
  if not g.enabled or not r.enabled then return jsonb_build_object('state','disabled'); end if;
  if r.payload is not null then return jsonb_build_object('state','complete'); end if;
  if r.expires_at<=clock_timestamp() then return jsonb_build_object('state','expired'); end if;
  if g.lease_until>clock_timestamp() or g.next_allowed_at>clock_timestamp()
    then return jsonb_build_object('state','busy'); end if;
  if r.attempts>=1 then return jsonb_build_object('state','attempts_exhausted'); end if;
  update lean_private.subscription_runs set attempts=1,
    started_at=date_trunc('milliseconds',clock_timestamp()),last_error=null where run_id=p_run returning * into r;
  update lean_private.subscription_gate set lease_run=p_run,lease_token=p_token,
    lease_until=clock_timestamp()+interval '120 seconds',permits=0 where singleton;
  return jsonb_build_object('state','claimed','shop',r.shop,'apiVersion','2026-04',
    'tokenSha256',r.token_sha256,'bindingRef',r.binding_ref,'policy',r.policy,
    'asOf',to_char(r.started_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'maxPages',1,'maxRows',r.max_rows,'maxBytes',r.max_bytes,'pageSize',r.page_size,'statusFilter',r.status_filter);
end $$;

create function public.lean_subscription_permit(p_run text,p_project text,p_token uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.subscription_runs; g lean_private.subscription_gate;
begin
  select * into strict g from lean_private.subscription_gate where singleton for update;
  select * into r from lean_private.subscription_runs where run_id=p_run and project_ref=p_project for update;
  if not found or not g.enabled or not r.enabled or r.expires_at<=clock_timestamp() or r.payload is not null or
    p_token is null or g.lease_run is distinct from p_run or g.lease_token is distinct from p_token or
    g.lease_until<=clock_timestamp()+interval '20 seconds' or g.next_allowed_at>clock_timestamp() or g.permits>=1
    then return false; end if;
  update lean_private.subscription_gate set permits=1,next_allowed_at=clock_timestamp()+interval '1600 milliseconds'
    where singleton;
  return true;
end $$;

create function lean_private.subscription_validate(p jsonb,r lean_private.subscription_runs) returns void
language plpgsql set search_path=pg_catalog as $$
declare row jsonb; line jsonb; e jsonb; field text; value jsonb;
  row_keys text[]:=array['contractKey','subscriberKey','status','nextBillingAt','currencyCode',
    'billingInterval','billingIntervalCount','isPrepaid','lines','sourceUpdatedAt'];
begin
  if jsonb_typeof(p) is distinct from 'object' or
    p-array['version','asOf','state','scopeComplete','rows','evidence']<>'{}'::jsonb or
    not(p ?& array['version','asOf','state','scopeComplete','rows','evidence']) or
    octet_length(p::text)>8000000 or p->'version' is distinct from '1'::jsonb or
    p->'scopeComplete' is distinct from 'false'::jsonb or
    coalesce(p->>'state','') not in ('pagination_ended','page_limit','row_limit') or
    (p->>'asOf')::timestamptz is distinct from r.started_at or
    jsonb_typeof(p->'rows') is distinct from 'array' or jsonb_array_length(p->'rows')>r.max_rows
    then raise exception 'subscription observation envelope'; end if;
  e:=p->'evidence';
  if jsonb_typeof(e) is distinct from 'object' or
    e-array['requests','bytes','rawRows','duplicates','startedAt','finishedAt','collectionHash']<>'{}'::jsonb or
    not(e ?& array['requests','bytes','rawRows','duplicates','startedAt','finishedAt','collectionHash']) or
    e->'requests' is distinct from '1'::jsonb or coalesce(e->>'collectionHash','') !~ '^[a-f0-9]{64}$'
    then raise exception 'subscription evidence'; end if;
  foreach field in array array['bytes','rawRows','duplicates'] loop
    value:=e->field;
    if jsonb_typeof(value) is distinct from 'number' or (value::text)::numeric<0 or
      (value::text)::numeric<>trunc((value::text)::numeric) then raise exception 'subscription evidence count'; end if;
  end loop;
  if (e->>'bytes')::numeric not between 1 and r.max_bytes or
    (e->>'rawRows')::numeric>least(r.max_rows,r.page_size) or
    (e->>'rawRows')::numeric<>(e->>'duplicates')::numeric+jsonb_array_length(p->'rows')
    then raise exception 'subscription evidence bounds'; end if;
  foreach field in array array['startedAt','finishedAt'] loop
    if coalesce(e->>field,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' or
      not isfinite((e->>field)::timestamptz) then raise exception 'subscription evidence clock'; end if;
  end loop;
  if (e->>'finishedAt')::timestamptz<(e->>'startedAt')::timestamptz or
    (e->>'finishedAt')::timestamptz>(e->>'startedAt')::timestamptz+interval '45 seconds'
    then raise exception 'subscription evidence clock'; end if;
  if (select count(distinct x->>'contractKey') from jsonb_array_elements(p->'rows') x)<>jsonb_array_length(p->'rows')
    then raise exception 'subscription duplicate key'; end if;
  for row in select * from jsonb_array_elements(p->'rows') loop
    if jsonb_typeof(row) is distinct from 'object' or row-row_keys<>'{}'::jsonb or not(row ?& row_keys) or
      jsonb_typeof(row->'contractKey')<>'string' or coalesce(row->>'contractKey','') !~ '^[a-f0-9]{64}$' or
      (row->'subscriberKey'<>'null'::jsonb and (jsonb_typeof(row->'subscriberKey')<>'string' or
        coalesce(row->>'subscriberKey','') !~ '^[a-f0-9]{64}$')) or
      jsonb_typeof(row->'status')<>'string' or coalesce(row->>'status','') not in ('ACTIVE','PAUSED','CANCELLED','EXPIRED') or
      (r.status_filter is not null and row->>'status' is distinct from r.status_filter) or
      (row->'currencyCode'<>'null'::jsonb and coalesce(row->>'currencyCode','') !~ '^[A-Z]{3}$') or
      (row->'billingInterval'<>'null'::jsonb and coalesce(row->>'billingInterval','') !~ '^[A-Z][A-Z_]{0,39}$') or
      jsonb_typeof(row->'isPrepaid') not in ('boolean','null') then raise exception 'subscription private row'; end if;
    foreach field in array array['nextBillingAt','sourceUpdatedAt'] loop
      if row->field<>'null'::jsonb and (coalesce(row->>field,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' or
        not isfinite((row->>field)::timestamptz)) then raise exception 'subscription row clock'; end if;
    end loop;
    if row->'billingIntervalCount'<>'null'::jsonb and (jsonb_typeof(row->'billingIntervalCount')<>'number' or
      (row->>'billingIntervalCount')::numeric not between 1 and 1200 or
      (row->>'billingIntervalCount')::numeric<>trunc((row->>'billingIntervalCount')::numeric))
      then raise exception 'subscription cadence'; end if;
    if row->'lines'<>'null'::jsonb then
      if jsonb_typeof(row->'lines')<>'array' or jsonb_array_length(row->'lines')>100
        then raise exception 'subscription lines'; end if;
      for line in select * from jsonb_array_elements(row->'lines') loop
        if jsonb_typeof(line) is distinct from 'object' or line-array['unitPrice','quantity']<>'{}'::jsonb or
          not(line ?& array['unitPrice','quantity']) or
          (line->'unitPrice'<>'null'::jsonb and (jsonb_typeof(line->'unitPrice')<>'string' or
            coalesce(line->>'unitPrice','') !~ '^[0-9]{1,14}\.[0-9]{6}$')) or
          (line->'quantity'<>'null'::jsonb and (jsonb_typeof(line->'quantity')<>'number' or
            (line->>'quantity')::numeric not between 1 and 100000 or
            (line->>'quantity')::numeric<>trunc((line->>'quantity')::numeric)))
          then raise exception 'subscription line projection'; end if;
      end loop;
    end if;
  end loop;
end $$;

create function public.lean_subscription_finish(p_run text,p_project text,p_token uuid,p_payload jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.subscription_runs; g lean_private.subscription_gate; h text;
begin
  select * into strict g from lean_private.subscription_gate where singleton for update;
  select * into r from lean_private.subscription_runs where run_id=p_run and project_ref=p_project for update;
  if not found then return false; end if;
  h:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  if r.payload is not null then
    if r.result_hash is distinct from h then raise exception 'subscription result immutable'; end if;
    return true;
  end if;
  if not g.enabled or not r.enabled or r.expires_at<=clock_timestamp() or p_token is null or
    g.lease_run is distinct from p_run or g.lease_token is distinct from p_token or
    g.lease_until<=clock_timestamp() or g.permits<>1 then return false; end if;
  perform lean_private.subscription_validate(p_payload,r);
  update lean_private.subscription_runs set payload=p_payload,result_hash=h,
    completed_at=clock_timestamp() where run_id=p_run;
  update lean_private.subscription_gate set lease_run=null,lease_token=null,lease_until=clock_timestamp(),
    next_allowed_at=clock_timestamp()+interval '1600 milliseconds',permits=0 where singleton;
  return true;
end $$;
create function public.lean_subscription_fail(p_run text,p_project text,p_token uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.subscription_runs; g lean_private.subscription_gate;
begin
  select * into strict g from lean_private.subscription_gate where singleton for update;
  select * into r from lean_private.subscription_runs where run_id=p_run and project_ref=p_project for update;
  if not found or r.payload is not null or p_token is null or g.lease_run is distinct from p_run or
    g.lease_token is distinct from p_token or g.lease_until<=clock_timestamp() then return false; end if;
  update lean_private.subscription_runs set last_error='source_or_projection_failed' where run_id=p_run;
  update lean_private.subscription_gate set lease_run=null,lease_token=null,lease_until=clock_timestamp(),
    next_allowed_at=clock_timestamp()+interval '1600 milliseconds',permits=0 where singleton;
  return true;
end $$;

-- Owner only. No runtime/service, application, reporting-reader or PostHog read grant.
create function public.lean_subscription_report(p_run text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare r lean_private.subscription_runs; g lean_private.subscription_gate; metrics jsonb;
begin
  select * into r from lean_private.subscription_runs where run_id=p_run;
  if not found then raise exception 'subscription run not found'; end if;
  select * into strict g from lean_private.subscription_gate where singleton;
  select jsonb_object_agg(name,jsonb_build_object('value',null,'readiness','withheld',
    'reasons',case when name in ('proposedMrr','proposedArr')
      then jsonb_build_array('scope_consistency_unverified','recurring_amount_authority_unverified')
      else jsonb_build_array('scope_consistency_unverified') end))
    into metrics from unnest(array['activeContracts','distinctSubscribers','nextRenewalAt',
      'renewingContractsInWindow','proposedMrr','proposedArr']) name;
  return jsonb_build_object('runId',r.run_id,'shop',r.shop,'projectRef',r.project_ref,
    'status',case when r.payload is not null then 'observation_saved' when not r.enabled or not g.enabled then 'disabled'
      when r.expires_at<=now() then 'expired' when r.last_error is not null then 'failed'
      when g.lease_run=r.run_id and g.lease_until>now() then 'leased'
      when r.attempts>0 then 'attempted' else 'registered' end,
    'runEnabled',r.enabled,'gateEnabled',g.enabled,'expiresAt',r.expires_at,'lastError',r.last_error,
    'bindingRef',r.binding_ref,'approvalRef',r.approval_ref,'trafficApprovalRef',r.traffic_approval_ref,
    'attempts',r.attempts,'definitionRef',r.policy->>'definitionRef','resultHash',r.result_hash,
    'selection',jsonb_build_object('apiVersion','2026-04','statusFilter',r.status_filter,
      'maxPages',1,'pageSize',r.page_size,'maxRows',r.max_rows,'maxBytes',r.max_bytes),
    'targetBinding','owner_attested_not_provider_verified','scopeComplete',false,'certified',false,
    'definitionStatus','proposed','historicalTrendsSupported',false,
    'metrics',metrics,'observation',r.payload);
end $$;

revoke all on function lean_private.subscription_scope_immutable(),
  lean_private.subscription_validate(jsonb,lean_private.subscription_runs),
  public.lean_subscription_claim(text,text,uuid),public.lean_subscription_permit(text,text,uuid),
  public.lean_subscription_finish(text,text,uuid,jsonb),public.lean_subscription_fail(text,text,uuid),
  public.lean_subscription_report(text) from public,anon,authenticated,service_role;
grant execute on function public.lean_subscription_claim(text,text,uuid),
  public.lean_subscription_permit(text,text,uuid),public.lean_subscription_finish(text,text,uuid,jsonb),
  public.lean_subscription_fail(text,text,uuid) to service_role;
-- Close a known optional reporting role without creating it or depending on 023.
do $$ begin
  if exists(select 1 from pg_roles where rolname='lean_posthog_reader') then
    revoke all on lean_private.subscription_runs,lean_private.subscription_gate from lean_posthog_reader;
    revoke all on function lean_private.subscription_scope_immutable(),
      lean_private.subscription_validate(jsonb,lean_private.subscription_runs),
      public.lean_subscription_claim(text,text,uuid),public.lean_subscription_permit(text,text,uuid),
      public.lean_subscription_finish(text,text,uuid,jsonb),public.lean_subscription_fail(text,text,uuid),
      public.lean_subscription_report(text) from lean_posthog_reader;
  end if;
end $$;
-- A previously unknown default grantee must fail the whole installation, not
-- silently gain report/data access. Do not change unrelated/default privileges.
do $$ begin
  if exists(
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    where n.nspname='lean_private' and c.relname in ('subscription_runs','subscription_gate')
      and a.grantee<>c.relowner
  ) or exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where ((n.nspname='lean_private' and p.proname in ('subscription_scope_immutable','subscription_validate'))
      or (n.nspname='public' and p.proname in ('lean_subscription_claim','lean_subscription_permit',
        'lean_subscription_finish','lean_subscription_fail','lean_subscription_report')))
      and a.grantee<>p.proowner and not(n.nspname='public' and
        p.proname in ('lean_subscription_claim','lean_subscription_permit','lean_subscription_finish','lean_subscription_fail')
        and a.grantee='service_role'::regrole and a.privilege_type='EXECUTE' and not a.is_grantable)
  ) then raise exception 'unexpected subscription ACL; owner review required'; end if;
end $$;
commit;
