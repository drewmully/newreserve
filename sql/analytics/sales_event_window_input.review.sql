-- PRIVATE REVIEW ONLY. Default-off retained sales-event-window input.
-- Requires current 020/021/036/053 and all installed full-input/finish wrappers.
-- No source acquisition, history-job fabrication, queue, selection or activation.
begin;
set local search_path=pg_catalog;
do $pins$
declare contract jsonb; pins jsonb; pin jsonb; f record; n integer; actual text;
begin
  contract:=nullif(current_setting('lean.sales_event_window_install_contract',true),'')::jsonb;
  pins:=contract->'functions';
  if jsonb_typeof(pins) is distinct from 'array' or jsonb_array_length(pins)<8 or
    to_regclass('lean_private.sales_event_window_inputs') is not null or
    to_regprocedure('public.lean_report_inputs_before_sales_event_window(text,text)') is not null
    then raise exception 'UNBOUND or existing sales event window'; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and (p.proname like 'lean_report_inputs%' or p.proname like 'lean_report_finish%' or
      p.proname like 'lean_full_inputs%' or p.proname like 'lean_full_finish%' or p.proname='lean_google_delivery_finish');
  if n<>jsonb_array_length(pins) or
    (select count(distinct p->>'signature') from jsonb_array_elements(pins) p)<>n or
    exists(select 1 from unnest(array['public.lean_report_inputs(text,text)',
      'public.lean_report_finish(text,text,text,jsonb,jsonb)','public.lean_full_inputs(text,text)',
      'public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb)']) s
      where not exists(select 1 from jsonb_array_elements(pins) p where p->>'signature'=s))
    then raise exception 'incomplete event window call-chain pins'; end if;
  for pin in select value from jsonb_array_elements(pins) loop
    select p.*,s.nspname into f from pg_proc p join pg_namespace s on s.oid=p.pronamespace
      where p.oid=to_regprocedure(pin->>'signature');
    if not found or f.nspname<>'public' or
      not(f.proname like 'lean_report_inputs%' or f.proname like 'lean_report_finish%' or
        f.proname like 'lean_full_inputs%' or f.proname like 'lean_full_finish%' or f.proname='lean_google_delivery_finish') or
      f.oid::text is distinct from pin->>'oid' or f.proowner::text is distinct from pin->>'ownerOid' or
      f.proowner<>current_user::regrole::oid or not f.prosecdef or
      f.proconfig is distinct from array['search_path=pg_catalog'] or
      encode(sha256(convert_to(pg_get_functiondef(f.oid),'UTF8')),'hex') is distinct from pin->>'definitionSha256' or
      encode(sha256(convert_to(coalesce(f.proacl::text,'null'),'UTF8')),'hex') is distinct from pin->>'aclSha256'
      then raise exception 'event window current function mismatch'; end if;
  end loop;
  select encode(sha256(convert_to(pg_get_constraintdef(oid),'UTF8')),'hex') into actual
    from pg_constraint where conrelid='lean_private.report_builds'::regclass and conname='report_builds_history_runs_check';
  if actual is null or actual is distinct from contract->>'historyConstraintSha256'
    then raise exception 'event window history constraint mismatch'; end if;
  perform set_config('lean.sales_event_window_prior_acl',(
    select jsonb_object_agg(p.oid::regprocedure::text,(
      select jsonb_agg(jsonb_build_object('grantee',a.grantee,'grantor',a.grantor,'grantable',a.is_grantable)
        order by a.grantee,a.grantor,a.is_grantable)
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.privilege_type='EXECUTE'))
    from pg_proc p where p.oid=any(array['public.lean_report_inputs(text,text)'::regprocedure::oid,
      'public.lean_report_finish(text,text,text,jsonb,jsonb)'::regprocedure::oid,
      'public.lean_full_inputs(text,text)'::regprocedure::oid,
      'public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb)'::regprocedure::oid]))::text,true);
end $pins$;

-- This is a new source mode, not an invented exhausted created/updated scan.
alter table lean_private.report_builds drop constraint report_builds_history_runs_check;
alter table lean_private.report_builds add constraint report_builds_history_runs_check check(
  (not(policy ? 'partitionInventory') and not(policy ? 'salesEventWindow') and cardinality(history_runs) between 1 and 5) or
  (policy ? 'partitionInventory' and not(policy ? 'salesEventWindow') and cardinality(history_runs)=0) or
  (policy ? 'salesEventWindow' and not(policy ? 'partitionInventory') and cardinality(history_runs)=0));

create table lean_private.sales_event_window_inputs (
  run_id text primary key references lean_private.full_builds,
  base_run text not null unique references lean_private.report_builds,
  project_ref text not null check(project_ref ~ '^[a-z]{20}$'),
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=8000000),
  payload_hash text not null check(payload_hash=lean_private.partition_digest(payload)),
  enabled boolean not null default false
);
alter table lean_private.sales_event_window_inputs enable row level security;
revoke all on lean_private.sales_event_window_inputs from public,anon,authenticated,service_role;
create function lean_private.sales_event_window_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' or (to_jsonb(old)-'enabled') is distinct from (to_jsonb(new)-'enabled')
    then raise exception 'sales event input and authority immutable'; end if;
  return new;
end $$;
create trigger sales_event_window_immutable before update or delete on lean_private.sales_event_window_inputs
for each row execute function lean_private.sales_event_window_immutable();

create function public.lean_sales_event_window_register(p_scope jsonb) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare s jsonb:=p_scope->'source'; a jsonb:=p_scope->'authority'; r jsonb; e jsonb:=p_scope->'evidence';
  oldest timestamptz; newest timestamptz; prior lean_private.sales_event_window_inputs; k text;
  spend_ids text[]; m jsonb; g record; pilot lean_private.spend_pilots; v_pilot_id text;
begin
  if jsonb_typeof(p_scope) is distinct from 'object' or octet_length(p_scope::text)>8000000 or
    not(p_scope ?& array['version','projectRef','shop','runId','baseRunId','fromDate','throughDate','source',
      'sourceDigest','authority','reportPolicy','fullPolicy','spendRuns','evidence','behavior','oldestCaptureAt','latestCaptureAt']) or
    p_scope-array['version','projectRef','shop','runId','baseRunId','fromDate','throughDate','source',
      'sourceDigest','authority','reportPolicy','fullPolicy','spendRuns','evidence','behavior','oldestCaptureAt','latestCaptureAt']<>'{}' or
    p_scope->'version' is distinct from '1'::jsonb or
    coalesce(p_scope->>'projectRef','') !~ '^[a-z]{20}$' or
    coalesce(p_scope->>'shop','') !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' or
    coalesce(p_scope->>'runId','') !~ '^[A-Za-z0-9:_-]{1,100}$' or
    coalesce(p_scope->>'baseRunId','') !~ '^[A-Za-z0-9:_-]{1,100}$' or
    p_scope->>'runId'=p_scope->>'baseRunId' or p_scope->'behavior' is distinct from '{}'::jsonb
    then raise exception 'event window registration shape'; end if;
  if jsonb_typeof(s) is distinct from 'object' or s->'version' is distinct from '1'::jsonb or
    s->>'digest' is distinct from lean_private.partition_digest(s-'digest') or
    p_scope->>'sourceDigest' is distinct from s->>'digest' or
    s#>>'{scope,projectRef}' is distinct from p_scope->>'projectRef' or
    s#>>'{scope,shop}' is distinct from p_scope->>'shop' or
    s#>>'{scope,fromDate}' is distinct from p_scope->>'fromDate' or
    s#>>'{scope,throughDate}' is distinct from p_scope->>'throughDate' or
    s#>>'{scope,sourceTimezone}' is distinct from 'America/New_York' or
    s#>>'{scope,sourceCurrency}' is distinct from 'USD' or
    s#>>'{locator,sourceType}' is distinct from 'shopify_connector' or s#>'{locator,apiVersion}' is distinct from 'null'::jsonb or
    s#>>'{paymentControls,sourceType}' is distinct from 'shopify_connector' or
    s#>'{paymentControls,apiVersion}' is distinct from 'null'::jsonb or
    coalesce(s#>>'{paymentControls,captureBasis}','') not in ('bounded_interval','recorded_interval') or
    jsonb_typeof(s->'sources') is distinct from 'array' or jsonb_array_length(s->'sources')>20 or
    not isfinite((p_scope->>'fromDate')::date) or not isfinite((p_scope->>'throughDate')::date) or
    (p_scope->>'throughDate')::date-(p_scope->>'fromDate')::date not between 0 and 30
    then raise exception 'event window source scope'; end if;
  oldest:=(s#>>'{locator,startedAt}')::timestamptz;
  newest:=(s#>>'{locator,finishedAt}')::timestamptz;
  for r in
    select s->'locator' union all select s->'metadata' union all select s->'paymentControls' union all
    select x->'source' from jsonb_array_elements(s->'sources') x union all
    select x->'agreements' from jsonb_array_elements(s->'sources') x where x ? 'agreements'
  loop
    if jsonb_typeof(r) is distinct from 'object' or jsonb_typeof(r->'json') is distinct from 'string' or
      octet_length(r->>'json')>2000000 or
      r->>'sha256' is distinct from encode(sha256(convert_to(r->>'json','UTF8')),'hex') or
      coalesce(length(trim(r->>'evidenceRef')),0) not between 1 and 512 or
      r->>'startedAt' is null or r->>'finishedAt' is null or
      not isfinite((r->>'startedAt')::timestamptz) or not isfinite((r->>'finishedAt')::timestamptz) or
      (r->>'startedAt')::timestamptz>(r->>'finishedAt')::timestamptz
      then raise exception 'event window retained bytes'; end if;
    perform (r->>'json')::jsonb;
    oldest:=least(oldest,(r->>'startedAt')::timestamptz);
    newest:=greatest(newest,(r->>'finishedAt')::timestamptz);
  end loop;
  if s ? 'customers' then
    if jsonb_typeof(s#>'{customers,packetJson}') is distinct from 'string' or
      s#>>'{customers,binding,packetSha256}' is distinct from
        encode(sha256(convert_to(s#>>'{customers,packetJson}','UTF8')),'hex') or
      s#>>'{customers,binding,projectRef}' is distinct from p_scope->>'projectRef' or
      s#>>'{customers,binding,shop}' is distinct from p_scope->>'shop' or
      s#>>'{customers,binding,startedAt}' is null or s#>>'{customers,binding,capturedAt}' is null or
      not isfinite((s#>>'{customers,binding,startedAt}')::timestamptz) or
      not isfinite((s#>>'{customers,binding,capturedAt}')::timestamptz) or
      (s#>>'{customers,binding,startedAt}')::timestamptz>(s#>>'{customers,binding,capturedAt}')::timestamptz
      then raise exception 'event window scoped customer binding'; end if;
    oldest:=least(oldest,(s#>>'{customers,binding,startedAt}')::timestamptz);
    newest:=greatest(newest,(s#>>'{customers,binding,capturedAt}')::timestamptz);
  end if;
  if exists(select 1 from jsonb_array_elements(s->'sources') x where
    x->>'sourceType' is distinct from 'native_shopify' or x->>'apiVersion' is distinct from '2026-07') or
    oldest is distinct from (p_scope->>'oldestCaptureAt')::timestamptz or
    newest is distinct from (p_scope->>'latestCaptureAt')::timestamptz or
    jsonb_typeof(a) is distinct from 'object' or
    not(a ?& array['approvalRef','actorRef','readyAt','expiresAt','maxAgeSeconds']) or
    a-array['approvalRef','actorRef','readyAt','expiresAt','maxAgeSeconds']<>'{}' or
    coalesce(length(trim(a->>'approvalRef')),0) not between 1 and 512 or
    coalesce(length(trim(a->>'actorRef')),0) not between 1 and 512 or
    coalesce(a->>'maxAgeSeconds','') !~ '^[1-9][0-9]*$' or
    (a->>'maxAgeSeconds')::integer not between 1 and 86400 or
    a->>'readyAt' is null or a->>'expiresAt' is null or
    not isfinite((a->>'readyAt')::timestamptz) or not isfinite((a->>'expiresAt')::timestamptz) or
    (a->>'expiresAt')::timestamptz<=(a->>'readyAt')::timestamptz or
    (a->>'expiresAt')::timestamptz>(a->>'readyAt')::timestamptz+interval '24 hours' or
    (a->>'expiresAt')::timestamptz>oldest+make_interval(secs=>(a->>'maxAgeSeconds')::integer) or
    p_scope#>>'{fullPolicy,asOf}' is null or
    not isfinite((p_scope#>>'{fullPolicy,asOf}')::timestamptz) or
    (p_scope#>>'{fullPolicy,asOf}')::timestamptz<newest or
    (p_scope#>>'{fullPolicy,asOf}')::timestamptz>(a->>'readyAt')::timestamptz or
    ((p_scope#>>'{fullPolicy,asOf}')::timestamptz at time zone 'America/New_York')::date<=(p_scope->>'throughDate')::date
    then raise exception 'event window finite operating authority'; end if;
  if p_scope#>'{reportPolicy,salesEventWindow}' is distinct from jsonb_build_object('version',1,'digest',s->>'digest') or
    p_scope#>'{fullPolicy,salesEventWindow}' is distinct from p_scope#>'{reportPolicy,salesEventWindow}' or
    (p_scope->'reportPolicy')-array['deferredOrders','salesEventWindow'] is distinct from s->'businessPolicy' or
    p_scope#>>'{fullPolicy,behaviorMode}' is distinct from 'excluded' or
    (p_scope->'fullPolicy') ?| array['customerGeneration','googleDelivery','sessionEntryPolicy'] or
    e->'salesEventWindow' is distinct from s or e->>'ref' is distinct from 'sales-event-window:sha256:'||(s->>'digest') or
    e ? 'customerGeneration' or e ? 'sessionEntries' or
    e->'customerHistory' is distinct from '{}'::jsonb or e->'externalControls' is distinct from '{}'::jsonb or
    e#>'{sessionCoverage,behaviorComplete}' is distinct from 'false'::jsonb
    then raise exception 'event window evidence binding'; end if;
  foreach k in array array['identity','currentlyPermitted','removedCustomers','orderIdentities','checkout','campaigns',
    'attributionCoverage','settlements','offers','proofs','comparisons','cohortCoverage'] loop
    if e->k is distinct from '[]'::jsonb then raise exception 'event window unrelated source not admitted'; end if;
  end loop;
  if jsonb_typeof(e->'dateCoverage') is distinct from 'array' or
    jsonb_array_length(e->'dateCoverage')<>(p_scope->>'throughDate')::date-(p_scope->>'fromDate')::date+1 or
    (select count(distinct d->>'date') from jsonb_array_elements(e->'dateCoverage') d)<>jsonb_array_length(e->'dateCoverage') or
    exists(select 1 from jsonb_array_elements(e->'dateCoverage') d where
      (d->>'date')::date not between (p_scope->>'fromDate')::date and (p_scope->>'throughDate')::date or
      d->>'evidenceRef' is distinct from e->>'ref' or d->'gates' is distinct from
      '{"ledger":true,"orders":true,"purchase":true,"productAllocation":true,"cash":false,"customers":false,"spend":false,"behavior":false,"attribution":false}'::jsonb)
    then raise exception 'event window date gate scope'; end if;
  if jsonb_typeof(p_scope->'spendRuns') is distinct from 'array' or jsonb_array_length(p_scope->'spendRuns')>7 or
    exists(select 1 from jsonb_array_elements(p_scope->'spendRuns') x where jsonb_typeof(x)<>'string')
    then raise exception 'event window spend references'; end if;
  select coalesce(array_agg(value order by n),'{}') into spend_ids
    from jsonb_array_elements_text(p_scope->'spendRuns') with ordinality a(value,n);
  if cardinality(spend_ids)<>(select count(distinct x) from unnest(spend_ids) x) or
    ((p_scope->'fullPolicy') ? 'freshGoogleSpend') is distinct from (cardinality(spend_ids)>0)
    then raise exception 'event window spend policy pairing'; end if;
  if cardinality(spend_ids)>0 then
    m:=p_scope#>'{fullPolicy,freshGoogleSpend,manifest}';
    if m->>'projectRef' is distinct from p_scope->>'projectRef' or m->>'sourceCurrency' is distinct from 'USD' or
      m->>'sourceTimezone' is distinct from 'America/New_York' or jsonb_typeof(m->'days') is distinct from 'array' or
      jsonb_array_length(m->'days')<>cardinality(spend_ids) or
      cardinality(spend_ids)<>(p_scope->>'throughDate')::date-(p_scope->>'fromDate')::date+1 or
      (a->>'expiresAt')::timestamptz>(m->>'expiresAt')::timestamptz
      then raise exception 'event window fresh spend scope'; end if;
    -- Bind a genuine separately registered pilot; never create fake completed
    -- spend or re-register/reset the automatic producer's cycle here.
    select d.pilot_id into v_pilot_id from lean_private.spend_pilot_days d where d.run_id=spend_ids[1] for share;
    select * into pilot from lean_private.spend_pilots where spend_pilots.pilot_id=v_pilot_id for share;
    if not found or pilot.project_ref is distinct from p_scope->>'projectRef' or
      pilot.account_id is distinct from m->>'accountId' or pilot.login_customer_id is distinct from m->>'loginCustomerId' or
      pilot.max_pages is distinct from (m->>'maxPages')::integer or pilot.expires_at is distinct from (m->>'expiresAt')::timestamptz or
      pilot.approval_ref is distinct from m->>'approvalRef' or pilot.actor_ref is distinct from m->>'actorRef'
      then raise exception 'event window genuine spend pilot required'; end if;
    for g in select j.run_id,j.project_ref,j.report_date,d.pilot_id,d.due_at from lean_private.spend_jobs j
      join lean_private.spend_pilot_days d using(run_id) where j.run_id=any(spend_ids) order by j.run_id for share of j,d loop
      if g.pilot_id is distinct from pilot.pilot_id or g.project_ref is distinct from p_scope->>'projectRef' or
        g.report_date not between (p_scope->>'fromDate')::date and (p_scope->>'throughDate')::date or
        not exists(select 1 from jsonb_array_elements(m->'days') d where d->>'date'=g.report_date::text and
          (d->>'dueAt')::timestamptz=g.due_at) or
        (p_scope#>>'{fullPolicy,asOf}')::timestamptz<g.due_at
        then raise exception 'event window spend day mismatch'; end if;
    end loop;
    if (select count(*) from lean_private.spend_pilot_days where run_id=any(spend_ids) and spend_pilot_days.pilot_id=pilot.pilot_id)<>cardinality(spend_ids)
      then raise exception 'event window spend day missing'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_scope->>'projectRef',0));
  select * into prior from lean_private.sales_event_window_inputs where run_id=p_scope->>'runId';
  if found then
    if prior.payload_hash is distinct from lean_private.partition_digest(p_scope)
      then raise exception 'event window immutable registration conflict'; end if;
    return prior.run_id;
  end if;
  insert into lean_private.report_builds(run_id,project_ref,shop,history_runs,spend_runs,
    from_date,through_date,policy,approval_ref,actor_ref)
    values(p_scope->>'baseRunId',p_scope->>'projectRef',p_scope->>'shop','{}',spend_ids,
      (p_scope->>'fromDate')::date,(p_scope->>'throughDate')::date,p_scope->'reportPolicy',
      a->>'approvalRef',a->>'actorRef');
  insert into lean_private.full_builds(run_id,project_ref,base_run,policy,evidence,behavior,approval_ref,actor_ref)
    values(p_scope->>'runId',p_scope->>'projectRef',p_scope->>'baseRunId',p_scope->'fullPolicy',e,'{}',
      a->>'approvalRef',a->>'actorRef');
  insert into lean_private.sales_event_window_inputs(run_id,base_run,project_ref,payload,payload_hash)
    values(p_scope->>'runId',p_scope->>'baseRunId',p_scope->>'projectRef',p_scope,lean_private.partition_digest(p_scope));
  return p_scope->>'runId';
end $$;

-- One lock order for inputs, both finishes and owner enable/disable:
-- event source -> base report -> full report, all FOR UPDATE from the outset.
-- Do not take either job row first or upgrade shared locks after delegation.
create function lean_private.sales_event_window_current(p_base text,p_project text) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare v lean_private.sales_event_window_inputs; b lean_private.report_builds; f lean_private.full_builds; a jsonb;
begin
  select * into v from lean_private.sales_event_window_inputs where base_run=p_base and project_ref=p_project for update;
  if not found then raise exception 'event window source unregistered'; end if;
  select * into strict b from lean_private.report_builds where run_id=p_base and project_ref=p_project for update;
  select * into strict f from lean_private.full_builds where run_id=v.run_id and project_ref=p_project for update;
  a:=v.payload->'authority';
  if not v.enabled or not b.enabled or not f.enabled or
    v.payload_hash is distinct from lean_private.partition_digest(v.payload) or
    b.policy is distinct from v.payload->'reportPolicy' or f.policy is distinct from v.payload->'fullPolicy' or
    f.evidence is distinct from v.payload->'evidence' or
    b.shop is distinct from v.payload->>'shop' or b.from_date is distinct from (v.payload->>'fromDate')::date or
    b.through_date is distinct from (v.payload->>'throughDate')::date or f.base_run is distinct from p_base or
    cardinality(b.history_runs)<>0 or to_jsonb(b.spend_runs) is distinct from v.payload->'spendRuns' or
    b.approval_ref is distinct from a->>'approvalRef' or f.approval_ref is distinct from a->>'approvalRef' or
    b.actor_ref is distinct from a->>'actorRef' or f.actor_ref is distinct from a->>'actorRef' or
    clock_timestamp()<(a->>'readyAt')::timestamptz or clock_timestamp()>=(a->>'expiresAt')::timestamptz or
    clock_timestamp()>(v.payload->>'oldestCaptureAt')::timestamptz+make_interval(secs=>(a->>'maxAgeSeconds')::integer)
    then raise exception 'event window disabled changed or expired'; end if;
  return v.payload;
end $$;

alter function public.lean_report_inputs(text,text) rename to lean_report_inputs_before_sales_event_window;
create function public.lean_report_inputs(p_run text,p_project_ref text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare b lean_private.report_builds; p jsonb; input jsonb; history jsonb;
  id text; spend jsonb:='[]'; j lean_private.spend_jobs;
begin
  select * into b from lean_private.report_builds where run_id=p_run and project_ref=p_project_ref;
  if not found or not(b.policy ? 'salesEventWindow') then
    return public.lean_report_inputs_before_sales_event_window(p_run,p_project_ref); end if;
  if not b.enabled then return jsonb_build_object('state','disabled'); end if;
  p:=lean_private.sales_event_window_current(p_run,p_project_ref);
  if b.completed_at is not null then return jsonb_build_object('state','complete'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('source',(x#>>'{source,json}')::jsonb,
    'evidenceRef',x#>>'{source,evidenceRef}') order by n),'[]'::jsonb) into history
    from jsonb_array_elements(p#>'{source,sources}') with ordinality a(x,n);
  foreach id in array b.spend_runs loop
    select * into j from lean_private.spend_jobs where run_id=id and project_ref=p_project_ref
      and report_date between b.from_date and b.through_date for share;
    if not found or not j.enabled or j.base is null then return jsonb_build_object('state','blocked'); end if;
    spend:=spend||jsonb_build_array(j.base);
  end loop;
  if (select coalesce(sum(jsonb_array_length(x->'rows')),0) from jsonb_array_elements(spend) x)>10000
    then raise exception 'event window spend input budget'; end if;
  input:=jsonb_build_object('state','ready','shop',b.shop,'publication','observed:'||p_run,
    'fromDate',b.from_date,'throughDate',b.through_date,'policy',b.policy,'history',history,'spend',spend,
    'salesEventWindow',p->'source','sourceAsOf',p#>>'{fullPolicy,asOf}');
  if octet_length(input::text)>8000000 then raise exception 'event window report input budget'; end if;
  return input||jsonb_build_object('inputHash',md5(input::text));
end $$;
alter function public.lean_report_finish(text,text,text,jsonb,jsonb) rename to lean_report_finish_before_sales_event_window;
create function public.lean_report_finish(p_run text,p_project_ref text,p_input_hash text,p_facts jsonb,p_reports jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare b lean_private.report_builds; done boolean;
begin
  select * into b from lean_private.report_builds where run_id=p_run and project_ref=p_project_ref;
  if b.policy ? 'salesEventWindow' then perform lean_private.sales_event_window_current(p_run,p_project_ref); end if;
  done:=public.lean_report_finish_before_sales_event_window(p_run,p_project_ref,p_input_hash,p_facts,p_reports);
  if done and b.policy ? 'salesEventWindow' then
    perform lean_private.sales_event_window_current(p_run,p_project_ref); end if;
  return done;
end $$;
alter function public.lean_full_inputs(text,text) rename to lean_full_inputs_before_sales_event_window;
create function public.lean_full_inputs(p_run text,p_project_ref text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare f lean_private.full_builds;
begin
  select * into f from lean_private.full_builds where run_id=p_run and project_ref=p_project_ref;
  if f.policy ? 'salesEventWindow' then
    if not f.enabled then return jsonb_build_object('state','disabled'); end if;
    perform lean_private.sales_event_window_current(f.base_run,p_project_ref);
  end if;
  -- Original base completion, privacy and other input dependencies still run.
  return public.lean_full_inputs_before_sales_event_window(p_run,p_project_ref);
end $$;
alter function public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb) rename to lean_full_finish_before_sales_event_window;
create function public.lean_full_finish(p_run text,p_project_ref text,p_token uuid,p_input_hash text,
  p_facts jsonb,p_reports jsonb,p_manifest jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare f lean_private.full_builds; done boolean;
begin
  select * into f from lean_private.full_builds where run_id=p_run and project_ref=p_project_ref;
  if f.policy ? 'salesEventWindow' then perform lean_private.sales_event_window_current(f.base_run,p_project_ref); end if;
  done:=public.lean_full_finish_before_sales_event_window(p_run,p_project_ref,p_token,p_input_hash,p_facts,p_reports,p_manifest);
  if done and f.policy ? 'salesEventWindow' then
    perform lean_private.sales_event_window_current(f.base_run,p_project_ref); end if;
  return done;
end $$;

-- No activation function or grant is supplied. A separate exact owner action
-- must enable this immutable finite input together with its real base/full jobs.
do $acl$
declare x record; entry record; g record; previous jsonb:=current_setting('lean.sales_event_window_prior_acl')::jsonb;
begin
  for x in select p.oid::regprocedure signature,a.grantee from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where ((n.nspname='public' and (p.proname in ('lean_sales_event_window_register',
      'lean_report_inputs','lean_report_finish','lean_full_inputs','lean_full_finish') or
      p.proname like '%before_sales_event_window')) or
      (n.nspname='lean_private' and p.proname in ('sales_event_window_immutable','sales_event_window_current')))
      and a.grantee<>p.proowner loop
    execute format('revoke all on function %s from %s',x.signature,
      case when x.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(x.grantee)) end);
  end loop;
  for x in select a.grantee from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    where c.oid='lean_private.sales_event_window_inputs'::regclass and a.grantee<>c.relowner loop
    execute format('revoke all on lean_private.sales_event_window_inputs from %s',
      case when x.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(x.grantee)) end);
  end loop;
  for entry in select * from jsonb_each(previous) loop
    for g in select * from jsonb_to_recordset(entry.value) as a(grantee oid,grantor oid,grantable boolean) loop
      if g.grantor<>current_user::regrole::oid then raise exception 'event window ACL grantor mismatch'; end if;
      execute format('grant execute on function %s to %s%s',entry.key,
        case when g.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(g.grantee)) end,
        case when g.grantable then ' with grant option' else '' end);
    end loop;
    if entry.value is distinct from (select jsonb_agg(jsonb_build_object('grantee',a.grantee,
      'grantor',a.grantor,'grantable',a.is_grantable) order by a.grantee,a.grantor,a.is_grantable)
      from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=to_regprocedure(entry.key) and a.privilege_type='EXECUTE')
      then raise exception 'event window ACL restoration mismatch'; end if;
  end loop;
end $acl$;
commit;
