-- REVIEW ONLY. Apply after 016. No enabled scope, schedule, subscription or login is created.
begin;
create table lean_private.pipeline_scope (
  shop text primary key check(shop ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  project_ref text not null check(project_ref ~ '^[a-z]{20}$'),
  enabled boolean not null default false,
  from_time timestamptz not null, until_time timestamptz not null,
  policy jsonb not null check(jsonb_typeof(policy)='object'),
  approval_ref text not null check(length(trim(approval_ref))>0),
  actor_ref text not null check(length(trim(actor_ref))>0),
  check(from_time<until_time),
  check(coalesce(policy->>'financialApprovalRef','')<>''),
  check(coalesce(policy#>>'{decision,approvalRef}','')<>''),
  check(policy->>'saleClock' is not distinct from 'paid_at' and policy->>'refundClock' is not distinct from 'refund_created_at'),
  check(jsonb_typeof(policy->'productClasses') is not distinct from 'object')
);
create table lean_private.pipeline_snapshots (
  work_id bigint primary key references lean_private.work,
  shop text not null references lean_private.pipeline_scope,
  publication_id text not null unique references lean_private.publications,
  policy jsonb not null, from_time timestamptz not null, until_time timestamptz not null,
  source jsonb, order_gid text, revision timestamptz,
  check((source is null)=(order_gid is null) and (source is null)=(revision is null))
);
create table lean_private.pipeline_heads (
  shop text not null, order_gid text not null,
  work_id bigint not null references lean_private.pipeline_snapshots,
  revision timestamptz not null, source jsonb not null,
  primary key(shop,order_gid)
);
create table lean_private.pipeline_operator_audit (
  audit_id bigint generated always as identity primary key,
  event text not null, work_id bigint, previous_state jsonb not null,
  approval_ref text not null check(length(trim(approval_ref))>0),
  actor_ref text not null check(length(trim(actor_ref))>0),
  created_at timestamptz not null default clock_timestamp()
);
alter table lean_private.pipeline_scope enable row level security;
alter table lean_private.pipeline_snapshots enable row level security;
alter table lean_private.pipeline_heads enable row level security;
alter table lean_private.pipeline_operator_audit enable row level security;
revoke all on lean_private.pipeline_scope,lean_private.pipeline_snapshots,lean_private.pipeline_heads,
  lean_private.pipeline_operator_audit from public,service_role;
create function lean_private.pipeline_scope_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if old.shop is distinct from new.shop or old.project_ref is distinct from new.project_ref then
    raise exception 'pipeline target immutable';
  end if;
  if (to_jsonb(old)-'enabled') is distinct from (to_jsonb(new)-'enabled') then
    if old.approval_ref=new.approval_ref then raise exception 'new scope approval required'; end if;
    insert into lean_private.pipeline_operator_audit(event,previous_state,approval_ref,actor_ref)
      values('scope_revision',to_jsonb(old),new.approval_ref,new.actor_ref);
  end if;
  return new;
end $$;
create trigger frozen_pipeline_scope before update on lean_private.pipeline_scope
  for each row execute function lean_private.pipeline_scope_immutable();
-- Bad historical envelopes cannot poison queue scans.
create function lean_private.receipt_shop(p_key text) returns text
language plpgsql immutable set search_path=pg_catalog as $$
begin
  if jsonb_typeof(p_key::jsonb)<>'array' then return null; end if;
  return p_key::jsonb->>0;
exception when others then return null;
end $$;
create function public.lean_pipeline_claim(p_token uuid,p_project_ref text,p_shop text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare cfg lean_private.pipeline_scope; w lean_private.work; r lean_private.receipts;
  s lean_private.pipeline_snapshots;
begin
  if p_token is null then raise exception 'token required'; end if;
  select * into cfg from lean_private.pipeline_scope where shop=p_shop and project_ref=p_project_ref for share;
  if not found then raise exception 'unapproved target'; end if;
  if not cfg.enabled then return jsonb_build_object('state','disabled'); end if;
  update lean_private.work x set state='dead',lease_token=null,lease_until=null,last_error_code='attempts_exhausted'
    from lean_private.receipts y where x.receipt_id=y.receipt_id and lean_private.receipt_shop(y.business_key)=p_shop
      and x.state='leased' and x.lease_until<=clock_timestamp() and x.attempts>=5;
  select x.* into w from lean_private.work x join lean_private.receipts y on y.receipt_id=x.receipt_id
    where y.source='shopify' and lean_private.receipt_shop(y.business_key)=p_shop and x.attempts<5
      and ((x.state='pending' and x.available_at<=clock_timestamp()) or
           (x.state='leased' and x.lease_until<=clock_timestamp()))
    order by x.available_at,x.work_id for update of x skip locked limit 1;
  if not found then return jsonb_build_object('state','idle'); end if;
  select * into strict r from lean_private.receipts where receipt_id=w.receipt_id;
  insert into lean_private.publications(publication_id,contract_version)
    values('shopify:'||w.receipt_id,'lean-v1-draft.1') on conflict do nothing;
  insert into lean_private.pipeline_snapshots(work_id,shop,publication_id,policy,from_time,until_time)
    values(w.work_id,p_shop,'shopify:'||w.receipt_id,cfg.policy,cfg.from_time,cfg.until_time) on conflict do nothing;
  select * into strict s from lean_private.pipeline_snapshots where work_id=w.work_id;
  update lean_private.work set state='leased',attempts=attempts+1,lease_token=p_token::text,
    lease_until=clock_timestamp()+interval '120 seconds' where work_id=w.work_id;
  return jsonb_build_object('state','claimed','workId',w.work_id::text,'topic',r.topic,'payload',r.payload,
    'source',s.source,'policy',s.policy,'publication',s.publication_id,'fromTime',s.from_time,'untilTime',s.until_time);
end $$;
create function public.lean_pipeline_retain(p_work_id bigint,p_token uuid,p_source jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare w lean_private.work; s lean_private.pipeline_snapshots; r lean_private.receipts;
  gid text; rev timestamptz; expected text; refund_id text;
begin
  select * into w from lean_private.work where work_id=p_work_id for update;
  if not found or p_token is null or w.state<>'leased' or w.lease_token is distinct from p_token::text
    or w.lease_until<=clock_timestamp() then return false; end if;
  select * into strict s from lean_private.pipeline_snapshots where work_id=p_work_id;
  select * into strict r from lean_private.receipts where receipt_id=w.receipt_id;
  gid := p_source#>>'{commerce,order,id}'; rev := (p_source#>>'{commerce,order,updatedAt}')::timestamptz;
  if p_source is null or jsonb_typeof(p_source)<>'object' or
    p_source#>>'{commerce,shop}' is distinct from s.shop or
    p_source#>>'{commerce,apiVersion}' is distinct from '2026-07' or
    gid is null or gid !~ '^gid://shopify/Order/[1-9][0-9]*$' or rev is null or not isfinite(rev)
    then raise exception 'invalid source scope'; end if;
  expected := case when r.topic='refunds/create' then r.payload->>'order_id'
    else coalesce(r.payload->>'admin_graphql_api_id',r.payload->>'id') end;
  if expected ~ '^[1-9][0-9]*$' then expected := 'gid://shopify/Order/'||expected; end if;
  if gid is distinct from expected then raise exception 'receipt order mismatch'; end if;
  if r.topic='refunds/create' then
    refund_id := coalesce(r.payload->>'admin_graphql_api_id',r.payload->>'id');
    if refund_id ~ '^[1-9][0-9]*$' then refund_id := 'gid://shopify/Refund/'||refund_id; end if;
    if not exists(select 1 from jsonb_array_elements(p_source->'refunds') x where x->>'id'=refund_id)
      then raise exception 'refund not visible'; end if;
  end if;
  if r.topic<>'refunds/create' and r.payload->>'updated_at' is not null and
    rev<(r.payload->>'updated_at')::timestamptz then raise exception 'source behind event'; end if;
  if s.source is not null and s.source is distinct from p_source then raise exception 'source immutable'; end if;
  update lean_private.pipeline_snapshots set source=p_source,order_gid=gid,revision=rev where work_id=p_work_id;
  return true;
end $$;
create function public.lean_pipeline_finish(p_work_id bigint,p_token uuid,p_facts jsonb,p_reports jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare w lean_private.work; s lean_private.pipeline_snapshots; h lean_private.pipeline_heads;
  row jsonb; t text; order_key text; advance boolean;
begin
  -- Same scope-before-work lock order as claim avoids a claim/finish deadlock.
  perform 1 from lean_private.pipeline_scope c join lean_private.pipeline_snapshots x on x.shop=c.shop
    where x.work_id=p_work_id and c.enabled for update of c;
  if not found then return false; end if;
  select * into w from lean_private.work where work_id=p_work_id for update;
  if not found or p_token is null or w.state<>'leased' or w.lease_token is distinct from p_token::text
    or w.lease_until<=clock_timestamp() then return false; end if;
  select * into strict s from lean_private.pipeline_snapshots where work_id=p_work_id;
  if s.source is null then raise exception 'retain source first'; end if;
  if p_facts is null or jsonb_typeof(p_facts)<>'object' or
    jsonb_typeof(p_facts->'orders') is distinct from 'array' or jsonb_array_length(p_facts->'orders')<>1 or
    p_reports is null or jsonb_typeof(p_reports)<>'array' or jsonb_array_length(p_reports) not between 1 and 4
    then raise exception 'invalid pipeline batch'; end if;
  row := p_facts->'orders'->0; order_key := row->>'order_id';
  if row->>'shop_id' is distinct from s.shop or
    'gid://shopify/Order/'||(row->>'source_order_id') is distinct from s.order_gid or
    (row->>'source_updated_at')::timestamptz is distinct from s.revision or
    row->>'eligibility_status' is distinct from 'eligible' or row->>'source_currency' is distinct from 'USD' or
    (row->>'created_at')::timestamptz<s.from_time or (row->>'created_at')::timestamptz>=s.until_time
    then raise exception 'fact scope mismatch'; end if;
  select * into h from lean_private.pipeline_heads where shop=s.shop and order_gid=s.order_gid;
  advance := not found or s.revision>h.revision;
  if h.revision=s.revision and h.source is distinct from s.source then raise exception 'same revision conflict'; end if;
  foreach t in array array['customers','identity_map','order_item_offers','sessions','marketing_spend_daily','order_attribution'] loop
    if p_facts->t is distinct from '[]'::jsonb then raise exception 'unsupported domain'; end if;
  end loop;
  foreach t in array array['orders','order_items','sales_ledger','payments'] loop
    if jsonb_typeof(p_facts->t) is distinct from 'array' or jsonb_array_length(p_facts->t)=0 then raise exception 'missing facts'; end if;
    for row in select value from jsonb_array_elements(p_facts->t) loop
      if row->>'publication_id' is distinct from s.publication_id or row->>'order_id' is distinct from order_key
        then raise exception 'mixed scope'; end if;
      if t='payments' and (row->'cash_eligible' is distinct from 'false'::jsonb or
        row->'cash_amount_usd' is distinct from 'null'::jsonb or row->'settled_at' is distinct from 'null'::jsonb)
        then raise exception 'settlement unproven'; end if;
    end loop;
    execute format('insert into lean_private.%I select * from jsonb_populate_recordset(null::lean_private.%I,$1)',t,t)
      using p_facts->t;
  end loop;
  for row in select value from jsonb_array_elements(p_reports) loop
    if row->>'publication_id' is distinct from s.publication_id or row->>'shop_id' is distinct from s.shop or
      row->>'definition_version' is distinct from 'shopify-observed-v1' or
      row->'collected_cash_usd' is distinct from 'null'::jsonb or row->'new_customers' is distinct from 'null'::jsonb or
      row->'spend_usd' is distinct from 'null'::jsonb or row->'ncac_usd' is distinct from 'null'::jsonb or
      row->'mer' is distinct from 'null'::jsonb then raise exception 'invalid observed report'; end if;
  end loop;
  insert into lean_private.report_store_daily
    select * from jsonb_populate_recordset(null::lean_private.report_store_daily,p_reports);
  if advance then
    insert into lean_private.pipeline_heads(shop,order_gid,work_id,revision,source)
      values(s.shop,s.order_gid,s.work_id,s.revision,s.source)
      on conflict(shop,order_gid) do update set work_id=excluded.work_id,revision=excluded.revision,source=excluded.source;
  end if;
  update lean_private.work set state='done',completed_at=clock_timestamp(),lease_token=null,lease_until=null,
    last_error_code=null where work_id=p_work_id;
  return true;
end $$;
create function public.lean_pipeline_fail(p_work_id bigint,p_token uuid,p_code text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
  if p_code is null or p_code not in ('invalid_receipt','source_unavailable','mapping_rejected') then raise exception 'invalid safe code'; end if;
  update lean_private.work set state=case when attempts>=5 then 'dead' else 'pending' end,
    available_at=clock_timestamp()+make_interval(secs=>least(3600,30*power(2,attempts-1)::integer)),
    lease_token=null,lease_until=null,last_error_code=p_code
    where work_id=p_work_id and state='leased' and lease_token=p_token::text and lease_until>clock_timestamp();
  return found;
end $$;
create function public.lean_pipeline_health(p_project_ref text,p_shop text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb; enabled boolean;
begin
  select c.enabled into enabled from lean_private.pipeline_scope c where shop=p_shop and project_ref=p_project_ref;
  if not found then raise exception 'unapproved target'; end if;
  select jsonb_build_object('enabled',enabled,'pending',count(*) filter(where w.state='pending'),
    'leased',count(*) filter(where w.state='leased'),'dead',count(*) filter(where w.state='dead'),
    'done',count(*) filter(where w.state='done'),
    'oldestPendingSeconds',coalesce(extract(epoch from clock_timestamp()-min(r.received_at)
      filter(where w.state in ('pending','leased'))),0),
    'expiredLeases',count(*) filter(where w.state='leased' and w.lease_until<=clock_timestamp()))
    into result from lean_private.work w join lean_private.receipts r using(receipt_id)
      where lean_private.receipt_shop(r.business_key)=p_shop;
  return result;
end $$;
-- Operator-only, audited repair for dead work. A refreshed snapshot's old source
-- remains durable in the audit table; done work can never be rewritten.
create function public.lean_pipeline_retry(p_work_id bigint,p_refresh boolean,p_approval text,p_actor text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare w lean_private.work; s lean_private.pipeline_snapshots; cfg lean_private.pipeline_scope;
begin
  if p_refresh is null or p_approval is null or length(trim(p_approval))=0 or
    p_actor is null or length(trim(p_actor))=0 then raise exception 'approval required'; end if;
  select c.* into cfg from lean_private.pipeline_scope c join lean_private.pipeline_snapshots x on x.shop=c.shop
    where x.work_id=p_work_id for update of c;
  if not found then return false; end if;
  select * into w from lean_private.work where work_id=p_work_id for update;
  if w.state<>'dead' then return false; end if;
  select * into strict s from lean_private.pipeline_snapshots where work_id=p_work_id;
  if exists(select 1 from lean_private.orders where publication_id=s.publication_id) or
    exists(select 1 from lean_private.report_store_daily where publication_id=s.publication_id)
    then raise exception 'materialized facts immutable'; end if;
  insert into lean_private.pipeline_operator_audit(event,work_id,previous_state,approval_ref,actor_ref)
    values('retry',p_work_id,to_jsonb(s),p_approval,p_actor);
  if p_refresh then
    update lean_private.pipeline_snapshots set source=null,order_gid=null,revision=null,
      policy=cfg.policy,from_time=cfg.from_time,until_time=cfg.until_time where work_id=p_work_id;
  end if;
  update lean_private.work set state='pending',attempts=0,available_at=clock_timestamp(),
    lease_token=null,lease_until=null,completed_at=null,last_error_code=null where work_id=p_work_id;
  return true;
end $$;
-- Latest successful snapshot per order, never a sum across historical revisions.
-- A failed, pending or dead delivery explicitly marks the shop's output stale.
create view lean_analytics.observed_order_daily with(security_barrier=true) as
select r.*, h.order_gid, h.revision as source_revision, 'unverified'::text as certification,
  'webhook_observed_only'::text as coverage,
  (not cfg.enabled or s.policy is distinct from cfg.policy or
    s.from_time is distinct from cfg.from_time or s.until_time is distinct from cfg.until_time or
    exists(select 1 from lean_private.work w join lean_private.receipts q using(receipt_id)
    where lean_private.receipt_shop(q.business_key)=h.shop and w.state<>'done')) as pipeline_stale
from lean_private.pipeline_heads h join lean_private.pipeline_snapshots s using(work_id)
join lean_private.report_store_daily r on r.publication_id=s.publication_id
join lean_private.pipeline_scope cfg on cfg.shop=h.shop;
revoke all on lean_analytics.observed_order_daily from public;
create role lean_observed_reader nologin noinherit;
grant usage on schema lean_analytics to lean_observed_reader;
grant select on lean_analytics.observed_order_daily to lean_observed_reader;
-- Prevent an older generic worker from consuming this same queue concurrently.
alter function public.lean_claim_work(text,integer,integer) set schema lean_private;
revoke all on function lean_private.lean_claim_work(text,integer,integer) from public,service_role;
create function public.lean_claim_work(p_token text,p_limit integer,p_lease_seconds integer)
returns table(work_id bigint,receipt_id bigint,topic text,payload jsonb,attempts integer)
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if exists(select 1 from lean_private.pipeline_scope where enabled) or
    exists(select 1 from lean_private.pipeline_snapshots) then raise exception 'use pipeline worker for registered queue'; end if;
  return query select * from lean_private.lean_claim_work(p_token,p_limit,p_lease_seconds);
end $$;
-- Completed materializations are immutable. Retry dead work, not completed snapshots.
alter function public.lean_replay_work(bigint,text,text) set schema lean_private;
revoke all on function lean_private.lean_replay_work(bigint,text,text) from public,service_role;
create function public.lean_replay_work(p_work_id bigint,p_approval text,p_actor text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
  if exists(select 1 from lean_private.pipeline_snapshots where work_id=p_work_id)
    then raise exception 'use audited pipeline retry; completed snapshot immutable'; end if;
  return lean_private.lean_replay_work(p_work_id,p_approval,p_actor);
end $$;
-- Close Supabase default function grants, including earlier migration functions.
do $$
declare f regprocedure; role_name text;
begin
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace
    and starts_with(proname,'lean_') loop
    execute format('revoke all on function %s from public',f);
    foreach role_name in array array['anon','authenticated'] loop
      if exists(select 1 from pg_roles where rolname=role_name) then
        execute format('revoke all on function %s from %I',f,role_name);
      end if;
    end loop;
  end loop;
  foreach role_name in array array['anon','authenticated'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on lean_analytics.observed_order_daily from %I',role_name);
      execute format('revoke all on lean_private.pipeline_scope,lean_private.pipeline_snapshots,lean_private.pipeline_heads,lean_private.pipeline_operator_audit from %I',role_name);
      execute format('revoke all on function lean_private.lean_claim_work(text,integer,integer) from %I',role_name);
      execute format('revoke all on function lean_private.lean_replay_work(bigint,text,text) from %I',role_name);
    end if;
  end loop;
end $$;
revoke all on function public.lean_replay_work(bigint,text,text) from service_role;
revoke all on function public.lean_pipeline_retry(bigint,boolean,text,text) from service_role;
revoke all on function public.lean_select_publication(text,text,text,text) from service_role;
grant execute on function public.lean_claim_work(text,integer,integer) to service_role;
grant execute on function public.lean_pipeline_claim(uuid,text,text) to service_role;
grant execute on function public.lean_pipeline_retain(bigint,uuid,jsonb) to service_role;
grant execute on function public.lean_pipeline_finish(bigint,uuid,jsonb,jsonb) to service_role;
grant execute on function public.lean_pipeline_fail(bigint,uuid,text) to service_role;
grant execute on function public.lean_pipeline_health(text,text) to service_role;
commit;
