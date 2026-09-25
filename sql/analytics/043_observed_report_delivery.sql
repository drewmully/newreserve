-- Fixed, owner-authorized delivery of completed 041 aggregate observations.
-- No publication selection, certification, source reads, or DB login for PostHog.
begin;
create table lean_private.observed_report_delivery (
  scope_id text primary key,
  scope jsonb not null,
  projection_hash text not null,
  enabled boolean not null default false,
  expires_at timestamptz not null
);
alter table lean_private.observed_report_delivery enable row level security;
revoke all on lean_private.observed_report_delivery from public,anon,authenticated,service_role;

create function lean_private.observed_report_projection(p_scope jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
declare s jsonb; progress lean_private.history_report_progress; item jsonb; projected jsonb;
  metric text; domain text; pub text; rows jsonb; stores jsonb:='[]'; acquisitions jsonb:='[]';
  snapshots jsonb:='[]'; metrics text[]; common text[];
begin
  if p_scope->>'projectRef' is distinct from 'xeqlgxvrhgwwudyqtnun' or
    p_scope->>'shop' is distinct from 'mullybox-store.myshopify.com' or
    jsonb_typeof(p_scope->'snapshots') is distinct from 'array' or
    jsonb_array_length(p_scope->'snapshots') not between 1 and 7
    then raise exception 'observed delivery scope'; end if;
  if (select count(distinct value->>'date') from jsonb_array_elements(p_scope->'snapshots')) <>
    jsonb_array_length(p_scope->'snapshots') then raise exception 'observed duplicate date'; end if;
  for s in select value from jsonb_array_elements(p_scope->'snapshots') order by value->>'date' loop
    if s-array['runId','snapshotId','date','inputHash','resultHash']<>'{}'::jsonb or
      coalesce(s->>'inputHash','') !~ '^[a-f0-9]{64}$' or coalesce(s->>'resultHash','') !~ '^[a-f0-9]{64}$'
      then raise exception 'observed snapshot binding'; end if;
    select * into progress from lean_private.history_report_progress
      where run_id=s->>'runId' and snapshot_id=s->>'snapshotId';
    if not found or progress.completed_at is null or progress.report_date is distinct from (s->>'date')::date or
      progress.input_hash is distinct from s->>'inputHash' or progress.result_hash is distinct from s->>'resultHash' or
      progress.input->>'inputHash' is distinct from s->>'inputHash' or
      encode(sha256(convert_to((progress.input-'inputHash')::text,'UTF8')),'hex') is distinct from s->>'inputHash' or
      progress.input->>'shop' is distinct from p_scope->>'shop' or
      progress.input#>'{coverage,financialCoverageComplete}' is distinct from 'false'::jsonb or
      progress.input#>'{coverage,allAccountSpendCoverageComplete}' is distinct from 'false'::jsonb
      then raise exception 'observed snapshot changed'; end if;
    pub:='history-progress:'||(s->>'runId')||':'||(s->>'snapshotId');
    if progress.input->>'publication' is distinct from pub then raise exception 'observed publication binding'; end if;
    foreach domain in array array['store_daily','acquisition_daily'] loop
      if domain='store_daily' then
        metrics:=array['gross_merchandise_sales_usd','discounts_usd','refunds_usd','net_merchandise_sales_usd',
          'shipping_net_usd','tax_net_usd','duty_net_usd','other_sales_adjustments_usd','total_sales_usd',
          'collected_cash_usd','eligible_orders','purchase_merchandise_net_usd','new_customers','spend_usd',
          'ncac_usd','mer','aov_usd'];
        common:=array['report_date','definition_version','is_stale','readiness'];
        select coalesce(jsonb_agg(to_jsonb(r) order by report_date),'[]') into rows
          from lean_private.report_store_daily r where publication_id=pub;
        if jsonb_array_length(rows)<>1 then raise exception 'observed store rows'; end if;
      else
        metrics:=array['attributed_purchase_merchandise_net_usd','credited_orders','weighted_new_customers',
          'spend_usd','first_party_roas','ncac_usd'];
        common:=array['report_date','definition_version','is_stale','readiness','channel','campaign_bucket','model_version'];
        select coalesce(jsonb_agg(to_jsonb(r) order by channel,campaign_bucket,model_version),'[]') into rows
          from lean_private.report_acquisition_daily r where publication_id=pub;
      end if;
      if jsonb_array_length(rows)>1000 then raise exception 'observed row budget'; end if;
      for item in select value from jsonb_array_elements(rows) loop
        if item->>'shop_id' is distinct from p_scope->>'shop' or item->>'report_date' is distinct from s->>'date' or
          item->>'definition_version' is distinct from 'history-bridge-v1' or item->'is_stale' is distinct from 'true'::jsonb or
          jsonb_typeof(item->'readiness') is distinct from 'object' or
          (item->'readiness')-metrics<>'{}'::jsonb or
          exists(select 1 from jsonb_each_text(item->'readiness') v where v.value not in ('observed_unverified','withheld')) or
          item#>>'{readiness,spend_usd}' is distinct from 'observed_unverified' or
          jsonb_typeof(item->'spend_usd') is distinct from 'number' or (item->>'spend_usd')::numeric<0
          then raise exception 'observed metric boundary'; end if;
        if domain='acquisition_daily' and (item->>'channel' is distinct from 'google_ads' or
          coalesce(item->>'campaign_bucket','') !~ '^([a-f0-9]{64}|spend_unallocated)$' or
          item->>'model_version' is distinct from 'commerce-only')
          then raise exception 'observed dimension boundary'; end if;
        select jsonb_object_agg(k,item->k) into projected from unnest(common) k;
        -- Custom REST imports the arrays, so scope warnings must travel per row.
        projected:=projected||jsonb_build_object('report_scope','selected_google_account_saved_snapshots',
          'certified',false,'all_account_spend_coverage_complete',false);
        foreach metric in array metrics loop
          if metric<>'spend_usd' and (item->metric is distinct from 'null'::jsonb or
            item#>>array['readiness',metric] is distinct from 'withheld')
            then raise exception 'observed nonspend boundary'; end if;
          -- Decimal text is exact; do not round money through JavaScript floats.
          projected:=projected||jsonb_build_object(metric,case when metric='spend_usd' then item->>metric else null end);
        end loop;
        if domain='store_daily' then stores:=stores||jsonb_build_array(projected);
        else acquisitions:=acquisitions||jsonb_build_array(projected); end if;
      end loop;
    end loop;
    snapshots:=snapshots||jsonb_build_array(jsonb_build_object('report_date',s->>'date','completed_at',progress.completed_at));
  end loop;
  if jsonb_array_length(acquisitions)>1000 then raise exception 'observed total row budget'; end if;
  projected:=jsonb_build_object('store_daily',stores,'acquisition_daily',acquisitions,'coverage',
    jsonb_build_object('status','observed_unverified','scope','selected_google_account_saved_snapshots',
      'financial_coverage_complete',false,'all_account_spend_coverage_complete',false,
      'certified',false,'snapshots',snapshots,
      'unavailable_domains',jsonb_build_array('product_daily','customer_cohorts','funnel_daily')));
  if octet_length(projected::text)>1048576 then raise exception 'observed byte budget'; end if;
  return projected;
end $$;

create function public.lean_observed_reports_register(p_scope jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb; h text; old lean_private.observed_report_delivery; expires timestamptz;
begin
  if p_scope-array['scopeId','projectRef','shop','snapshots','expiresAt','approvalRef','actorRef']<>'{}'::jsonb or
    coalesce(p_scope->>'scopeId','') !~ '^[a-zA-Z0-9_-]{1,100}$' or
    length(coalesce(p_scope->>'approvalRef','')) not between 1 and 500 or
    length(coalesce(p_scope->>'actorRef','')) not between 1 and 200
    then raise exception 'observed registration'; end if;
  expires:=(p_scope->>'expiresAt')::timestamptz;
  if expires is null or not isfinite(expires) or expires<=clock_timestamp() or expires>clock_timestamp()+interval '24 hours'
    then raise exception 'observed expiry'; end if;
  result:=lean_private.observed_report_projection(p_scope);
  h:=encode(sha256(convert_to(result::text,'UTF8')),'hex');
  insert into lean_private.observed_report_delivery(scope_id,scope,projection_hash,expires_at)
    values(p_scope->>'scopeId',p_scope,h,expires) on conflict do nothing;
  select * into old from lean_private.observed_report_delivery where scope_id=p_scope->>'scopeId' for update;
  if old.scope is distinct from p_scope or old.projection_hash is distinct from h then raise exception 'observed registration conflict'; end if;
  return true;
end $$;

create function public.lean_observed_reports_read(p_scope_id text,p_project text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.observed_report_delivery; result jsonb;
begin
  select * into r from lean_private.observed_report_delivery where scope_id=p_scope_id for share;
  if not found or p_project is distinct from r.scope->>'projectRef' or not r.enabled or r.expires_at<=clock_timestamp()
    then raise exception 'observed delivery unavailable'; end if;
  result:=lean_private.observed_report_projection(r.scope);
  if encode(sha256(convert_to(result::text,'UTF8')),'hex') is distinct from r.projection_hash or
    r.expires_at<=clock_timestamp() then raise exception 'observed projection changed or expired'; end if;
  return result;
end $$;
revoke all on function lean_private.observed_report_projection(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.lean_observed_reports_register(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.lean_observed_reports_read(text,text) from public,anon,authenticated,service_role;
grant execute on function public.lean_observed_reports_read(text,text) to service_role;
commit;
