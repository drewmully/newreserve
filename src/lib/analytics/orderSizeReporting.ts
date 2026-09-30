import { decimal, key, micros, nyDate, type Row } from "./primitives";
import { reportDates } from "./commerceCandidate";
import { shopifyShop } from "./shopifySource";
import { ORDER_SIZES, ORDER_SIZE_VERSION } from "./shopifyOrderSize";
import { validateRowShape } from "./validate-contract";

export type OrderSizeReportScope = { shop: string; fromDate: string; throughDate: string };
export type OrderSizeReportFacts = { orders: Row[]; order_items: Row[]; order_item_sizes: Row[] };
type Bucket = { purchase_date: string; sku_bucket: string; size_semantics: string; size_status: string;
  size_value: string | null; unit_basis: string; line_count: number; quantity: string };
const metadata = { scope: "selected_observed_latest_heads", is_stale: true, certification: "unverified",
  certified: false, fulfillment_proven: false, return_adjusted: false, complete_history: false } as const;
const unitBasis = (semantics: unknown) => semantics === "requested_box_top_size" ? "requested_box_units" :
  semantics === "purchased_shirt_variant" ? "purchased_shirt_variant_units" : "unclassified_merchandise_units";
const fail = (): never => { throw new Error("order_size_report_unavailable"); };
function validSize(row: Row) {
  if (Object.keys(row).sort().join(",") !==
      "mapping_version,order_item_id,policy_ref,publication_id,size_semantics,size_source,size_status,size_value,source_evidence_ref" ||
      ["order_item_id", "publication_id", "policy_ref", "source_evidence_ref"].some(k =>
        typeof row[k] !== "string" || !(row[k] as string).trim()) || row.mapping_version !== ORDER_SIZE_VERSION ||
      !["known", "missing", "invalid", "conflict", "unsupported", "projection_absent"].includes(String(row.size_status)) ||
      !["requested_box_top_size", "purchased_shirt_variant", "unsupported"].includes(String(row.size_semantics)) ||
      (row.size_status === "known" ? !ORDER_SIZES.includes(row.size_value as typeof ORDER_SIZES[number]) : row.size_value !== null))
    fail();
  const paired = row.size_semantics === "requested_box_top_size" ? row.size_source === "custom_attribute_top_size" :
    row.size_semantics === "purchased_shirt_variant" && row.size_source === "variant_title_snapshot";
  if (!(row.size_status === "projection_absent" ? row.size_source === "none" :
    row.size_semantics === "unsupported" ? row.size_status === "unsupported" && row.size_source === "none" : paired)) fail();
}
/** Pure calculation only: caller supplies exactly one selected latest publication
 * per order. This does not authenticate head selection or authorize a database read.
 * OWNER_ORDER_SIZE_REPORT_SQL separately validates the persisted selection/provenance.
 */
export function aggregateOrderSizes(facts: OrderSizeReportFacts, scope: OrderSizeReportScope) {
  shopifyShop(scope.shop); reportDates(scope.fromDate, scope.throughDate);
  const orders = new Map<string, Row>(), publications = new Set<string>(), items = new Map<string, Row>();
  for (const row of facts.orders) {
    if (validateRowShape("orders", row).length || row.shop_id !== scope.shop || row.eligibility_status !== "eligible" ||
        row.source_currency !== "USD" || row.purchase_date === null || row.paid_at === null ||
        row.purchase_date !== nyDate(row.paid_at as string) || orders.has(row.order_id as string) ||
        !/^[1-9]\d*$/.test(row.source_order_id as string) ||
        row.order_id !== key(scope.shop, row.source_order_id as string) ||
        publications.has(row.publication_id as string)) fail();
    orders.set(row.order_id as string, row); publications.add(row.publication_id as string);
  }
  for (const row of facts.order_items) {
    const order = orders.get(row.order_id as string);
    if (validateRowShape("order_items", row).length || !order || order.publication_id !== row.publication_id ||
        row.item_class !== "merchandise" || row.purchase_value_complete !== true || row.source_currency !== "USD" ||
        !/^[1-9]\d*$/.test(row.source_line_id as string) ||
        row.order_item_id !== key(scope.shop, order.source_order_id as string, row.source_line_id as string) ||
        micros(row.quantity as string) <= BigInt(0) || items.has(row.order_item_id as string)) fail();
    items.set(row.order_item_id as string, row);
  }
  if ([...orders.values()].some(order => !facts.order_items.some(i => i.order_id === order.order_id))) fail();
  const sizes = new Map<string, Row>();
  const provenance = new Map<string, string>();
  for (const row of facts.order_item_sizes) {
    validSize(row);
    if (sizes.has(row.order_item_id as string) || !items.has(row.order_item_id as string) ||
        items.get(row.order_item_id as string)!.publication_id !== row.publication_id) fail();
    const refs = JSON.stringify([row.policy_ref, row.source_evidence_ref]), pub = row.publication_id as string;
    if (provenance.has(pub) && provenance.get(pub) !== refs) fail();
    provenance.set(pub, refs);
    sizes.set(row.order_item_id as string, row);
  }
  const buckets = new Map<string, Bucket>();
  for (const item of items.values()) {
    const date = orders.get(item.order_id as string)!.purchase_date as string;
    if (date < scope.fromDate || date > scope.throughDate) continue;
    const size = sizes.get(item.order_item_id as string);
    const dimensions = { purchase_date: date, sku_bucket: (item.sku ?? "unknown") as string,
      size_semantics: size ? size.size_semantics as string : "not_collected",
      size_status: size ? size.size_status as string : "not_collected",
      size_value: size ? size.size_value as string | null : null };
    const id = JSON.stringify(Object.values(dimensions)), prior = buckets.get(id);
    buckets.set(id, { ...dimensions, unit_basis: unitBasis(dimensions.size_semantics),
      line_count: (prior?.line_count ?? 0) + 1,
      quantity: decimal(micros(prior?.quantity ?? "0") + micros(item.quantity as string)) });
  }
  const rows = [...buckets.values()].sort((a, b) => {
    for (const field of ["purchase_date", "sku_bucket", "size_semantics", "size_status", "size_value"] as const) {
      const comparison = Buffer.compare(Buffer.from(a[field] ?? ""), Buffer.from(b[field] ?? ""));
      if (comparison) return comparison;
    }
    return 0;
  });
  return { ...metadata, status: orders.size ? "available" : "unavailable", rows };
}

/** OWNER-ONLY, READ-ONLY. Bind [shop, inclusive purchase-from date, through date].
 * Missing schema/permissions or SQL errors mean unavailable, never an empty zero
 * report. No grants/RPC/installation/runtime invocation is supplied by this module.
 */
export const OWNER_ORDER_SIZE_REPORT_SQL = `
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
  select (a.shop ~ '^[a-z0-9][a-z0-9-]*\\.myshopify\\.com$' and
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
    else '[]'::jsonb end) report from valid`;
