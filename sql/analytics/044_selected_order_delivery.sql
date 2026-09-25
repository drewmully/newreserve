-- One saved, completed 016 pilot; existing formulas, no source reads or release.
begin;
create table lean_private.selected_order_delivery (
  scope_id text primary key,
  run_id uuid not null references lean_private.pilot_runs,
  input_hash text not null,
  payload jsonb not null,
  payload_hash text not null,
  approval_ref text not null check(length(trim(approval_ref))>0),
  enabled boolean not null default false,
  expires_at timestamptz not null
);
alter table lean_private.selected_order_delivery enable row level security;
revoke all on lean_private.selected_order_delivery from public,anon,authenticated,service_role;

-- Owner-only extraction. Raw retained source/policy stay in the database.
-- Their hashes AND all saved canonical facts bind the offline formula input.
create function public.lean_selected_order_input(p_run uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
declare r lean_private.pilot_runs; facts jsonb; binding jsonb; orders jsonb; items jsonb; ledger jsonb;
begin
  select * into r from lean_private.pilot_runs where run_id=p_run;
  if not found or r.state<>'done' or r.completed_at is null or
    r.shop<>'mullybox-store.myshopify.com' or r.source is null or
    r.source_fingerprint is distinct from md5(r.source::text) or
    r.source#>>'{commerce,order,id}' is distinct from r.order_gid or
    r.source#>>'{commerce,shop}' is distinct from r.shop or
    r.policy->>'saleClock' is distinct from 'paid_at' or
    r.policy->>'refundClock' is distinct from 'refund_created_at' or
    coalesce(r.policy->>'financialApprovalRef','')='' or
    coalesce(r.policy#>>'{decision,approvalRef}','')=''
    then raise exception 'selected completed pilot required'; end if;
  if (select count(*) from lean_private.orders where publication_id=r.publication_id)<>1 or
    not exists(select 1 from lean_private.orders where publication_id=r.publication_id and
      shop_id=r.shop and 'gid://shopify/Order/'||source_order_id=r.order_gid and
      eligibility_status='eligible' and source_currency='USD' and report_currency='USD' and
      customer_id is null and acquisition_eligible=false and purchase_date is not null and
      purchase_merchandise_net_usd is not null)
    then raise exception 'selected order facts required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('order_id',o.order_id,'shop_id',o.shop_id,
    'publication_id',o.publication_id,'purchase_date',o.purchase_date,
    'eligibility_status',o.eligibility_status,'purchase_merchandise_net_usd',o.purchase_merchandise_net_usd::text)
    order by o.order_id),'[]') into orders from lean_private.orders o where publication_id=r.publication_id;
  select coalesce(jsonb_agg(jsonb_build_object('order_item_id',i.order_item_id,'order_id',i.order_id,
    'publication_id',i.publication_id,'sku',i.sku,'quantity',i.quantity::text,'item_class',i.item_class)
    order by i.order_item_id),'[]') into items from lean_private.order_items i where publication_id=r.publication_id;
  select coalesce(jsonb_agg(jsonb_build_object('ledger_entry_id',l.ledger_entry_id,'order_id',l.order_id,
    'order_item_id',l.order_item_id,'publication_id',l.publication_id,'component',l.component,
    'report_date',l.report_date,'amount_usd',l.amount_usd::text,'sales_eligible',l.sales_eligible,
    'product_allocation_status',l.product_allocation_status) order by l.ledger_entry_id),'[]') into ledger
    from lean_private.sales_ledger l where publication_id=r.publication_id;
  if jsonb_array_length(items) not between 1 and 100 or jsonb_array_length(ledger) not between 1 and 1000 or
    exists(select 1 from lean_private.order_items i where publication_id=r.publication_id and
      (i.item_class<>'merchandise' or not i.purchase_value_complete or
       i.order_id is distinct from orders->0->>'order_id' or i.quantity<=0)) or
    exists(select 1 from lean_private.sales_ledger l where publication_id=r.publication_id and
      (l.order_id is distinct from orders->0->>'order_id' or not l.sales_eligible or l.amount_usd is null))
    then raise exception 'selected supported facts required'; end if;
  facts:=jsonb_build_object('orders',orders,'order_items',items,'sales_ledger',ledger,
    'payments','[]'::jsonb,'customers','[]'::jsonb,'sessions','[]'::jsonb,
    'marketing_spend_daily','[]'::jsonb,'order_attribution','[]'::jsonb);
  binding:=jsonb_build_object('run',to_jsonb(r)-'source','sourceHash',
    encode(sha256(convert_to(r.source::text,'UTF8')),'hex'),
    'orders',(select jsonb_agg(to_jsonb(t) order by order_id) from lean_private.orders t where publication_id=r.publication_id),
    'items',(select jsonb_agg(to_jsonb(t) order by order_item_id) from lean_private.order_items t where publication_id=r.publication_id),
    'ledger',(select jsonb_agg(to_jsonb(t) order by ledger_entry_id) from lean_private.sales_ledger t where publication_id=r.publication_id),
    'payments',(select jsonb_agg(to_jsonb(t) order by payment_id) from lean_private.payments t where publication_id=r.publication_id),
    'savedStore',(select jsonb_agg(to_jsonb(t) order by report_date) from lean_analytics.pilot_store_daily t where run_id=p_run));
  return jsonb_build_object('runId',r.run_id,'shop',r.shop,'publication',r.publication_id,
    'sourceUpdatedAt',r.source#>>'{commerce,order,updatedAt}','facts',facts,
    'savedStore',(select jsonb_agg(jsonb_build_object('report_date',s.report_date,
      'gross_merchandise_sales_usd',s.gross_merchandise_sales_usd::text,
      'discounts_usd',s.discounts_usd::text,'refunds_usd',s.refunds_usd::text,
      'net_merchandise_sales_usd',s.net_merchandise_sales_usd::text,
      'shipping_net_usd',s.shipping_net_usd::text,'tax_net_usd',s.tax_net_usd::text,
      'duty_net_usd',s.duty_net_usd::text,'other_sales_adjustments_usd',s.other_sales_adjustments_usd::text,
      'total_sales_usd',s.total_sales_usd::text,'eligible_orders',s.eligible_orders,
      'purchase_merchandise_net_usd',s.purchase_merchandise_net_usd::text,'aov_usd',s.aov_usd::text)
      order by s.report_date) from lean_analytics.pilot_store_daily s where s.run_id=p_run),
    'inputHash',encode(sha256(convert_to(binding::text,'UTF8')),'hex'));
end $$;

create function lean_private.selected_order_validate(p_payload jsonb,p_input jsonb) returns void
language plpgsql set search_path=pg_catalog as $$
declare domain text; metric text; metrics text[]; common text[]; item jsonb; dates jsonb; actual_dates jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' or
    p_payload-array['store_daily','product_daily']<>'{}' or
    octet_length(p_payload::text)>1048576 then raise exception 'selected aggregate payload'; end if;
  select jsonb_agg(d order by d) into dates from (
    select x->>'purchase_date' d from jsonb_array_elements(p_input#>'{facts,orders}') x union
    select x->>'report_date' from jsonb_array_elements(p_input#>'{facts,sales_ledger}') x
  ) q;
  if jsonb_array_length(dates) not between 1 and 4 then raise exception 'selected date budget'; end if;
  foreach domain in array array['store_daily','product_daily'] loop
    if jsonb_typeof(p_payload->domain) is distinct from 'array' or
      jsonb_array_length(p_payload->domain) not between 1 and 400 then raise exception 'selected domain rows'; end if;
    metrics:=case when domain='store_daily' then
      array['gross_merchandise_sales_usd','discounts_usd','refunds_usd','net_merchandise_sales_usd',
        'shipping_net_usd','tax_net_usd','duty_net_usd','other_sales_adjustments_usd','total_sales_usd',
        'collected_cash_usd','eligible_orders','purchase_merchandise_net_usd','new_customers','spend_usd','ncac_usd','mer','aov_usd']
      else array['units','gross_merchandise_sales_usd','discounts_usd','refunds_usd','net_merchandise_sales_usd'] end;
    common:=array['report_date','definition_version','is_stale','readiness','report_scope',
      'certified','complete_window','selected_order_count','source_updated_at','policy_scope'];
    if domain='product_daily' then common:=common||'sku_bucket'::text; end if;
    for item in select value from jsonb_array_elements(p_payload->domain) loop
      if jsonb_typeof(item) is distinct from 'object' or item-(common||metrics)<>'{}' or
        (select count(*) from jsonb_object_keys(item))<>cardinality(common||metrics) or
        item->>'definition_version' is distinct from 'selected-order-v1' or
        item->>'report_scope' is distinct from 'selected_order_sample' or
        item->>'policy_scope' is distinct from 'prior_single_order_test' or
        item->'certified' is distinct from 'false' or item->'complete_window' is distinct from 'false' or
        item->'is_stale' is distinct from 'true' or item->'selected_order_count' is distinct from '1' or
        item->>'source_updated_at' is distinct from p_input->>'sourceUpdatedAt' or
        not (dates ? (item->>'report_date')) or jsonb_typeof(item->'readiness') is distinct from 'object' or
        (item->'readiness')-metrics<>'{}' or
        (select count(*) from jsonb_object_keys(item->'readiness'))<>cardinality(metrics) or
        (domain='product_daily' and (jsonb_typeof(item->'sku_bucket') is distinct from 'string' or
          length(item->>'sku_bucket') not between 1 and 200 or
          not exists(select 1 from jsonb_array_elements(p_input#>'{facts,order_items}') i
            where coalesce(i->>'sku','unknown')=item->>'sku_bucket')))
        then raise exception 'selected row boundary'; end if;
      foreach metric in array metrics loop
        if metric=any(array['collected_cash_usd','new_customers','spend_usd','ncac_usd','mer']) then
          if item->metric is distinct from 'null' or item#>>array['readiness',metric] is distinct from 'withheld'
            then raise exception 'selected unavailable metric'; end if;
        elsif item->metric='null' then
          if item#>>array['readiness',metric] is distinct from 'withheld' then raise exception 'selected null readiness'; end if;
        elsif item#>>array['readiness',metric] is distinct from 'observed_unverified' or
          (metric='eligible_orders' and item->metric not in ('0'::jsonb,'1'::jsonb)) or
          (metric<>'eligible_orders' and (jsonb_typeof(item->metric) is distinct from 'string' or
            (item->>metric)!~'^-?[0-9]{1,14}\.[0-9]{6}$'))
          then raise exception 'selected metric boundary'; end if;
      end loop;
      if domain='store_daily' and not exists(
        select 1 from jsonb_array_elements(p_input->'savedStore') s
        where s->>'report_date'=item->>'report_date' and not exists(
          select 1 from jsonb_each(s) v where item->v.key is distinct from v.value
        )) then raise exception 'selected saved store mismatch'; end if;
    end loop;
    select jsonb_agg(d order by d) into actual_dates from
      (select distinct x->>'report_date' d from jsonb_array_elements(p_payload->domain) x) q;
    if actual_dates is distinct from dates then raise exception 'selected date mismatch'; end if;
    if (select count(distinct (x->>'report_date',case when domain='product_daily' then x->>'sku_bucket' else '' end))
        from jsonb_array_elements(p_payload->domain) x)<>jsonb_array_length(p_payload->domain)
      then raise exception 'selected duplicate rows'; end if;
  end loop;
end $$;

create function public.lean_selected_order_register(p_scope text,p_run uuid,p_input_hash text,
  p_payload jsonb,p_approval text,p_expires timestamptz) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare input jsonb; digest text;
begin
  if p_scope is null or p_scope!~'^[a-zA-Z0-9_-]{1,100}$' or coalesce(trim(p_approval),'')='' or
    p_expires is null or p_expires<=clock_timestamp() or p_expires>clock_timestamp()+interval '24 hours'
    then raise exception 'selected registration boundary'; end if;
  input:=public.lean_selected_order_input(p_run);
  if input->>'inputHash' is distinct from p_input_hash then raise exception 'selected input changed'; end if;
  perform lean_private.selected_order_validate(p_payload,input);
  digest:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  insert into lean_private.selected_order_delivery(scope_id,run_id,input_hash,payload,payload_hash,approval_ref,expires_at)
    values(p_scope,p_run,p_input_hash,p_payload,digest,p_approval,p_expires);
  return digest;
end $$;

create function public.lean_selected_order_read(p_scope_id text,p_project text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.selected_order_delivery; input jsonb;
begin
  if p_project is distinct from 'xeqlgxvrhgwwudyqtnun' then raise exception 'selected project'; end if;
  select * into r from lean_private.selected_order_delivery where scope_id=p_scope_id for share;
  if not found or not r.enabled or r.expires_at<=clock_timestamp() then raise exception 'selected disabled or expired'; end if;
  input:=public.lean_selected_order_input(r.run_id);
  if input->>'inputHash' is distinct from r.input_hash or
    encode(sha256(convert_to(r.payload::text,'UTF8')),'hex') is distinct from r.payload_hash
    then raise exception 'selected snapshot changed'; end if;
  perform lean_private.selected_order_validate(r.payload,input);
  return r.payload;
end $$;

create function lean_private.selected_order_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if (to_jsonb(old)-'enabled') is distinct from (to_jsonb(new)-'enabled') then
    raise exception 'selected snapshot immutable'; end if;
  return new;
end $$;
create trigger selected_order_immutable before update on lean_private.selected_order_delivery
  for each row execute function lean_private.selected_order_immutable();
revoke all on function public.lean_selected_order_input(uuid) from public,anon,authenticated,service_role;
revoke all on function public.lean_selected_order_register(text,uuid,text,jsonb,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.lean_selected_order_read(text,text) from public,anon,authenticated,service_role;
revoke all on function lean_private.selected_order_validate(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function lean_private.selected_order_immutable() from public,anon,authenticated,service_role;
grant execute on function public.lean_selected_order_read(text,text) to service_role;
commit;
