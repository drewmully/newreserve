-- PRIVATE REVIEW ONLY. Requires current P3 functions, not renamed historical aliases.
-- No policy, source, schedule, recipient, budget or enabled authority is seeded.
begin;
do $$
begin
  if (select proowner from pg_proc where oid=
    'public.lean_google_delivery_select(text,text,text,text,bigint,text,text,timestamptz,timestamptz,boolean)'::regprocedure)
    is distinct from current_user::regrole::oid or
    exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role','lean_posthog_reader')
      and (rolsuper or pg_has_role(oid,current_user,'MEMBER')))
    then raise exception 'standing installer owner required'; end if;
end $$;

create table lean_private.google_standing_policy (
  policy_id text primary key check(policy_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  revision bigint not null check(revision>0),
  enabled boolean not null default false,
  revoked boolean not null default false,
  project_ref text not null check(project_ref='xnfjdbpjuaezxjgargto'),
  shop text not null check(shop='mullybox-store.myshopify.com'),
  account_id text not null check(account_id ~ '^[0-9]{10}$'),
  login_customer_id text not null check(login_customer_id ~ '^[0-9]{10}$'),
  from_date date not null, through_date date not null,
  not_before timestamptz not null, expires_at timestamptz not null,
  max_generations integer not null check(max_generations between 1 and 1000),
  max_steps_per_run integer not null check(max_steps_per_run between 1 and 128),
  min_interval_seconds integer not null check(min_interval_seconds between 1 and 86400),
  step_timeout_seconds integer not null check(step_timeout_seconds between 1 and 80),
  selection_seconds integer not null check(selection_seconds between 1 and 3600),
  max_source_age_seconds integer not null check(max_source_age_seconds between 1 and 86400),
  max_import_age_seconds integer not null check(max_import_age_seconds between 1 and 3600),
  destination_project text not null check(destination_project='353503'),
  destination_source uuid not null, destination_table uuid not null,
  approval_ref text not null check(length(trim(approval_ref)) between 1 and 512),
  actor_ref text not null check(length(trim(actor_ref)) between 1 and 512),
  -- Initial value is explicitly bound by owner to the existing singleton revision.
  selection_revision bigint not null check(selection_revision>=0),
  generations integer not null default 0,
  last_run text, last_asof timestamptz, last_source_at timestamptz, last_selected_at timestamptz,
  check(isfinite(from_date) and isfinite(through_date) and through_date>=from_date),
  check(isfinite(not_before) and isfinite(expires_at) and expires_at>not_before),
  check(generations between 0 and max_generations)
);
-- Existing Google delivery has one singleton. Do not allow competing policies.
create unique index google_standing_one_enabled on lean_private.google_standing_policy((true)) where enabled;
create table lean_private.google_standing_runs (
  run_id text primary key references lean_private.full_builds,
  policy_id text not null references lean_private.google_standing_policy,
  policy_revision bigint not null, enqueued_at timestamptz not null default clock_timestamp(),
  state text not null default 'pending' check(state in ('pending','leased','complete','failed')),
  steps integer not null default 0, token uuid, deadline timestamptz,
  completed_at timestamptz, full_result_hash text, row_hash text,
  -- Owner binds actual independent evidence before automatic execution.
  reconciliation_ref text not null check(length(trim(reconciliation_ref)) between 1 and 512),
  check((state='leased')=(token is not null and deadline is not null))
);
create table lean_private.google_standing_imports (
  policy_id text not null references lean_private.google_standing_policy,
  run_id text not null references lean_private.google_standing_runs,
  selection_revision bigint not null, job_id text not null check(length(trim(job_id)) between 1 and 512),
  evidence_ref text not null check(length(trim(evidence_ref)) between 1 and 512),
  started_at timestamptz not null, completed_at timestamptz not null, checked_at timestamptz not null,
  rows_sha256 text not null check(rows_sha256 ~ '^[a-f0-9]{64}$'),
  primary key(policy_id,job_id),
  check(isfinite(started_at) and isfinite(completed_at) and isfinite(checked_at)
    and started_at<=completed_at and completed_at<=checked_at)
);
alter table lean_private.google_standing_policy enable row level security;
alter table lean_private.google_standing_runs enable row level security;
alter table lean_private.google_standing_imports enable row level security;
revoke all on lean_private.google_standing_policy,lean_private.google_standing_runs,lean_private.google_standing_imports
  from public,anon,authenticated,service_role,lean_posthog_reader;

create function lean_private.google_standing_policy_guard() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' or
    (to_jsonb(old)-array['enabled','selection_revision','generations','last_run','last_asof','last_source_at','last_selected_at'])
      is distinct from
    (to_jsonb(new)-array['enabled','selection_revision','generations','last_run','last_asof','last_source_at','last_selected_at'])
    then raise exception 'new immutable standing policy required'; end if;
  if old.enabled=false and new.enabled=true and
    (old.revoked or old.generations>0 or exists(select 1 from lean_private.google_standing_runs
      where policy_id=old.policy_id and (steps>0 or state<>'pending')))
    then raise exception 'revoked standing policy cannot resume'; end if;
  new.revoked:=old.revoked or (old.enabled and not new.enabled);
  if old.enabled and not new.enabled then
    update lean_private.google_delivery_selection set enabled=false
      where singleton and revision=old.selection_revision and run_id=old.last_run;
  end if;
  return new;
end $$;
create trigger google_standing_policy_guard before update or delete on lean_private.google_standing_policy
  for each row execute function lean_private.google_standing_policy_guard();

create function lean_private.google_standing_audit_guard()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_table_name='google_standing_imports' or tg_op='DELETE' then raise exception 'standing audit immutable'; end if;
  if old.state in ('complete','failed') or
    (to_jsonb(old)-array['state','steps','token','deadline','completed_at','full_result_hash','row_hash'])
      is distinct from
    (to_jsonb(new)-array['state','steps','token','deadline','completed_at','full_result_hash','row_hash'])
    then raise exception 'standing run immutable'; end if;
  return new;
end $$;
create trigger google_standing_run_guard before update or delete on lean_private.google_standing_runs
  for each row execute function lean_private.google_standing_audit_guard();
create trigger google_standing_import_guard before update or delete on lean_private.google_standing_imports
  for each row execute function lean_private.google_standing_audit_guard();

-- Owner-only admission of an already approved/enabled immutable full-run inventory.
-- Does not register, enable, reset or invent any source input.
create function public.lean_google_standing_enqueue(p_policy text,p_revision bigint,p_run text,p_reconciliation text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.google_standing_policy; f lean_private.full_builds; b lean_private.report_builds; m jsonb;
begin
  select * into strict p from lean_private.google_standing_policy where policy_id=p_policy for update;
  if p.revision is distinct from p_revision or clock_timestamp()>=p.expires_at then raise exception 'standing policy unavailable'; end if;
  select * into strict f from lean_private.full_builds where run_id=p_run for share;
  select * into strict b from lean_private.report_builds where run_id=f.base_run for share;
  m:=f.policy#>'{freshGoogleSpend,manifest}';
  if not f.enabled or not b.enabled or f.project_ref<>p.project_ref or b.project_ref<>p.project_ref or b.shop<>p.shop or
    f.completed_at is not null or f.attempts<>0 or f.lease_token is not null or
    b.from_date<>b.through_date or b.from_date not between p.from_date and p.through_date or
    cardinality(b.spend_runs)<>1 or m->>'accountId' is distinct from p.account_id or
    m->>'loginCustomerId' is distinct from p.login_customer_id or
    f.policy#>>'{googleDelivery,accountId}' is distinct from p.account_id or
    f.policy#>>'{googleDelivery,date}' is distinct from b.from_date::text or
    (f.policy->>'asOf')::timestamptz is null or
    (f.policy->>'asOf')::timestamptz not between p.not_before and p.expires_at or
    (select count(*) from lean_private.google_standing_runs where policy_id=p_policy)>=p.max_generations
    then raise exception 'standing run scope'; end if;
  if exists(select 1 from lean_private.google_standing_runs r join lean_private.full_builds old on old.run_id=r.run_id
    where r.policy_id=p_policy and (old.policy->>'asOf')::timestamptz>=(f.policy->>'asOf')::timestamptz)
    then raise exception 'nonprogressing generation'; end if;
  insert into lean_private.google_standing_runs(run_id,policy_id,policy_revision,reconciliation_ref)
    values(p_run,p_policy,p_revision,p_reconciliation);
  return true;
end $$;

-- All runtime mutations serialize on the policy row. A lost lease stays held.
create function public.lean_google_standing_next(p_project_ref text,p_policy text,p_revision bigint,p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.google_standing_policy; r lean_private.google_standing_runs; cutoff timestamptz;
begin
  if current_setting('transaction_isolation')<>'read committed' or p_token is null then raise exception 'standing context'; end if;
  select * into p from lean_private.google_standing_policy where policy_id=p_policy and project_ref=p_project_ref for update;
  if not found or p.revision is distinct from p_revision or not p.enabled or clock_timestamp()<p.not_before or clock_timestamp()>=p.expires_at
    then return jsonb_build_object('state','disabled'); end if;
  if exists(select 1 from lean_private.google_standing_runs where policy_id=p_policy and state in ('leased','failed'))
    then return jsonb_build_object('state','held'); end if;
  if p.generations>=p.max_generations then return jsonb_build_object('state','exhausted'); end if;
  if p.last_selected_at+make_interval(secs=>p.min_interval_seconds)>clock_timestamp()
    then return jsonb_build_object('state','not_due'); end if;
  select x.* into r from lean_private.google_standing_runs x join lean_private.full_builds f using(run_id)
    where x.policy_id=p_policy and x.policy_revision=p_revision and x.state='pending'
    order by (f.policy->>'asOf')::timestamptz,x.run_id limit 1 for update of x;
  if not found then return jsonb_build_object('state','idle'); end if;
  if r.steps>=p.max_steps_per_run then return jsonb_build_object('state','exhausted'); end if;
  cutoff:=least(p.expires_at,clock_timestamp()+make_interval(secs=>p.step_timeout_seconds));
  update lean_private.google_standing_runs set state='leased',steps=steps+1,token=p_token,deadline=cutoff where run_id=r.run_id;
  return jsonb_build_object('state','ready','runId',r.run_id,'deadline',cutoff);
end $$;

-- Reconcile stored native bases against the independently retained campaign AND
-- account controls, then verify the saved optional values. No provider claim is minted.
create function lean_private.google_standing_candidate(p_policy text,p_run text)
returns timestamptz language plpgsql set search_path=pg_catalog as $$
declare p lean_private.google_standing_policy; f lean_private.full_builds; b lean_private.report_builds;
  j lean_private.spend_jobs; g lean_private.report_google_account_daily; m jsonb; c jsonb; k jsonb; v jsonb;
  source_at timestamptz; asof timestamptz; due timestamptz; cost numeric; clicks numeric; impressions numeric;
begin
  select * into strict p from lean_private.google_standing_policy where policy_id=p_policy;
  select * into strict f from lean_private.full_builds where run_id=p_run for share;
  select * into strict b from lean_private.report_builds where run_id=f.base_run for share;
  select * into strict g from lean_private.report_google_account_daily where run_id=p_run for share;
  if not f.enabled or not b.enabled or f.completed_at is null or f.result_hash is distinct from g.full_result_hash or
    f.project_ref<>p.project_ref or b.shop<>p.shop or cardinality(b.spend_runs)<>1
    then raise exception 'standing result unavailable'; end if;
  select * into strict j from lean_private.spend_jobs where run_id=b.spend_runs[1] for share;
  m:=f.policy#>'{freshGoogleSpend,manifest}'; c:=f.policy#>'{freshGoogleSpend,controls,0}';
  k:=f.policy#>'{googleDelivery,control}'; v:=j.base;
  if v is null or not(v ?& array['provider','accountId','baseReportId','date','sourceCurrency','sourceTimezone',
    'completedAt','evidenceRef','paginationComplete','verifiedEmpty','rows']) or
    c is null or not(c ?& array['provider','accountId','date','sourceCurrency','sourceTimezone','capturedAt',
      'evidenceRef','complete','independentlyExtracted','verifiedEmpty','totalCostMicros','campaigns']) or
    k is null or not(k ?& array['evidenceRef','capturedAt','complete','independentlyExtracted',
      'clickDefinition','clicks','impressions','campaigns']) or
    jsonb_typeof(v->'rows') is distinct from 'array' or jsonb_typeof(c->'campaigns') is distinct from 'array' or
    jsonb_typeof(k->'campaigns') is distinct from 'array' or
    coalesce(length(trim(v->>'evidenceRef')),0)=0 or
    coalesce(c->>'totalCostMicros','')!~ '^(0|[1-9][0-9]{0,18})$' or
    coalesce(k->>'clicks','')!~ '^(0|[1-9][0-9]{0,15})$' or
    coalesce(k->>'impressions','')!~ '^(0|[1-9][0-9]{0,15})$'
    then raise exception 'standing evidence shape'; end if;
  source_at:=(v->>'completedAt')::timestamptz; asof:=(f.policy->>'asOf')::timestamptz;
  due:=(m#>>'{days,0,dueAt}')::timestamptz;
  if not j.enabled or j.last_error is not null or j.lease_token is not null or v is null or
    j.project_ref<>p.project_ref or j.account_id<>p.account_id or j.login_customer_id<>p.login_customer_id or
    j.report_date not between p.from_date and p.through_date or b.from_date<>j.report_date or b.through_date<>j.report_date or
    v->>'provider' is distinct from 'google_ads' or v->>'accountId' is distinct from p.account_id or
    v->>'baseReportId' is distinct from j.run_id or v->>'date' is distinct from j.report_date::text or
    v->>'sourceCurrency' is distinct from 'USD' or v->>'sourceTimezone' is distinct from 'America/New_York' or
    v->'paginationComplete' is distinct from 'true'::jsonb or v->'verifiedEmpty' is distinct from 'false'::jsonb or
    jsonb_array_length(v->'rows') not between 1 and 10000 or
    jsonb_array_length(f.policy#>'{freshGoogleSpend,controls}')<>1 or
    m->>'accountId' is distinct from p.account_id or m->>'loginCustomerId' is distinct from p.login_customer_id or
    source_at is null or not isfinite(source_at) or asof is null or not isfinite(asof) or due is null or
    source_at<due or source_at>asof or asof>clock_timestamp() or asof<p.not_before or asof>=p.expires_at or
    clock_timestamp()-source_at>make_interval(secs=>p.max_source_age_seconds) or
    clock_timestamp()>=(m->>'expiresAt')::timestamptz or
    p.last_asof is not null and (asof<=p.last_asof or source_at<=p.last_source_at) or
    p.last_run is not null and j.report_date<(select (report->>'report_date')::date from lean_private.report_google_account_daily where run_id=p.last_run)
    then raise exception 'standing source stale or nonprogressing'; end if;
  if c->>'provider' is distinct from 'google_ads' or c->>'accountId' is distinct from p.account_id or
    c->>'date' is distinct from j.report_date::text or c->>'sourceCurrency' is distinct from 'USD' or
    c->>'sourceTimezone' is distinct from 'America/New_York' or c->'verifiedEmpty' is distinct from 'false'::jsonb or
    k->>'clickDefinition' is distinct from 'google_ads.metrics.clicks'
    then raise exception 'standing control scope'; end if;
  foreach v in array array[c,k] loop
    if v->'complete' is distinct from 'true'::jsonb or v->'independentlyExtracted' is distinct from 'true'::jsonb or
      coalesce(length(trim(v->>'evidenceRef')),0)=0 or v->>'evidenceRef'=j.base->>'evidenceRef' or
      (v->>'capturedAt')::timestamptz is null or
      (v->>'capturedAt')::timestamptz<due or (v->>'capturedAt')::timestamptz>asof or
      clock_timestamp()-(v->>'capturedAt')::timestamptz>make_interval(secs=>p.max_source_age_seconds)
      then raise exception 'standing independent controls incomplete'; end if;
  end loop;
  if (select count(*)<>count(distinct r->>'campaignId') from jsonb_array_elements(j.base->'rows') r) or
    (select count(*)<>count(distinct r->>'id') from jsonb_array_elements(c->'campaigns') r) or
    (select count(*)<>count(distinct r->>'id') from jsonb_array_elements(k->'campaigns') r) or
    jsonb_array_length(c->'campaigns')<>jsonb_array_length(j.base->'rows') or
    jsonb_array_length(k->'campaigns')<>jsonb_array_length(j.base->'rows') or
    exists(select 1 from jsonb_array_elements(j.base->'rows') r
      left join lateral (select costs.value as x from jsonb_array_elements(c->'campaigns') costs(value)
        where costs.value->>'id'=r->>'campaignId') a on true
      left join lateral (select counts.value as x from jsonb_array_elements(k->'campaigns') counts(value)
        where counts.value->>'id'=r->>'campaignId') d on true
      where a.x is null or d.x is null or r->>'costMicros' is distinct from a.x->>'costMicros' or
        r->>'clicks' is distinct from d.x->>'clicks' or r->>'impressions' is distinct from d.x->>'impressions' or
        coalesce(r->>'costMicros','')!~ '^(0|[1-9][0-9]{0,18})$' or
        coalesce(r->>'clicks','')!~ '^(0|[1-9][0-9]{0,15})$' or coalesce(r->>'impressions','')!~ '^(0|[1-9][0-9]{0,15})$')
    then raise exception 'standing campaign control mismatch'; end if;
  select sum((r->>'costMicros')::numeric),sum((r->>'clicks')::numeric),sum((r->>'impressions')::numeric)
    into cost,clicks,impressions from jsonb_array_elements(j.base->'rows') r;
  if cost is distinct from (c->>'totalCostMicros')::numeric or clicks is distinct from (k->>'clicks')::numeric or
    impressions is distinct from (k->>'impressions')::numeric or clicks>9007199254740991 or impressions>9007199254740991 or
    not lean_private.google_delivery_row_valid(g.report) or
    (g.report->>'spend_usd')::numeric is distinct from cost/1000000 or
    (g.report->>'clicks')::numeric is distinct from clicks or (g.report->>'impressions')::numeric is distinct from impressions or
    (g.report->>'ctr')::numeric is distinct from trunc(clicks/nullif(impressions,0),6) or
    (g.report->>'cpc_usd')::numeric is distinct from trunc(cost/1000000/nullif(clicks,0),6) or
    (g.report->>'cpm_usd')::numeric is distinct from trunc(cost/1000/nullif(impressions,0),6) or
    g.report->>'account_id'<>p.account_id or g.report->>'report_date'<>j.report_date::text or
    g.report->>'publication_id'<>'full:'||p_run or (g.report->>'as_of_at')::timestamptz<>asof
    then raise exception 'standing account or saved output mismatch'; end if;
  return source_at;
end $$;

create function public.lean_google_standing_finish(p_project_ref text,p_policy text,p_revision bigint,p_run text,
  p_token uuid,p_state text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.google_standing_policy; r lean_private.google_standing_runs; f lean_private.full_builds;
  g lean_private.report_google_account_daily; source_at timestamptz; selected_revision bigint; until_time timestamptz;
begin
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'standing context'; end if;
  select * into strict p from lean_private.google_standing_policy where policy_id=p_policy and project_ref=p_project_ref for update;
  select * into strict r from lean_private.google_standing_runs where run_id=p_run and policy_id=p_policy for update;
  if not p.enabled or p.revision is distinct from p_revision or r.policy_revision is distinct from p_revision or
    clock_timestamp()<p.not_before or clock_timestamp()>=p.expires_at or
    r.state<>'leased' or p_token is null or r.token is distinct from p_token or clock_timestamp()>=r.deadline
    then raise exception 'standing lease unavailable'; end if;
  if p_state='partial' or p_state='not_due' then
    update lean_private.google_standing_runs set state='pending',token=null,deadline=null where run_id=p_run;
    return jsonb_build_object('state',p_state);
  end if;
  if p_state<>'complete' or p_state is null then
    update lean_private.google_standing_runs set state='failed',token=null,deadline=null where run_id=p_run;
    return jsonb_build_object('state','held');
  end if;
  -- Match the existing P3 finish/selector lock order before taking build locks.
  lock table lean_private.selected_publications in share row exclusive mode;
  source_at:=lean_private.google_standing_candidate(p_policy,p_run);
  select * into strict f from lean_private.full_builds where run_id=p_run;
  select * into strict g from lean_private.report_google_account_daily where run_id=p_run;
  until_time:=least(p.expires_at,clock_timestamp()+make_interval(secs=>p.selection_seconds),
    source_at+make_interval(secs=>p.max_source_age_seconds),
    (f.policy#>>'{freshGoogleSpend,controls,0,capturedAt}')::timestamptz+make_interval(secs=>p.max_source_age_seconds),
    (f.policy#>>'{googleDelivery,control,capturedAt}')::timestamptz+make_interval(secs=>p.max_source_age_seconds),
    (f.policy#>>'{freshGoogleSpend,manifest,expiresAt}')::timestamptz);
  -- Owner-authored policy is the narrowly delegated authority. The original
  -- owner-only selector ACL is unchanged and all its current privacy gates run.
  selected_revision:=public.lean_google_delivery_select(p_run,p.project_ref,g.full_result_hash,g.row_hash,
    p.selection_revision,p.approval_ref,r.reconciliation_ref,clock_timestamp(),until_time,false);
  update lean_private.google_delivery_selection set enabled=true where singleton and revision=selected_revision;
  update lean_private.google_standing_policy set generations=generations+1,last_run=p_run,
    last_asof=(f.policy->>'asOf')::timestamptz,last_source_at=source_at,last_selected_at=clock_timestamp(),
    selection_revision=selected_revision where policy_id=p_policy;
  update lean_private.google_standing_runs set state='complete',token=null,deadline=null,completed_at=clock_timestamp(),
    full_result_hash=g.full_result_hash,row_hash=g.row_hash where run_id=p_run;
  if clock_timestamp()>=r.deadline or clock_timestamp()>=until_time then raise exception 'standing finish expired'; end if;
  return jsonb_build_object('state','complete','selectionRevision',selected_revision::text);
end $$;

create function public.lean_google_standing_read(p_project_ref text,p_policy text,p_revision bigint,p_account_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.google_standing_policy; s lean_private.google_delivery_selection; result jsonb;
begin
  if current_setting('transaction_isolation')<>'read committed' then return null; end if;
  select * into p from lean_private.google_standing_policy where policy_id=p_policy and project_ref=p_project_ref for share;
  if not found or not p.enabled or p.revision is distinct from p_revision or p.account_id is distinct from p_account_id or
    clock_timestamp()<p.not_before or clock_timestamp()>=p.expires_at or p.last_run is null
    then return null; end if;
  lock table lean_private.selected_publications in share mode;
  select * into s from lean_private.google_delivery_selection where singleton for share;
  if not found or s.run_id<>p.last_run or s.revision<>p.selection_revision or
    s.account_id<>p.account_id or s.report_date not between p.from_date and p.through_date then return null; end if;
  result:=public.lean_google_delivery_read(p_project_ref,s.run_id,s.full_result_hash,p_account_id,s.report_date::text);
  if clock_timestamp()>=p.expires_at then return null; end if;
  return result;
end $$;

-- Owner-only admission of actual independent whole-table/import evidence. SQL
-- compares the supplied aggregate row; it never claims to have queried PostHog.
create function public.lean_google_standing_accept_import(p_policy text,p_revision bigint,p_evidence jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.google_standing_policy; body jsonb;
begin
  select * into strict p from lean_private.google_standing_policy where policy_id=p_policy for share;
  body:=public.lean_google_standing_read(p.project_ref,p_policy,p_revision,p.account_id);
  if body is null or jsonb_typeof(p_evidence) is distinct from 'object' or
    octet_length(p_evidence::text)>32768 or not(p_evidence ?& array['runId','selectionRevision','projectId','sourceId','tableId','resource',
    'jobId','status','startedAt','completedAt','checkedAt','evidenceRef','complete','wholeTable','unfiltered',
    'independentlyExtracted','nextCursor','rows']) or
    p_evidence-array['runId','selectionRevision','projectId','sourceId','tableId','resource','jobId','status',
      'startedAt','completedAt','checkedAt','evidenceRef','complete','wholeTable','unfiltered',
      'independentlyExtracted','nextCursor','rows']<>'{}'::jsonb or
    p_evidence->>'runId' is distinct from p.last_run or
    p_evidence->>'selectionRevision' is distinct from p.selection_revision::text or
    p_evidence->>'projectId' is distinct from p.destination_project or
    p_evidence->>'sourceId' is distinct from p.destination_source::text or p_evidence->>'tableId' is distinct from p.destination_table::text or
    p_evidence->>'resource' is distinct from 'google_account_daily' or p_evidence->>'status' is distinct from 'completed' or
    p_evidence->'complete' is distinct from 'true'::jsonb or p_evidence->'wholeTable' is distinct from 'true'::jsonb or
    p_evidence->'unfiltered' is distinct from 'true'::jsonb or p_evidence->'independentlyExtracted' is distinct from 'true'::jsonb or
    p_evidence->'nextCursor' is distinct from 'null'::jsonb or
    p_evidence->'rows' is distinct from body->'google_account_daily' or
    (p_evidence->>'startedAt')::timestamptz<p.last_selected_at or
    (p_evidence->>'checkedAt')::timestamptz>clock_timestamp() or
    clock_timestamp()-(p_evidence->>'checkedAt')::timestamptz>make_interval(secs=>p.max_import_age_seconds)
    then raise exception 'independent Google import evidence required'; end if;
  insert into lean_private.google_standing_imports values(p_policy,p.last_run,p.selection_revision,
    p_evidence->>'jobId',p_evidence->>'evidenceRef',(p_evidence->>'startedAt')::timestamptz,
    (p_evidence->>'completedAt')::timestamptz,(p_evidence->>'checkedAt')::timestamptz,
    encode(sha256(convert_to((p_evidence->'rows')::text,'UTF8')),'hex'));
  return true;
end $$;

create function public.lean_google_standing_health(p_project_ref text,p_policy text,p_revision bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.google_standing_policy; body jsonb; imported timestamptz; issues text[]:='{}';
begin
  select * into p from lean_private.google_standing_policy where policy_id=p_policy and project_ref=p_project_ref for share;
  if not found or p.revision is distinct from p_revision then return jsonb_build_object('state','attention',
    'issues',jsonb_build_array('google_policy_unconfigured'),'googleImportAcceptanceVerified',false); end if;
  if not p.enabled then issues:=array_append(issues,'google_policy_disabled'); end if;
  if clock_timestamp()<p.not_before or clock_timestamp()>=p.expires_at then issues:=array_append(issues,'google_policy_expired'); end if;
  if exists(select 1 from lean_private.google_standing_runs where policy_id=p_policy and
    (state='failed' or state='leased' and deadline<=clock_timestamp() or state='pending' and steps>=p.max_steps_per_run))
    then issues:=array_append(issues,'google_succession_held'); end if;
  body:=public.lean_google_standing_read(p_project_ref,p_policy,p_revision,p.account_id);
  if body is null then issues:=array_append(issues,'google_selection_unavailable'); end if;
  if exists(select 1 from lean_private.google_delivery_selection where singleton and run_id=p.last_run
    and revision=p.selection_revision and expires_at<=clock_timestamp())
    then issues:=array_append(issues,'google_selection_expired'); end if;
  select max(checked_at) into imported from lean_private.google_standing_imports
    where policy_id=p_policy and run_id=p.last_run and selection_revision=p.selection_revision;
  if imported is null then issues:=array_append(issues,'google_import_unverified');
  elsif clock_timestamp()-imported>make_interval(secs=>p.max_import_age_seconds)
    then issues:=array_append(issues,'google_import_stale'); end if;
  return jsonb_build_object('state',case when cardinality(issues)=0 then 'healthy' else 'attention' end,
    'issues',to_jsonb(issues),'googleImportAcceptanceVerified',cardinality(issues)=0,
    'posthogReadbackVerified',false);
end $$;

revoke all on function lean_private.google_standing_policy_guard(),
  lean_private.google_standing_audit_guard(),
  lean_private.google_standing_candidate(text,text),
  public.lean_google_standing_enqueue(text,bigint,text,text),
  public.lean_google_standing_next(text,text,bigint,uuid),
  public.lean_google_standing_finish(text,text,bigint,text,uuid,text),
  public.lean_google_standing_read(text,text,bigint,text),
  public.lean_google_standing_accept_import(text,bigint,jsonb),
  public.lean_google_standing_health(text,text,bigint)
  from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_google_standing_next(text,text,bigint,uuid),
  public.lean_google_standing_finish(text,text,bigint,text,uuid,text),
  public.lean_google_standing_read(text,text,bigint,text),public.lean_google_standing_health(text,text,bigint)
  to service_role;
commit;
