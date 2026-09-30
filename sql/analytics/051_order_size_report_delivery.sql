-- REVIEW ONLY: size-only read capability after 050. No source/HTTP gate is enabled.
-- 046 is optional at install but mandatory at read/size-policy activation.
-- The marked SELECT is copied verbatim from OWNER_ORDER_SIZE_REPORT_SQL; parity is tested.
begin;
create function public.lean_order_size_reports_read() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $function$
declare cfg lean_private.pipeline_scope; first_date date; last_date date; result jsonb; payload jsonb;
begin
  if not exists(select 1 from lean_private.production_report_delivery where enabled) or
    to_regclass('lean_private.order_item_sizes') is null then return null; end if;
  select * into cfg from lean_private.pipeline_scope where shop='mullybox-store.myshopify.com'
    and project_ref='xnfjdbpjuaezxjgargto';
  if not found or not cfg.enabled or
    cfg.policy->'productClasses' is distinct from '{"8501257044160":"merchandise"}'::jsonb or
    cfg.policy->>'sourceProjection' is distinct from 'financial_no_geo_order_size' or
    cfg.policy->>'sourceRetention' is distinct from 'financial_allowlist_v1' or
    cfg.policy->>'retainedReports' is distinct from 'product-v1' or
    cfg.policy#>'{orderSize,productSemantics}' is distinct from '{"8501257044160":"requested_box_top_size"}'::jsonb or
    coalesce(btrim(cfg.policy#>>'{orderSize,policyRef}'),'')='' then return null; end if;
  -- No caller date selectors or partial denominator filtering. Any incompatible
  -- head is unavailable; original size-off claims remain explicitly not_collected.
  if exists(select 1 from lean_private.pipeline_heads h left join lean_private.pipeline_snapshots s on s.work_id=h.work_id
    where h.shop=cfg.shop and (s.work_id is null or s.from_time is distinct from cfg.from_time or
      s.until_time is distinct from cfg.until_time or s.policy->'productClasses' is distinct from cfg.policy->'productClasses' or
      s.policy->>'sourceRetention' is distinct from 'financial_allowlist_v1' or
      s.policy->>'retainedReports' is distinct from 'product-v1' or
      case when s.policy ? 'orderSize' then
        s.policy#>'{orderSize,productSemantics}' is distinct from cfg.policy#>'{orderSize,productSemantics}' or
        s.policy->>'sourceProjection' is distinct from 'financial_no_geo_order_size'
      else s.policy->>'sourceProjection' is distinct from 'financial_no_geo' end))
    then return null; end if;
  if not exists(select 1 from lean_private.pipeline_heads where shop=cfg.shop) then
    return jsonb_build_object('coverage_status','no_selected_orders','order_size_daily','[]'::jsonb);
  end if;
  select min(o.purchase_date),max(o.purchase_date) into first_date,last_date
    from lean_private.pipeline_heads h join lean_private.pipeline_snapshots s using(work_id)
    join lean_private.orders o on o.publication_id=s.publication_id where h.shop=cfg.shop;
  if first_date is null or last_date is null then return null; end if;
  execute $order_size$

with args as (select $1::text shop,$2::date first_date,$3::date last_date),
heads as (
  select h.shop,h.order_gid,h.work_id,h.revision,h.source head_source,
    s.shop snapshot_shop,s.order_gid snapshot_gid,s.revision snapshot_revision,s.source,s.policy,
    s.publication_id,s.from_time,s.until_time,w.state,w.completed_at
  from lean_private.pipeline_heads h cross join args a
  left join lean_private.pipeline_snapshots s on s.work_id=h.work_id
  left join lean_private.work w on w.work_id=h.work_id where h.shop=a.shop
), selected as (
  select h.*,o.order_id,o.source_order_id,o.source_updated_at,o.shop_id,o.created_at,
    o.purchase_date,o.paid_at,o.eligibility_status,o.source_currency
  from heads h left join lean_private.orders o on o.publication_id=h.publication_id
), lines as (
  select s.*,i.order_item_id,i.order_id item_order,i.product_id,i.source_line_id,i.quantity,i.sku,i.item_class,
    i.purchase_value_complete,i.source_currency item_currency,
    z.order_item_id size_item,z.size_semantics,z.size_status,z.size_value,z.size_source,
    z.policy_ref,z.source_evidence_ref,z.mapping_version,r.value raw_line
  from selected s left join lean_private.order_items i on i.publication_id=s.publication_id
  left join lean_private.order_item_sizes z on z.order_item_id=i.order_item_id and z.publication_id=i.publication_id
  left join lateral jsonb_array_elements(s.source#>'{commerce,order,lineItems,nodes}') r
    on r.value->>'id'='gid://shopify/LineItem/'||i.source_line_id
), checked as (
  select l.*,coalesce(policy#>>array['orderSize','productSemantics',
    replace(raw_line#>>'{product,id}','gid://shopify/Product/','')],'unsupported') expected_semantics
  from lines l
), evidence as (
  select c.*,raw_line#>array['orderSize',case expected_semantics
    when 'requested_box_top_size' then 'topSize' else 'variantTitle' end] chosen,
    case when source#>>'{commerce,projection}' is distinct from 'financial_no_geo_order_size' or
      not raw_line ? 'orderSize' then 'projection_absent'
    when expected_semantics='unsupported' then 'unsupported'
    when raw_line#>>'{orderSize,topSize,status}'='known' and raw_line#>>'{orderSize,variantTitle,status}'='known' and
      raw_line#>>'{orderSize,topSize,value}' is distinct from raw_line#>>'{orderSize,variantTitle,value}' then 'conflict'
    else raw_line#>>array['orderSize',case expected_semantics
      when 'requested_box_top_size' then 'topSize' else 'variantTitle' end,'status'] end expected_status
  from checked c
), valid as (
  select (a.shop ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' and
    a.first_date<=a.last_date and a.last_date-a.first_date<=366 and
    exists(select 1 from heads) and
    not exists(select 1 from selected group by work_id having count(*)<>1) and
    not exists(select 1 from selected group by order_id having count(*)<>1) and
    not exists(select 1 from selected s where (select count(*) from lean_private.order_items i
      where i.publication_id=s.publication_id)<>jsonb_array_length(s.source#>'{commerce,order,lineItems,nodes}')) and
    not exists(select 1 from checked group by order_item_id having count(*)<>1) and
    not exists(select 1 from evidence where
      state is distinct from 'done' or completed_at is null or order_id is null or order_item_id is null or
      snapshot_shop is distinct from shop or snapshot_gid is distinct from order_gid or
      snapshot_revision is distinct from revision or source is distinct from head_source or
      source#>>'{commerce,apiVersion}' is distinct from '2026-07' or
      order_gid !~ '^gid://shopify/Order/[1-9][0-9]*$' or
      source#>'{commerce,order,edited}' is distinct from 'false'::jsonb or
      source#>'{commerce,order,taxesIncluded}' is distinct from 'false'::jsonb or
      source#>'{commerce,order,test}' is distinct from 'false'::jsonb or
      source#>'{commerce,order,cancelledAt}' is distinct from 'null'::jsonb or
      source#>>'{commerce,shop}' is distinct from shop or source#>>'{commerce,order,id}' is distinct from order_gid or
      source#>'{commerce,order,lineItems,pageInfo,hasNextPage}' is distinct from 'false'::jsonb or
      (source#>>'{commerce,order,updatedAt}')::timestamptz is distinct from revision or
      shop_id is distinct from shop or 'gid://shopify/Order/'||source_order_id is distinct from order_gid or
      source_updated_at is distinct from revision or eligibility_status is distinct from 'eligible' or
      order_id is distinct from encode(sha256(convert_to(replace(jsonb_build_array(shop,source_order_id)::text,', ',','),'UTF8')),'hex') or
      order_item_id is distinct from encode(sha256(convert_to(replace(
        jsonb_build_array(shop,source_order_id,source_line_id)::text,', ',','),'UTF8')),'hex') or
      source_currency is distinct from 'USD' or purchase_date is null or paid_at is null or
      purchase_date is distinct from (paid_at at time zone 'America/New_York')::date or
      created_at<from_time or created_at>=until_time or item_order is distinct from order_id or
      item_class is distinct from 'merchandise' or purchase_value_complete is distinct from true or
      item_currency is distinct from 'USD' or quantity<=0 or raw_line is null or
      coalesce(jsonb_typeof(raw_line->'sku'),'') not in ('string','null') or
      jsonb_typeof(raw_line->'quantity') is distinct from 'number' or
      raw_line->>'id' !~ '^gid://shopify/LineItem/[1-9][0-9]*$' or
      raw_line#>>'{product,id}' !~ '^gid://shopify/Product/[1-9][0-9]*$' or
      quantity is distinct from (raw_line->>'quantity')::numeric or
      sku is distinct from nullif(raw_line->>'sku','') or
      product_id is distinct from encode(sha256(convert_to(replace(jsonb_build_array(shop,
        replace(raw_line#>>'{product,id}','gid://shopify/Product/',''))::text,', ',','),'UTF8')),'hex') or
      policy#>>'{decision,eligibility}' is distinct from 'eligible' or
      coalesce(btrim(policy#>>'{decision,approvalRef}'),'')='' or
      coalesce(btrim(policy->>'financialApprovalRef'),'')='' or
      policy->>'saleClock' is distinct from 'paid_at' or policy->>'refundClock' is distinct from 'refund_created_at' or
      policy#>>array['productClasses',replace(raw_line#>>'{product,id}','gid://shopify/Product/','')]
        is distinct from 'merchandise' or
      (size_item is not null and (
        source_evidence_ref is distinct from 'lean_private.pipeline_snapshots/'||work_id::text or
        policy_ref is distinct from policy#>>'{orderSize,policyRef}' or
        size_semantics is distinct from expected_semantics or mapping_version is distinct from 'order-size-v1' or
        size_status is distinct from expected_status or
        size_value is distinct from (case when expected_status='known' then chosen->>'value' else null end) or
        size_source is distinct from (case when expected_status='projection_absent' or expected_semantics='unsupported'
          then 'none' when expected_semantics='requested_box_top_size' then 'custom_attribute_top_size'
          else 'variant_title_snapshot' end) or
        (source#>>'{commerce,projection}'='financial_no_geo_order_size' and
          (raw_line ? 'customAttributes' or raw_line ? 'variantTitle' or
            (raw_line ? 'orderSize' and (
              (select count(*) from jsonb_object_keys(raw_line->'orderSize'))<>2 or
              not (raw_line->'orderSize') ?& array['topSize','variantTitle'] or
              exists(select 1 from jsonb_each(raw_line->'orderSize') e where
                (select count(*) from jsonb_object_keys(e.value))<>2 or not e.value ?& array['status','value'] or
                coalesce(e.value->>'status','') not in ('known','missing','invalid','conflict','unsupported','projection_absent') or
                (case when e.value->>'status'='known' then coalesce(e.value->>'value','') not in ('XS','S','M','L','XL','XXL','XXXL')
                  else e.value->'value' is distinct from 'null'::jsonb end)
              )
            ))
          ))
      ))
    )) ok from args a
), grouped as (
  select purchase_date,coalesce(sku,'unknown') sku_bucket,
    coalesce(size_semantics,'not_collected') size_semantics,coalesce(size_status,'not_collected') size_status,
    size_value,count(*)::integer line_count,sum(quantity)::numeric(20,6)::text quantity
  from checked cross join args where purchase_date between first_date and last_date
  group by purchase_date,coalesce(sku,'unknown'),coalesce(size_semantics,'not_collected'),
    coalesce(size_status,'not_collected'),size_value
)
select jsonb_build_object('scope','selected_observed_latest_heads','is_stale',true,
  'certification','unverified','certified',false,'fulfillment_proven',false,'return_adjusted',false,
  'complete_history',false,'status',case when valid.ok then 'available' else 'unavailable' end,
  'rows',case when valid.ok then coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('unit_basis',
    case g.size_semantics when 'requested_box_top_size' then 'requested_box_units'
      when 'purchased_shirt_variant' then 'purchased_shirt_variant_units' else 'unclassified_merchandise_units' end)
    order by purchase_date,sku_bucket collate "C",size_semantics,size_status,size_value) from grouped g),'[]'::jsonb)
    else '[]'::jsonb end) report from valid
$order_size$ into result using cfg.shop,first_date,last_date;
  if result->>'status' is distinct from 'available' or jsonb_typeof(result->'rows') is distinct from 'array' or
    jsonb_array_length(result->'rows') not between 1 and 10000 then return null; end if;
  select jsonb_build_object('coverage_status','selected_observed','order_size_daily',
    jsonb_agg(r.value||(result-array['rows','status'])||jsonb_build_object(
      'definition_version','order-size-report-v1','coverage_status','selected_observed') order by r.ordinality))
    into payload from jsonb_array_elements(result->'rows') with ordinality r(value,ordinality);
  if octet_length(payload::text)>4194304 then return null; end if;
  return payload;
exception when others then
  -- Invalid retained evidence or unavailable dependencies never become zero rows
  -- or raw SQL/source diagnostics at the HTTP boundary.
  return null;
end $function$;
revoke all on function public.lean_order_size_reports_read() from public,anon,authenticated,service_role;
do $acl$
begin
  if exists(select 1 from pg_roles where rolname='lean_posthog_reader') then
    revoke all on function public.lean_order_size_reports_read() from lean_posthog_reader;
  end if;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.oid='public.lean_order_size_reports_read()'::regprocedure and a.grantee<>p.proowner) then
    raise exception 'unexpected size function grantee';
  end if;
end $acl$;
grant execute on function public.lean_order_size_reports_read() to service_role;
commit;
