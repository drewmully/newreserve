-- REVIEW ONLY. Monitoring configuration remains operator-owned and disabled.
-- Scoped releases may legitimately select different publications per domain.
begin;
create function lean_private.valid_monitor_domains(domains text[]) returns boolean
language sql immutable set search_path=pg_catalog as $$
  select domains is not null and cardinality(domains) between 1 and 5
    and domains<@array['store_daily','product_daily','acquisition_daily','customer_cohorts','funnel_daily']
    and array_position(domains,null) is null
    and (select count(distinct d) from unnest(domains) d)=cardinality(domains)
$$;
alter table lean_private.refresh_monitor_targets
  add column expected_domains text[] not null default
    array['store_daily','product_daily','acquisition_daily','customer_cohorts','funnel_daily']
    check(lean_private.valid_monitor_domains(expected_domains)),
  add column expected_history_feeds text[] not null default '{}'
    check(cardinality(expected_history_feeds)<=20 and array_position(expected_history_feeds,null) is null),
  add column max_history_lag_seconds integer not null default 86400
    check(max_history_lag_seconds between 60 and 2678400);
alter function public.lean_refresh_health(text,text) rename to lean_refresh_health_legacy;
revoke all on function public.lean_refresh_health_legacy(text,text)
  from public,anon,authenticated,service_role,lean_posthog_reader;

create function public.lean_refresh_health(p_project_ref text,p_shop text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb; target lean_private.refresh_monitor_targets;
  issues text[]; domain_name text; selected_pub text; vintage timestamptz; stale boolean;
  audit lean_private.export_audit; actual_count bigint; other_count bigint;
  export_at timestamptz; checked_at timestamptz := statement_timestamp();
  feed_name text; feed lean_private.history_feeds; removal_count integer;
begin
  result := public.lean_refresh_health_legacy(p_project_ref,p_shop);
  if result->>'state' in ('disabled','unconfigured') then return result; end if;
  select * into strict target from lean_private.refresh_monitor_targets
    where project_ref=p_project_ref and shop=p_shop;
  select coalesce(array_agg(i),'{}') into issues from jsonb_array_elements_text(result->'issues') i
    where i not in ('full_selection_missing_or_mixed','selected_candidate_stale',
      'selected_export_missing','export_stale','export_selection_mismatch');
  if target.require_export then
    foreach domain_name in array target.expected_domains loop
      selected_pub := null; vintage := null; stale := null;
      select s.publication_id,(f.policy->>'asOf')::timestamptz,
        s.is_stale or not f.enabled or f.completed_at is null or p.state<>'certified'
      into selected_pub,vintage,stale
      from lean_private.selected_publications s
      join lean_private.full_builds f on s.publication_id='full:'||f.run_id
      join lean_private.report_builds b on b.run_id=f.base_run
      join lean_private.publications p on p.publication_id=s.publication_id
      where s.domain=domain_name and f.project_ref=p_project_ref
        and b.project_ref=p_project_ref and b.shop=p_shop;
      if selected_pub is null then
        issues := array_append(issues,'selection_missing:'||domain_name);
        continue;
      end if;
      if stale or vintage is null or vintage>checked_at or
        vintage<checked_at-make_interval(secs=>target.max_candidate_age_seconds)
        then issues := array_append(issues,'selected_candidate_stale:'||domain_name); end if;
      -- An export of another domain must not make this domain fresh.
      select * into audit from lean_private.export_audit
        where row_counts ? domain_name order by export_id desc limit 1;
      if not found then
        issues := array_append(issues,'selected_export_missing:'||domain_name);
        continue;
      end if;
      if audit.publication_id is distinct from selected_pub then
        issues := array_append(issues,'export_selection_mismatch:'||domain_name);
      end if;
      if audit.exported_at<checked_at-make_interval(secs=>target.max_export_age_seconds)
        then issues := array_append(issues,'export_stale:'||domain_name); end if;
      export_at := least(coalesce(export_at,audit.exported_at),audit.exported_at);
      execute format('select count(*),count(*) filter(where publication_id is distinct from $1) from lean_export.%I',
        domain_name) into actual_count,other_count using selected_pub;
      if other_count<>0 or actual_count is distinct from (audit.row_counts->>domain_name)::bigint then
        issues := array_append(issues,'export_content_mismatch:'||domain_name);
      end if;
    end loop;
  end if;
  foreach feed_name in array target.expected_history_feeds loop
    select * into feed from lean_private.history_feeds where feed_id=feed_name
      and project_ref=p_project_ref and shop=p_shop;
    if not found then issues := array_append(issues,'history_feed_missing'); continue; end if;
    if not feed.enabled then issues := array_append(issues,'history_feed_disabled'); continue; end if;
    if feed.stop_time is null or feed.watermark<feed.stop_time then
      if feed.watermark<least(coalesce(feed.stop_time,checked_at),checked_at)
        -make_interval(secs=>target.max_history_lag_seconds)
        then issues := array_append(issues,'history_feed_lagging'); end if;
      if feed.counter_date=(checked_at at time zone 'UTC')::date and feed.used_steps>=feed.max_daily_steps
        then issues := array_append(issues,'history_feed_daily_budget_exhausted'); end if;
      if feed.active_run is not null and exists(select 1 from lean_private.history_jobs h
        where h.run_id=feed.active_run and not h.enabled)
        then issues := array_append(issues,'history_feed_blocked'); end if;
    end if;
  end loop;
  select count(*) into removal_count from lean_private.journey_removals r
    join lean_private.journey_grants g using(token_hash)
    where g.project_ref=p_project_ref and g.shop=p_shop and r.downstream_verified_at is null;
  if removal_count>0 then issues := array_append(issues,'privacy_removal_pending'); end if;
  select coalesce(array_agg(distinct i order by i),'{}') into issues from unnest(issues) i;
  return result||jsonb_build_object('state',case when cardinality(issues)=0 then 'healthy' else 'attention' end,
    'issues',to_jsonb(issues),'expectedDomains',to_jsonb(target.expected_domains),
    'pendingPrivacyRemovals',removal_count,
    'exportAt',to_char(export_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'posthogReadbackVerified',false);
end $$;
revoke all on function public.lean_refresh_health(text,text),lean_private.valid_monitor_domains(text[])
  from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_refresh_health(text,text) to service_role;
commit;
