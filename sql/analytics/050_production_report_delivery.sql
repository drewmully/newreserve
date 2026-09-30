-- REVIEW ONLY. Additive aggregate boundary after 047; no source/job/feed enabled.
begin;
create table lean_private.production_report_delivery (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  approval_ref text,
  check(not enabled or (approval_ref is not null and length(trim(approval_ref))>0))
);
alter table lean_private.production_report_delivery enable row level security;
insert into lean_private.production_report_delivery(singleton) values(true);
revoke all on lean_private.production_report_delivery from public,anon,authenticated,service_role;

create function public.lean_production_reports_read() returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare stores jsonb; products jsonb; result jsonb;
begin
  if not exists(select 1 from lean_private.production_report_delivery where enabled)
    then return null; end if;
  if not exists(select 1 from lean_private.pipeline_scope
    where shop='mullybox-store.myshopify.com' and project_ref='xnfjdbpjuaezxjgargto')
    then raise exception 'production report target missing'; end if;
  -- Latest heads only: never the historical selected-order sample or old revisions.
  with sums as (
    select report_date,definition_version,bool_or(is_stale or pipeline_stale) is_stale,
      case when bool_and(gross_merchandise_sales_usd is not null) then sum(gross_merchandise_sales_usd) end gross_merchandise_sales_usd,
      case when bool_and(discounts_usd is not null) then sum(discounts_usd) end discounts_usd,
      case when bool_and(refunds_usd is not null) then sum(refunds_usd) end refunds_usd,
      case when bool_and(net_merchandise_sales_usd is not null) then sum(net_merchandise_sales_usd) end net_merchandise_sales_usd,
      case when bool_and(shipping_net_usd is not null) then sum(shipping_net_usd) end shipping_net_usd,
      case when bool_and(tax_net_usd is not null) then sum(tax_net_usd) end tax_net_usd,
      case when bool_and(duty_net_usd is not null) then sum(duty_net_usd) end duty_net_usd,
      case when bool_and(other_sales_adjustments_usd is not null) then sum(other_sales_adjustments_usd) end other_sales_adjustments_usd,
      case when bool_and(total_sales_usd is not null) then sum(total_sales_usd) end total_sales_usd,
      case when bool_and(eligible_orders is not null) then sum(eligible_orders) end eligible_orders,
      case when bool_and(purchase_merchandise_net_usd is not null) then sum(purchase_merchandise_net_usd) end purchase_merchandise_net_usd
    from lean_analytics.observed_order_daily
    where shop_id='mullybox-store.myshopify.com' group by report_date,definition_version
  ), serialized as (
    select report_date,definition_version,is_stale,
      gross_merchandise_sales_usd::numeric(20,6)::text gross_merchandise_sales_usd,
      discounts_usd::numeric(20,6)::text discounts_usd,refunds_usd::numeric(20,6)::text refunds_usd,
      net_merchandise_sales_usd::numeric(20,6)::text net_merchandise_sales_usd,
      shipping_net_usd::numeric(20,6)::text shipping_net_usd,tax_net_usd::numeric(20,6)::text tax_net_usd,
      duty_net_usd::numeric(20,6)::text duty_net_usd,
      other_sales_adjustments_usd::numeric(20,6)::text other_sales_adjustments_usd,
      total_sales_usd::numeric(20,6)::text total_sales_usd,eligible_orders::text eligible_orders,
      purchase_merchandise_net_usd::numeric(20,6)::text purchase_merchandise_net_usd,
      (purchase_merchandise_net_usd/nullif(eligible_orders,0))::numeric(20,6)::text aov_usd,
      null::text collected_cash_usd,null::text new_customers,null::text spend_usd,
      null::text ncac_usd,null::text mer
    from sums
  )
  select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object(
    'report_scope','webhook_observed_only','certified',false,'complete_window',false,
    'readiness',(select jsonb_object_agg(key,case when value='null'::jsonb then 'withheld' else 'observed_unverified' end)
      from jsonb_each(to_jsonb(s)-array['report_date','definition_version','is_stale']))
    ) order by report_date,definition_version),'[]'::jsonb) into stores from serialized s;

  with serialized as (
    select report_date,definition_version,sku_bucket,(is_stale or pipeline_stale) is_stale,
      units::numeric(20,6)::text units,
      gross_merchandise_sales_usd::numeric(20,6)::text gross_merchandise_sales_usd,
      discounts_usd::numeric(20,6)::text discounts_usd,refunds_usd::numeric(20,6)::text refunds_usd,
      net_merchandise_sales_usd::numeric(20,6)::text net_merchandise_sales_usd
    from lean_analytics.observed_product_daily where shop_id='mullybox-store.myshopify.com'
  )
  select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object(
    'report_scope','webhook_observed_only','certified',false,'complete_window',false,
    'readiness',(select jsonb_object_agg(key,case when value='null'::jsonb then 'withheld' else 'observed_unverified' end)
      from jsonb_each(to_jsonb(s)-array['report_date','definition_version','is_stale','sku_bucket']))
    ) order by report_date,definition_version,sku_bucket),'[]'::jsonb) into products from serialized s;
  -- Reject overflow; do not silently export a truncated first page.
  if jsonb_array_length(stores)>366 or jsonb_array_length(products)>10000
    then raise exception 'production report row budget'; end if;
  result:=jsonb_build_object('store_daily',stores,'product_daily',products);
  if octet_length(result::text)>4194304 then raise exception 'production report byte budget'; end if;
  return result;
end $$;
revoke all on function public.lean_production_reports_read() from public,anon,authenticated,service_role;
do $acl$
declare recipient text;
begin
  -- Close known defaults only on new objects; unexpected grantees abort install.
  if exists(select 1 from pg_roles where rolname='lean_posthog_reader') then
    revoke all on function public.lean_production_reports_read() from lean_posthog_reader;
    revoke all on lean_private.production_report_delivery from lean_posthog_reader;
  end if;
  select r.rolname into recipient from pg_proc p cross join lateral aclexplode(p.proacl) a
    join pg_roles r on r.oid=a.grantee
    where p.oid='public.lean_production_reports_read()'::regprocedure and a.grantee<>p.proowner limit 1;
  if recipient is not null then raise exception 'unexpected report function grantee'; end if;
  select r.rolname into recipient from pg_class c cross join lateral aclexplode(c.relacl) a
    join pg_roles r on r.oid=a.grantee
    where c.oid='lean_private.production_report_delivery'::regclass and a.grantee<>c.relowner limit 1;
  if recipient is not null then raise exception 'unexpected report table grantee'; end if;
end $acl$;
grant execute on function public.lean_production_reports_read() to service_role;
commit;
