-- REVIEW ONLY. Optional full-workbook integration; no runtime scope is enabled.
-- Requires existing 013/014/018-024/026/029/038 objects. Do not replay them or 050.
begin;
create table lean_private.production_workbook_delivery (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  run_id text references lean_private.full_builds,
  project_ref text,
  shop text,
  approval_ref text,
  check(not enabled or (run_id is not null and project_ref is not null and shop is not null and
    project_ref ~ '^[a-z]{20}$' and length(trim(shop))>0 and coalesce(length(trim(approval_ref)),0)>0))
);
alter table lean_private.production_workbook_delivery enable row level security;
insert into lean_private.production_workbook_delivery(singleton) values(true);
revoke all on lean_private.production_workbook_delivery from public,anon,authenticated,service_role;

-- Extend the existing input hash and finish path, not a second spend report store.
alter function public.lean_full_inputs(text,text) rename to lean_full_inputs_021;
revoke all on function public.lean_full_inputs_021(text,text) from public,anon,authenticated,service_role;
create function public.lean_full_inputs(p_run text,p_project_ref text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare input jsonb; r lean_private.full_builds; b lean_private.report_builds;
  packet jsonb; m jsonb; p lean_private.spend_pilots; d record; bases jsonb := '[]';
begin
  input := public.lean_full_inputs_021(p_run,p_project_ref);
  if input->>'state' is distinct from 'ready' then return input; end if;
  select * into r from lean_private.full_builds where run_id=p_run and project_ref=p_project_ref;
  select * into b from lean_private.report_builds where run_id=r.base_run and project_ref=p_project_ref for share;
  if not found or not b.enabled then return jsonb_build_object('state','blocked'); end if;
  if not(r.policy ? 'freshGoogleSpend') then
    if exists(select 1 from unnest(b.spend_runs) id where starts_with(id,'fresh-google:'))
      then return jsonb_build_object('state','blocked'); end if;
    return input;
  end if;
  packet := r.policy->'freshGoogleSpend'; m := packet->'manifest';
  if jsonb_typeof(packet) is distinct from 'object' or
    not(packet ?& array['manifest','controls','marketingInventory']) or
    packet-array['manifest','controls','marketingInventory']<>'{}'::jsonb or
    jsonb_typeof(m) is distinct from 'object' or jsonb_typeof(packet->'controls') is distinct from 'array' or
    jsonb_typeof(packet->'marketingInventory') is distinct from 'object' or
    m->>'projectRef' is distinct from p_project_ref or
    jsonb_typeof(m->'days') is distinct from 'array' or jsonb_array_length(m->'days') not between 1 and 7
    then raise exception 'invalid registered fresh spend policy'; end if;
  if cardinality(b.spend_runs)<>jsonb_array_length(m->'days') or
    (select count(distinct x) from unnest(b.spend_runs) x)<>cardinality(b.spend_runs)
    then return jsonb_build_object('state','blocked'); end if;
  -- One exact registered pilot. Manifest hash/run IDs are also checked by the
  -- existing TypeScript registration validator before any facts are transformed.
  select p0.* into p from lean_private.spend_pilots p0
    join lean_private.spend_pilot_days day on day.pilot_id=p0.pilot_id
    where day.run_id=b.spend_runs[1] and p0.project_ref=p_project_ref for share of p0;
  if not found or not p.enabled or p.pilot_id !~ '^fresh-google:[a-f0-9]{64}$' or
    p.account_id is distinct from m->>'accountId' or
    p.login_customer_id is distinct from m->>'loginCustomerId' or
    p.max_pages is distinct from (m->>'maxPages')::integer or
    p.expires_at is distinct from (m->>'expiresAt')::timestamptz or
    p.approval_ref is distinct from m->>'approvalRef' or p.actor_ref is distinct from m->>'actorRef' or
    coalesce((m->>'preparedAt')::timestamptz>clock_timestamp(),true) or
    p.expires_at<=clock_timestamp() then return jsonb_build_object('state','blocked'); end if;
  if (select count(*) from lean_private.spend_pilot_days where pilot_id=p.pilot_id)<>cardinality(b.spend_runs)
    then return jsonb_build_object('state','blocked'); end if;
  perform 1 from lean_private.spend_jobs where run_id=any(b.spend_runs) order by run_id for share;
  for d in
    select j.*,day.pilot_id,day.due_at from lean_private.spend_jobs j
    join lean_private.spend_pilot_days day using(run_id)
    where j.run_id=any(b.spend_runs) order by j.report_date
  loop
    if not d.enabled or d.base is null or d.project_ref<>p_project_ref or d.pilot_id<>p.pilot_id or
      d.account_id<>p.account_id or d.login_customer_id is distinct from p.login_customer_id or
      d.run_id<>p.pilot_id||':'||d.report_date::text or
      not exists(select 1 from jsonb_array_elements(m->'days') x
        where x->>'date'=d.report_date::text and (x->>'dueAt')::timestamptz=d.due_at) or
      d.report_date not between b.from_date and b.through_date or
      d.base->>'baseReportId' is distinct from d.run_id or
      d.base->>'sourceCurrency' is distinct from m->>'sourceCurrency' or
      d.base->>'sourceTimezone' is distinct from m->>'sourceTimezone'
      then return jsonb_build_object('state','blocked'); end if;
    bases := bases||jsonb_build_array(d.base);
  end loop;
  if jsonb_array_length(bases)<>cardinality(b.spend_runs) or
    (select coalesce(sum(jsonb_array_length(x->'rows')),0) from jsonb_array_elements(bases) x)>10000 or
    p.expires_at<=clock_timestamp() then return jsonb_build_object('state','blocked'); end if;
  input := (input-'inputHash')||jsonb_build_object('freshGoogleSpend',
    jsonb_build_object('manifest',m,'bases',bases,'controls',packet->'controls','marketingInventory',packet->'marketingInventory'));
  if octet_length(input::text)>8000000 then raise exception 'full input budget'; end if;
  return input||jsonb_build_object('inputHash',md5(input::text));
end $$;

alter function public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb) rename to lean_full_finish_021;
revoke all on function public.lean_full_finish_021(text,text,uuid,text,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role;
create function public.lean_full_finish(p_run text,p_project_ref text,p_token uuid,p_input_hash text,
  p_facts jsonb,p_reports jsonb,p_manifest jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare done boolean; expiry timestamptz;
begin
  -- The original finish locks the build/base and re-calls the enriched input RPC.
  -- Its source locks last through commit; an expiry during insertion rolls back.
  done := public.lean_full_finish_021(p_run,p_project_ref,p_token,p_input_hash,p_facts,p_reports,p_manifest);
  select (policy#>>'{freshGoogleSpend,manifest,expiresAt}')::timestamptz into expiry
    from lean_private.full_builds where run_id=p_run and project_ref=p_project_ref;
  if done and expiry<=clock_timestamp() then raise exception 'fresh spend expired during full finish'; end if;
  return done;
end $$;

-- The existing orchestrator must dispatch fresh-google runs through its v2
-- reader, never fall back to an ordinary spend collector on missing policy.
alter function public.lean_full_next(text,text) rename to lean_full_next_024;
revoke all on function public.lean_full_next_024(text,text) from public,anon,authenticated,service_role;
create function public.lean_full_next(p_run text,p_project_ref text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare input jsonb; m jsonb; configured boolean; p lean_private.spend_pilots;
begin
  input := public.lean_full_next_024(p_run,p_project_ref);
  if input->>'state' is distinct from 'ready' or input->>'stage' is distinct from 'spend' then return input; end if;
  select policy#>'{freshGoogleSpend,manifest}',policy ? 'freshGoogleSpend' into m,configured from lean_private.full_builds
    where run_id=p_run and project_ref=p_project_ref;
  if not configured and not starts_with(input->>'runId','fresh-google:') then return input; end if;
  if not configured or not starts_with(input->>'runId','fresh-google:') or
    jsonb_typeof(m) is distinct from 'object' or m->>'projectRef' is distinct from p_project_ref
    then return jsonb_build_object('state','blocked'); end if;
  select p0.* into p from lean_private.spend_pilots p0 join lean_private.spend_pilot_days d using(pilot_id)
    where d.run_id=input->>'runId' and p0.project_ref=p_project_ref for share of p0;
  if not found or not p.enabled or p.expires_at<=clock_timestamp() or
    p.expires_at is distinct from (m->>'expiresAt')::timestamptz or
    p.account_id is distinct from m->>'accountId' or
    p.login_customer_id is distinct from m->>'loginCustomerId' or
    coalesce((m->>'preparedAt')::timestamptz>clock_timestamp(),true)
    then return jsonb_build_object('state','blocked'); end if;
  return input||jsonb_build_object('freshGoogleSpendManifest',m);
end $$;

create function public.lean_production_workbook_reports_read(p_project_ref text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare g lean_private.production_workbook_delivery; r lean_private.full_builds; b lean_private.report_builds;
  pub text; t text; fields text[]; metrics text[]; selected text[]; projection text; rows jsonb; result jsonb := '{}';
  metadata jsonb; statuses jsonb := '[]'; readiness jsonb; stale boolean;
  common text[] := array['shop_id','publication_id','definition_version','readiness','is_stale'];
  domains text[] := array['store_daily','product_daily','acquisition_daily','customer_cohorts','funnel_daily'];
begin
  select * into g from lean_private.production_workbook_delivery where singleton and enabled and project_ref=p_project_ref;
  if not found then return null; end if;
  select * into r from lean_private.full_builds where run_id=g.run_id and project_ref=g.project_ref and enabled;
  if not found or r.completed_at is null then return null; end if;
  select * into b from lean_private.report_builds where run_id=r.base_run and project_ref=g.project_ref and shop=g.shop and enabled;
  if not found or b.completed_at is null then return null; end if;
  pub := 'full:'||r.run_id;
  if not exists(select 1 from lean_private.publications where publication_id=pub and state='certified') then return null; end if;
  select array_agg(s.domain order by s.domain) into selected from lean_private.selected_publications s
    join lean_private.certifications c using(publication_id,domain)
    where s.domain=any(domains) and s.publication_id=pub;
  if coalesce(cardinality(selected),0)=0 then return null; end if;
  -- Do not bypass 029's selection/removal invalidation with a raw private read.
  if exists(select 1 from lean_private.journey_removals where downstream_verified_at is null or
    requested_at>(r.policy->>'asOf')::timestamptz) then return null; end if;
  metadata := jsonb_build_object('report_scope','selected_full_build',
    'shop_id',b.shop,'publication_id',pub,'definition_version',r.policy->>'definition',
    'model_version',r.policy#>>'{attribution,modelVersion}','funnel_version',r.policy->>'funnelVersion',
    'as_of_at',r.policy->>'asOf','report_from_date',b.from_date::text,'report_through_date',b.through_date::text,
    'atomic_resource_refresh',false);
  foreach t in array domains loop
    fields := common||case t
      when 'store_daily' then array['report_date','gross_merchandise_sales_usd','discounts_usd','refunds_usd',
        'net_merchandise_sales_usd','shipping_net_usd','tax_net_usd','duty_net_usd','other_sales_adjustments_usd',
        'total_sales_usd','collected_cash_usd','eligible_orders','purchase_merchandise_net_usd','new_customers',
        'spend_usd','ncac_usd','mer','aov_usd']
      when 'product_daily' then array['report_date','sku_bucket','units','gross_merchandise_sales_usd',
        'discounts_usd','refunds_usd','net_merchandise_sales_usd']
      when 'acquisition_daily' then array['report_date','channel','campaign_bucket','model_version',
        'attributed_purchase_merchandise_net_usd','credited_orders','weighted_new_customers','spend_usd','first_party_roas','ncac_usd']
      when 'customer_cohorts' then array['cohort_month','observation_age_days','acquisition_definition_version',
        'as_of_at','mature','cohort_customers','repeat_customers','observed_net_merchandise_sales_usd',
        'repeat_purchase_rate','revenue_ltv_usd']
      else array['report_date','stage_id','funnel_version','measured_sessions','stage_reached_sessions',
        'mature_sessions','converted_sessions','session_conversion_rate'] end;
    select array_agg(k) into metrics from unnest(fields) k where
      not(k=any(common||array['report_date','sku_bucket','channel','campaign_bucket','model_version',
        'cohort_month','observation_age_days','acquisition_definition_version','as_of_at','mature','stage_id','funnel_version']));
    if not(t=any(selected)) then
      result := result||jsonb_build_object(t,'[]'::jsonb);
      select jsonb_object_agg(k,'unavailable'::text) into readiness from unnest(metrics) k;
      statuses := statuses||jsonb_build_array(metadata||jsonb_build_object('resource_name',t,
        'state','not_selected','row_count',null,'is_stale',null,'readiness',readiness));
      continue;
    end if;
    if (select count(*) from pg_attribute where attrelid=format('lean_analytics.%I',t)::regclass
      and attnum>0 and not attisdropped and attname=any(fields))<>cardinality(fields)
      then raise exception 'workbook reporting schema mismatch'; end if;
    select string_agg(format('%L,%s',a.attname,case
      when a.atttypid in ('numeric'::regtype,'int2'::regtype,'int4'::regtype,'int8'::regtype,'date'::regtype)
        then format('x.%I::text',a.attname)
      when a.atttypid='timestamptz'::regtype then
        format('to_char(x.%I at time zone ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',a.attname)
      else format('x.%I',a.attname) end),',' order by a.attnum) into projection
      from pg_attribute a where a.attrelid=format('lean_analytics.%I',t)::regclass
        and a.attnum>0 and not a.attisdropped and a.attname=any(fields);
    -- Views preserve row.is_stale OR selection.is_stale. No sums, joins to raw
    -- source facts, default zeros, readiness edits or silent limit truncation.
    execute format('select coalesce(jsonb_agg(jsonb_build_object(%s) order by to_jsonb(x)::text),''[]''::jsonb)
      from lean_analytics.%I x where publication_id=$1',projection,t) into rows using pub;
    if jsonb_array_length(rows)>(case when t='store_daily' then 31 when t='customer_cohorts' then 100 else 20000 end)
      then raise exception 'workbook report row budget'; end if;
    result := result||jsonb_build_object(t,rows);
    select s.is_stale or exists(select 1 from jsonb_array_elements(rows) x where x->'is_stale'='true'::jsonb)
      into stale from lean_private.selected_publications s where s.domain=t and s.publication_id=pub;
    select jsonb_object_agg(k,case
      when jsonb_array_length(rows)=0 then 'no_rows'
      when (select count(distinct x->'readiness'->>k) from jsonb_array_elements(rows) x)>1 then 'mixed'
      else rows->0->'readiness'->>k end) into readiness from unnest(metrics) k;
    statuses := statuses||jsonb_build_array(metadata||jsonb_build_object('resource_name',t,
      'state','selected','row_count',jsonb_array_length(rows)::text,'is_stale',stale,'readiness',readiness));
  end loop;
  result := result||jsonb_build_object('report_status',statuses);
  if octet_length(result::text)>4194304 then raise exception 'workbook report byte budget'; end if;
  return result;
end $$;
revoke all on function public.lean_full_inputs(text,text),public.lean_full_next(text,text),
  public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb),
  public.lean_production_workbook_reports_read(text) from public,anon,authenticated,service_role;
do $acl$
begin
  if exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.oid=any(array['public.lean_full_inputs(text,text)'::regprocedure,'public.lean_full_next(text,text)'::regprocedure,
      'public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb)'::regprocedure,
      'public.lean_full_inputs_021(text,text)'::regprocedure,'public.lean_full_next_024(text,text)'::regprocedure,
      'public.lean_full_finish_021(text,text,uuid,text,jsonb,jsonb,jsonb)'::regprocedure,
      'public.lean_production_workbook_reports_read(text)'::regprocedure]) and a.grantee<>p.proowner) or
    exists(select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
      where c.oid='lean_private.production_workbook_delivery'::regclass and a.grantee<>c.relowner)
    then raise exception 'unexpected workbook delivery grantee'; end if;
end $acl$;
grant execute on function public.lean_full_inputs(text,text),public.lean_full_next(text,text),
  public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb),
  public.lean_production_workbook_reports_read(text) to service_role;
commit;
