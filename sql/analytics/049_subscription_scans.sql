-- REVIEW ONLY, after unchanged048. No registration, schedule, activation or source read.
begin;
create table lean_private.subscription_scan_plans (
  plan_id text primary key check(plan_id ~ '^[A-Za-z0-9_-]{1,60}$'),
  project_ref text not null check(project_ref ~ '^[a-z]{20}$'),
  shop text not null check(shop='mullybox-store.myshopify.com'),
  token_sha256 text not null check(token_sha256 ~ '^[a-f0-9]{64}$'),
  binding_ref text not null check(binding_ref ~ '^[A-Za-z0-9:/._-]{1,200}$'),
  approval_ref text not null check(length(trim(approval_ref)) between 1 and 200),
  traffic_approval_ref text not null check(length(trim(traffic_approval_ref)) between 1 and 200),
  retention_ref text not null check(length(trim(retention_ref)) between 1 and 200),
  actor_ref text not null check(length(trim(actor_ref)) between 1 and 200),
  policy jsonb not null check(jsonb_typeof(policy)='object' and policy->'recurringValue' is not distinct from 'null'::jsonb),
  from_time timestamptz not null, until_time timestamptz not null, retain_until timestamptz not null,
  cadence_seconds integer not null check(cadence_seconds between 300 and 86400),
  max_cycles integer not null check(max_cycles between 1 and 96),
  max_pages integer not null check(max_pages between 1 and 20),
  max_rows integer not null check(max_rows between 1 and 1000),
  max_bytes integer not null check(max_bytes between 1 and 4000000),
  page_size integer not null check(page_size between 1 and 100),
  status_filter text check(status_filter in ('ACTIVE','PAUSED','CANCELLED','EXPIRED')),
  enabled boolean not null default false,
  phase text not null default 'registered' check(phase in ('registered','scanning','between_cycles','completed','halted')),
  cycle integer not null default 0, page integer not null default 0,
  cycle_rows integer not null default 0, cycle_bytes integer not null default 0,
  next_due timestamptz, current_run text references lean_private.subscription_runs,
  cursor_ciphertext text, cursor_fingerprint text,
  history jsonb not null default '[]' check(jsonb_typeof(history)='array'),
  check(isfinite(from_time) and isfinite(until_time) and until_time>from_time and until_time<=from_time+interval '7 days'),
  check(isfinite(retain_until) and retain_until>until_time and retain_until<=until_time+interval '30 days'),
  check(cycle between 0 and max_cycles and page between 0 and max_pages),
  check(cycle_rows between 0 and max_rows and cycle_bytes between 0 and max_bytes),
  check(jsonb_array_length(history)<=max_cycles*max_pages),
  check((cursor_ciphertext is null)=(cursor_fingerprint is null))
);
alter table lean_private.subscription_scan_plans enable row level security;
revoke all on lean_private.subscription_scan_plans from public,anon,authenticated,service_role;
create function lean_private.subscription_scan_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if (to_jsonb(old)-array['enabled','phase','cycle','page','cycle_rows','cycle_bytes','next_due',
    'current_run','cursor_ciphertext','cursor_fingerprint','history']) is distinct from
    (to_jsonb(new)-array['enabled','phase','cycle','page','cycle_rows','cycle_bytes','next_due',
    'current_run','cursor_ciphertext','cursor_fingerprint','history'])
    then raise exception 'subscription plan immutable'; end if;
  if not new.enabled and old.current_run is not null then
    update lean_private.subscription_runs set enabled=false where run_id=old.current_run;
  end if;
  return new;
end $$;
create trigger subscription_scan_immutable before update on lean_private.subscription_scan_plans
  for each row execute function lean_private.subscription_scan_immutable();

create function public.lean_subscription_scan_claim(p_plan text,p_project text,p_token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.subscription_scan_plans; g lean_private.subscription_gate; r text; c jsonb;
begin
  select * into strict g from lean_private.subscription_gate where singleton for update;
  select * into p from lean_private.subscription_scan_plans where plan_id=p_plan and project_ref=p_project for update;
  if not found or p_token is null then raise exception 'unapproved subscription plan'; end if;
  if not p.enabled or not g.enabled then return jsonb_build_object('state','disabled'); end if;
  if p.phase in ('completed','halted') then return jsonb_build_object('state',p.phase); end if;
  if clock_timestamp()>=p.until_time or clock_timestamp()>=p.retain_until then return jsonb_build_object('state','expired'); end if;
  if clock_timestamp()<coalesce(p.next_due,p.from_time) then return jsonb_build_object('state','waiting'); end if;
  if g.lease_until>clock_timestamp() or g.next_allowed_at>clock_timestamp() then return jsonb_build_object('state','busy'); end if;
  if p.current_run is not null and exists(select 1 from lean_private.subscription_runs where run_id=p.current_run and attempts>0) then
    update lean_private.subscription_scan_plans set phase='halted',enabled=false where plan_id=p_plan;
    return jsonb_build_object('state','halted'); -- Ambiguous/failed old attempt is never automatically fetched again.
  end if;
  if p.phase in ('registered','between_cycles') then
    update lean_private.subscription_scan_plans set phase='scanning',cycle=cycle+1,page=1,
      cycle_rows=0,cycle_bytes=0,cursor_ciphertext=null,cursor_fingerprint=null,next_due=null
      where plan_id=p_plan returning * into p;
  end if;
  if p.current_run is null then
    r:='ss_'||encode(sha256(convert_to(p.plan_id,'UTF8')),'hex')||'_'||p.cycle||'_'||p.page;
    insert into lean_private.subscription_runs(run_id,project_ref,shop,token_sha256,binding_ref,approval_ref,
      traffic_approval_ref,actor_ref,policy,page_size,max_rows,max_bytes,status_filter,enabled,expires_at)
    values(r,p.project_ref,p.shop,p.token_sha256,p.binding_ref,p.approval_ref,p.traffic_approval_ref,p.actor_ref,p.policy,
      least(p.page_size,p.max_rows-p.cycle_rows),least(p.page_size,p.max_rows-p.cycle_rows),
      p.max_bytes-p.cycle_bytes,p.status_filter,true,p.until_time);
    update lean_private.subscription_scan_plans set current_run=r where plan_id=p_plan returning * into p;
  end if;
  c:=public.lean_subscription_claim(p.current_run,p_project,p_token);
  return c||jsonb_build_object('runId',p.current_run,'planId',p.plan_id,'cycle',p.cycle,'page',p.page,
    'cursorCiphertext',p.cursor_ciphertext,'cursorFingerprint',p.cursor_fingerprint);
end $$;

create function public.lean_subscription_scan_permit(p_plan text,p_run text,p_project text,p_token uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.subscription_scan_plans;
begin
  perform 1 from lean_private.subscription_gate where singleton for update;
  select * into p from lean_private.subscription_scan_plans where plan_id=p_plan and project_ref=p_project for update;
  if not found or not p.enabled or p.phase<>'scanning' or p.current_run is distinct from p_run
    or clock_timestamp()>=p.until_time or clock_timestamp()>=p.retain_until then return false; end if;
  return public.lean_subscription_permit(p_run,p_project,p_token);
end $$;

create function public.lean_subscription_scan_finish(p_plan text,p_run text,p_project text,p_token uuid,
  p_payload jsonb,p_has_next boolean,p_cursor text,p_fingerprint text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.subscription_scan_plans; prior jsonb; terminal text; rows_used integer; bytes_used integer;
begin
  perform 1 from lean_private.subscription_gate where singleton for update;
  select * into p from lean_private.subscription_scan_plans where plan_id=p_plan and project_ref=p_project for update;
  if not found then return false; end if;
  select x into prior from jsonb_array_elements(p.history) x where x->>'runId'=p_run;
  if prior is not null then
    if prior->'hasNext' is distinct from to_jsonb(p_has_next) or
      prior->>'cursorHash' is distinct from encode(sha256(convert_to(p_cursor,'UTF8')),'hex') or
      prior->>'fingerprint' is distinct from p_fingerprint then raise exception 'subscription page replay conflict'; end if;
    return public.lean_subscription_finish(p_run,p_project,p_token,p_payload);
  end if;
  if not p.enabled or p.phase<>'scanning' or p.current_run is distinct from p_run
    or clock_timestamp()>=p.until_time or clock_timestamp()>=p.retain_until then return false; end if;
  if p_has_next is null or (p_payload->>'state'='pagination_ended') is distinct from not p_has_next or
    (p_has_next and (coalesce(p_cursor,'') !~ '^v1\.[A-Za-z0-9_-]+$' or length(p_cursor) not between 43 and 8195
      or coalesce(p_fingerprint,'') !~ '^[a-f0-9]{64}$')) or
    (not p_has_next and (p_cursor is not null or p_fingerprint is not null)) then raise exception 'subscription cursor envelope'; end if;
  if p_has_next and exists(select 1 from jsonb_array_elements(p.history) x
    where (x->>'cycle')::integer=p.cycle and x->>'fingerprint'=p_fingerprint)
    then raise exception 'subscription cursor cycle'; end if;
  rows_used:=p.cycle_rows+(p_payload#>>'{evidence,rawRows}')::integer;
  bytes_used:=p.cycle_bytes+(p_payload#>>'{evidence,bytes}')::integer;
  if not public.lean_subscription_finish(p_run,p_project,p_token,p_payload) then return false; end if;
  terminal:=case when not p_has_next then 'pagination_ended_unverified'
    when p.page>=p.max_pages or rows_used>=p.max_rows or bytes_used>=p.max_bytes then 'budget_reached' else null end;
  update lean_private.subscription_scan_plans set cycle_rows=rows_used,cycle_bytes=bytes_used,current_run=null,
    history=history||jsonb_build_array(jsonb_build_object('cycle',cycle,'page',page,'runId',p_run,'hasNext',p_has_next,
      'cursorHash',encode(sha256(convert_to(p_cursor,'UTF8')),'hex'),'fingerprint',p_fingerprint,'terminal',terminal)),
    cursor_ciphertext=case when terminal is null then p_cursor else null end,
    cursor_fingerprint=case when terminal is null then p_fingerprint else null end,
    page=case when terminal is null then page+1 else page end,
    phase=case when terminal is null then 'scanning' when cycle>=max_cycles then 'completed' else 'between_cycles' end,
    next_due=case when terminal is not null then clock_timestamp()+cadence_seconds*interval '1 second' else null end
    where plan_id=p_plan;
  return true;
end $$;

create function public.lean_subscription_scan_fail(p_plan text,p_run text,p_project text,p_token uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.subscription_scan_plans;
begin
  perform 1 from lean_private.subscription_gate where singleton for update;
  select * into p from lean_private.subscription_scan_plans where plan_id=p_plan and project_ref=p_project for update;
  if not found or p.current_run is distinct from p_run then return false; end if;
  if not public.lean_subscription_fail(p_run,p_project,p_token) then return false; end if;
  update lean_private.subscription_scan_plans set phase='halted',enabled=false where plan_id=p_plan;
  return true;
end $$;

-- Owner only: partial observed-cohort counts never replace existing global metrics.
create function public.lean_subscription_scan_report(p_plan text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare p lean_private.subscription_scan_plans; cycles jsonb; globals jsonb;
begin
  select * into p from lean_private.subscription_scan_plans where plan_id=p_plan;
  if not found then raise exception 'subscription plan not found'; end if;
  if now()>=p.retain_until then raise exception 'subscription retention expired; owner purge required'; end if;
  with pages as (select (h->>'cycle')::integer cycle,h,r.payload
    from jsonb_array_elements(p.history) h join lean_private.subscription_runs r on r.run_id=h->>'runId'),
  rows as (select distinct cycle,x from pages cross join lateral jsonb_array_elements(payload->'rows') x),
  cohorts as (select cycle,count(distinct x->>'contractKey') n,
    count(*)>count(distinct x->>'contractKey') conflict from rows group by cycle),
  captures as (select cycle,count(*) pages,max(h->>'terminal') terminal,
    jsonb_agg(h->>'runId' order by (h->>'page')::integer) runs,
    sum((payload#>>'{evidence,rawRows}')::integer) raw_rows,
    min((payload->>'asOf')::timestamptz) first_as_of,max((payload->>'asOf')::timestamptz) last_as_of,
    min((payload#>>'{evidence,startedAt}')::timestamptz) capture_start,
    max((payload#>>'{evidence,finishedAt}')::timestamptz) capture_end
    from pages group by cycle),
  measures as (select c.*,coalesce(cohorts.n,0) n,coalesce(cohorts.conflict,false) conflict,
    (select count(*) from rows r where r.cycle=c.cycle and x->>'status'='ACTIVE') active,
    (select count(distinct x->>'subscriberKey') from rows r where r.cycle=c.cycle and x->>'status'='ACTIVE') subscribers,
    (select min((x->>'nextBillingAt')::timestamptz) from rows r where r.cycle=c.cycle and x->>'status'='ACTIVE') renewal,
    exists(select 1 from rows r where r.cycle=c.cycle and x->>'status'='ACTIVE' and x->>'subscriberKey' is null) missing_subscriber,
    exists(select 1 from rows r where r.cycle=c.cycle and x->>'status'='ACTIVE' and x->>'nextBillingAt' is null) missing_renewal,
    exists(select 1 from rows r where r.cycle=c.cycle and x->>'status'='ACTIVE'
      and (x->>'nextBillingAt')::timestamptz<c.capture_end) past_renewal
    from captures c left join cohorts using(cycle)),
  assessed as (select m.*,
    array_remove(array[
      case when conflict then 'conflicting_contract_revisions' end,
      case when p.policy->'countedStatuses' is distinct from '["ACTIVE"]'::jsonb
        or p.policy->>'deduplication' is distinct from 'identical_normalized_contract'
        then 'active_count_policy_unverified' end],null) base_reasons,
    case when p.policy->>'renewalDays' ~ '^[1-9][0-9]?$'
      and (p.policy->>'renewalDays')::integer<=90 then (p.policy->>'renewalDays')::integer end renewal_days
    from measures m)
  select jsonb_agg(jsonb_build_object('cycle',c.cycle,'completedPages',c.pages,'terminal',c.terminal,'pageRuns',c.runs,
    'rawRowsCaptured',c.raw_rows,'firstPageAsOf',c.first_as_of,'lastPageAsOf',c.last_as_of,
    'observedUniqueContractsInCapturedPages',c.n,'revisionConflict',c.conflict,
    'coverage','captured_pages_only','readiness','observed_unverified',
    'paginationEnded',coalesce(c.terminal='pagination_ended_unverified',false),
    'scanTraversal',case when c.terminal='pagination_ended_unverified' then 'all_returned_pages_traversed'
      when c.terminal='budget_reached' then 'budget_limited' else 'partial' end,
    'snapshotConsistency','unverified','captureStartedAt',c.capture_start,'captureFinishedAt',c.capture_end,
    'renewalReferenceAt',c.capture_end,'renewalUntilExclusive',c.capture_end+c.renewal_days*interval '24 hours',
    'capturedPageMetrics',(select jsonb_object_agg(name,jsonb_build_object(
      'value',case when cardinality(reasons)=0 then value else 'null'::jsonb end,
      'readiness',case when cardinality(reasons)=0 then 'observed_unverified' else 'withheld' end,
      'reasons',to_jsonb(reasons))) from (values
        ('observedActiveContractsInCapturedPages',to_jsonb(c.active),c.base_reasons),
        ('observedDistinctSubscribersInCapturedPages',to_jsonb(c.subscribers),
          c.base_reasons||array_remove(array[case when c.missing_subscriber then 'missing_subscriber_id' end,
            case when p.policy->>'subscriberBasis' is distinct from 'shopify_customer_id' then 'subscriber_basis_unverified' end],null)),
        ('observedNextRenewalAtInCapturedPages',to_jsonb(c.renewal),
          c.base_reasons||array_remove(array[case when c.missing_renewal then 'missing_next_billing_date' end,
            case when c.past_renewal then 'past_next_billing_date' end],null)),
        ('observedRenewingContractsInWindowInCapturedPages',
          to_jsonb((select count(*) from rows r where r.cycle=c.cycle and x->>'status'='ACTIVE'
            and (x->>'nextBillingAt')::timestamptz>=c.capture_end
            and (x->>'nextBillingAt')::timestamptz<c.capture_end+c.renewal_days*interval '24 hours')),
          c.base_reasons||array_remove(array[case when c.missing_renewal then 'missing_next_billing_date' end,
            case when c.past_renewal then 'past_next_billing_date' end,
            case when c.renewal_days is null then 'renewal_window_unverified' end],null))
      ) metric(name,value,reasons))
    ) order by c.cycle) into cycles from assessed c;
  select jsonb_object_agg(name,jsonb_build_object('value',null,'readiness','withheld',
    'reasons',case when name in ('proposedMrr','proposedArr')
      then jsonb_build_array('scope_consistency_unverified','recurring_amount_authority_unverified')
      else jsonb_build_array('scope_consistency_unverified') end))
    into globals from unnest(array['activeContracts','distinctSubscribers','nextRenewalAt','renewingContractsInWindow','proposedMrr','proposedArr']) name;
  return jsonb_build_object('planId',p.plan_id,'phase',p.phase,'enabled',p.enabled,'nextDue',p.next_due,
    'shop',p.shop,'projectRef',p.project_ref,'statusFilter',p.status_filter,'definitionRef',p.policy->>'definitionRef',
    'approvalRef',p.approval_ref,'trafficApprovalRef',p.traffic_approval_ref,'retentionRef',p.retention_ref,
    'from',p.from_time,'until',p.until_time,'retainUntil',p.retain_until,'cadenceSeconds',p.cadence_seconds,
    'maxCycles',p.max_cycles,'maxPages',p.max_pages,'maxRows',p.max_rows,'maxBytes',p.max_bytes,
    'binding','owner_attested_not_provider_verified','scopeComplete',false,'certified',false,
    'definitionStatus','proposed','historicalTrendsSupported',false,'metrics',globals,'cycles',coalesce(cycles,'[]'));
end $$;
-- Independent aggregate delivery. No gate/plan selection or raw report access for service.
create table lean_private.subscription_report_delivery (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  plan_id text references lean_private.subscription_scan_plans,
  approval_ref text,
  check(not enabled or (plan_id is not null and length(trim(approval_ref))>0 and approval_ref is not null))
);
insert into lean_private.subscription_report_delivery(singleton) values(true);
alter table lean_private.subscription_report_delivery enable row level security;
revoke all on lean_private.subscription_report_delivery from public,anon,authenticated,service_role;
create function public.lean_subscription_reports_read() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare g lean_private.subscription_report_delivery; p lean_private.subscription_scan_plans; report jsonb; result jsonb;
begin
  select * into strict g from lean_private.subscription_report_delivery where singleton;
  if not g.enabled then return null; end if;
  select * into strict p from lean_private.subscription_scan_plans where plan_id=g.plan_id;
  if p.project_ref<>'xnfjdbpjuaezxjgargto' or p.shop<>'mullybox-store.myshopify.com'
    or p.max_cycles>7 or p.cadence_seconds<>86400 then raise exception 'subscription delivery scope'; end if;
  report:=public.lean_subscription_scan_report(p.plan_id); -- Includes retention-expiry refusal.
  select jsonb_build_object('subscription_observations',coalesce(jsonb_agg(jsonb_build_object(
    'cycle',(c->>'cycle')::integer,'capture_started_at',c->'captureStartedAt','capture_finished_at',c->'captureFinishedAt',
    'renewal_until_exclusive',c->'renewalUntilExclusive',
    'scan_traversal',c->'scanTraversal','pagination_ended',c->'paginationEnded',
    'completed_pages',(c->>'completedPages')::integer,'raw_rows_captured',(c->>'rawRowsCaptured')::integer,
    'observed_unique_contracts',(c->>'observedUniqueContractsInCapturedPages')::integer,
    'revision_conflict',c->'revisionConflict','report_scope','captured_pages_only',
    'scope_complete',false,'snapshot_consistency','unverified','certified',false,
    'observed_active_contracts',c#>'{capturedPageMetrics,observedActiveContractsInCapturedPages,value}',
    'observed_distinct_subscribers',c#>'{capturedPageMetrics,observedDistinctSubscribersInCapturedPages,value}',
    'observed_next_renewal_at',c#>'{capturedPageMetrics,observedNextRenewalAtInCapturedPages,value}',
    'observed_renewing_contracts_in_window',c#>'{capturedPageMetrics,observedRenewingContractsInWindowInCapturedPages,value}',
    'readiness',jsonb_build_object(
      'observed_active_contracts',c#>'{capturedPageMetrics,observedActiveContractsInCapturedPages,readiness}',
      'observed_distinct_subscribers',c#>'{capturedPageMetrics,observedDistinctSubscribersInCapturedPages,readiness}',
      'observed_next_renewal_at',c#>'{capturedPageMetrics,observedNextRenewalAtInCapturedPages,readiness}',
      'observed_renewing_contracts_in_window',c#>'{capturedPageMetrics,observedRenewingContractsInWindowInCapturedPages,readiness}')
    ) order by (c->>'cycle')::integer),'[]'::jsonb)) into result
    from jsonb_array_elements(report->'cycles') c;
  if jsonb_array_length(result->'subscription_observations')>7 or octet_length(result::text)>65536
    then raise exception 'subscription delivery budget'; end if;
  return result;
end $$;
revoke all on function lean_private.subscription_scan_immutable(),
  public.lean_subscription_scan_claim(text,text,uuid),public.lean_subscription_scan_permit(text,text,text,uuid),
  public.lean_subscription_scan_finish(text,text,text,uuid,jsonb,boolean,text,text),
  public.lean_subscription_scan_fail(text,text,text,uuid),public.lean_subscription_scan_report(text),
  public.lean_subscription_reports_read()
  from public,anon,authenticated,service_role;
grant execute on function public.lean_subscription_scan_claim(text,text,uuid),
  public.lean_subscription_scan_permit(text,text,text,uuid),
  public.lean_subscription_scan_finish(text,text,text,uuid,jsonb,boolean,text,text),
  public.lean_subscription_scan_fail(text,text,text,uuid),public.lean_subscription_reports_read() to service_role;
do $$ begin
  if exists(select 1 from pg_roles where rolname='lean_posthog_reader') then
    revoke all on lean_private.subscription_scan_plans,lean_private.subscription_report_delivery from lean_posthog_reader;
    revoke all on function lean_private.subscription_scan_immutable(),public.lean_subscription_scan_claim(text,text,uuid),
      public.lean_subscription_scan_permit(text,text,text,uuid),public.lean_subscription_scan_finish(text,text,text,uuid,jsonb,boolean,text,text),
      public.lean_subscription_scan_fail(text,text,text,uuid),public.lean_subscription_scan_report(text),
      public.lean_subscription_reports_read() from lean_posthog_reader;
  end if;
  if exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    where c.oid in ('lean_private.subscription_scan_plans'::regclass,'lean_private.subscription_report_delivery'::regclass)
      and a.grantee<>c.relowner) or
    exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where ((p.pronamespace='public'::regnamespace and p.proname=any(array['lean_subscription_scan_claim',
        'lean_subscription_scan_permit','lean_subscription_scan_finish','lean_subscription_scan_fail','lean_subscription_scan_report',
        'lean_subscription_reports_read']))
        or (p.pronamespace='lean_private'::regnamespace and p.proname='subscription_scan_immutable'))
      and a.grantee<>p.proowner and not(p.pronamespace='public'::regnamespace and p.proname=any(array[
        'lean_subscription_scan_claim','lean_subscription_scan_permit','lean_subscription_scan_finish','lean_subscription_scan_fail',
        'lean_subscription_reports_read'])
        and a.grantee='service_role'::regrole and a.privilege_type='EXECUTE' and not a.is_grantable))
    then raise exception 'unexpected subscription scan ACL'; end if;
end $$;
commit;
