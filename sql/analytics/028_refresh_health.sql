-- REVIEW ONLY. Read-only health signal; no schedule, alert delivery or source
-- activation. Expected cadence is operator-owned, never inferred from arrivals.
begin;
create table lean_private.refresh_monitor_targets (
  project_ref text not null check(project_ref ~ '^[a-z]{20}$'),
  shop text not null check(shop ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  enabled boolean not null default false,
  max_candidate_age_seconds integer not null check(max_candidate_age_seconds between 60 and 604800),
  max_export_age_seconds integer not null check(max_export_age_seconds between 60 and 604800),
  require_export boolean not null default true,
  approval_ref text not null check(length(trim(approval_ref))>0),
  actor_ref text not null check(length(trim(actor_ref))>0),
  primary key(project_ref,shop)
);
alter table lean_private.refresh_monitor_targets enable row level security;
revoke all on lean_private.refresh_monitor_targets from public,anon,authenticated,service_role,lean_posthog_reader;

create function public.lean_refresh_health(p_project_ref text,p_shop text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare target lean_private.refresh_monitor_targets; limits lean_private.refresh_limits;
  checked_at timestamptz := clock_timestamp(); candidate_at timestamptz; export_at timestamptz;
  candidate_asof timestamptz; selected_asof timestamptz; selected_stale boolean;
  selected_pub text; selected_count integer; selected_distinct integer;
  blocked integer; expired integer; ambiguous integer; exhausted integer;
  history_exhausted integer; incomplete_full integer;
  issues text[] := '{}';
begin
  if p_project_ref is null or p_project_ref !~ '^[a-z]{20}$' or p_shop is null or
    p_shop !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' then raise exception 'invalid monitor target'; end if;
  select * into target from lean_private.refresh_monitor_targets
    where project_ref=p_project_ref and shop=p_shop;
  if not found then return jsonb_build_object('state','unconfigured','issues',jsonb_build_array('monitor_unconfigured')); end if;
  if not target.enabled then return jsonb_build_object('state','disabled','issues',jsonb_build_array('monitor_disabled')); end if;
  select * into limits from lean_private.refresh_limits where project_ref=p_project_ref;
  if not found or not limits.enabled then issues := array_append(issues,'refresh_disabled');
  elsif limits.counter_date=(checked_at at time zone 'UTC')::date and limits.used_steps>=limits.max_daily_steps
    then issues := array_append(issues,'daily_budget_exhausted'); end if;

  select f.completed_at,(f.policy->>'asOf')::timestamptz into candidate_at,candidate_asof from lean_private.full_builds f
    join lean_private.report_builds b on b.run_id=f.base_run
    where f.project_ref=p_project_ref and b.project_ref=p_project_ref and b.shop=p_shop and f.enabled
      and f.completed_at is not null order by f.completed_at desc,f.run_id limit 1;
  if candidate_at is null then issues := array_append(issues,'no_completed_candidate');
  elsif candidate_asof is null or candidate_asof>checked_at or
      candidate_asof<checked_at-make_interval(secs=>target.max_candidate_age_seconds)
    then issues := array_append(issues,'candidate_stale'); end if;
  select count(*) filter(where q.status='blocked'),
    count(*) filter(where q.status='queued' and q.expires_at<=checked_at),
    count(*) filter(where q.status='queued' and q.lease_token is not null and q.lease_until<=checked_at),
    count(*) filter(where q.status='queued' and q.used_steps>=q.max_steps)
    into blocked,expired,ambiguous,exhausted
    from lean_private.refresh_queue q join lean_private.full_builds f on f.run_id=q.run_id
    join lean_private.report_builds b on b.run_id=f.base_run
    where q.project_ref=p_project_ref and b.project_ref=p_project_ref and b.shop=p_shop and q.enabled;
  if blocked>0 then issues := array_append(issues,'blocked_refresh'); end if;
  if expired>0 then issues := array_append(issues,'expired_refresh'); end if;
  if ambiguous>0 then issues := array_append(issues,'ambiguous_refresh'); end if;
  if exhausted>0 then issues := array_append(issues,'run_budget_exhausted'); end if;
  select count(*) into history_exhausted from lean_private.history_jobs h
    where h.project_ref=p_project_ref and h.shop=p_shop and h.enabled and not h.complete and h.page_count>=h.max_pages;
  if history_exhausted>0 then issues := array_append(issues,'history_budget_exhausted'); end if;
  select count(*) into incomplete_full from lean_private.full_builds f
    join lean_private.report_builds b on b.run_id=f.base_run
    where f.project_ref=p_project_ref and b.shop=p_shop and f.enabled and f.completed_at is null and f.attempts>=3;
  if incomplete_full>0 then issues := array_append(issues,'full_attempts_exhausted'); end if;

  if target.require_export then
    select count(*),count(distinct s.publication_id),min(s.publication_id),
      min((f.policy->>'asOf')::timestamptz),bool_or(s.is_stale or not f.enabled or f.completed_at is null or p.state<>'certified')
      into selected_count,selected_distinct,selected_pub,selected_asof,selected_stale
      from lean_private.selected_publications s join lean_private.full_builds f on s.publication_id='full:'||f.run_id
      join lean_private.report_builds b on b.run_id=f.base_run
      join lean_private.publications p on p.publication_id=s.publication_id
      where f.project_ref=p_project_ref and b.shop=p_shop and
        s.domain=any(array['store_daily','product_daily','acquisition_daily','customer_cohorts','funnel_daily']);
    if selected_count<>5 or selected_distinct<>1 then issues := array_append(issues,'full_selection_missing_or_mixed');
    else
      if selected_stale or selected_asof is null or selected_asof>checked_at or
        selected_asof<checked_at-make_interval(secs=>target.max_candidate_age_seconds)
        then issues := array_append(issues,'selected_candidate_stale'); end if;
      select max(exported_at) into export_at from lean_private.export_audit where publication_id=selected_pub;
      if export_at is null then issues := array_append(issues,'selected_export_missing');
      elsif export_at<checked_at-make_interval(secs=>target.max_export_age_seconds)
        then issues := array_append(issues,'export_stale'); end if;
      if selected_pub is distinct from
        (select publication_id from lean_private.export_audit order by export_id desc limit 1)
        then issues := array_append(issues,'export_selection_mismatch'); end if;
    end if;
  end if;
  return jsonb_build_object('state',case when cardinality(issues)=0 then 'healthy' else 'attention' end,
    'issues',to_jsonb(issues),'checkedAt',to_char(checked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'candidateAt',to_char(candidate_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'candidateAsOf',to_char(candidate_asof at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'exportAt',to_char(export_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'counts',jsonb_build_object('blocked',blocked,'expired',expired,'ambiguous',ambiguous,
      'runBudgetExhausted',exhausted,'historyBudgetExhausted',history_exhausted,'fullAttemptsExhausted',incomplete_full),
    'posthogReadbackVerified',false);
end $$;
revoke all on function public.lean_refresh_health(text,text) from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_refresh_health(text,text) to service_role;
commit;
