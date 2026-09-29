-- OPTIONAL owner-run migration after 001/003/004/013/014/017.
-- 046 is required only for an immutable policy.orderSize opt-in at invocation.
-- No existing function, table, view, policy, scope or selected sample is changed.
begin;
create function public.lean_pipeline_finish_extended(
  p_work_id bigint,p_token uuid,p_facts jsonb,p_reports jsonb,
  p_product_reports jsonb,p_order_item_sizes jsonb default null
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare w lean_private.work; s lean_private.pipeline_snapshots;
  r jsonb; k text; sized boolean;
  metrics text[] := array['units','gross_merchandise_sales_usd','discounts_usd','refunds_usd','net_merchandise_sales_usd'];
begin
  -- Identical scope-before-work lock order and token fence to 017. A false
  -- result means no writes, including replay after a committed/lost response.
  perform 1 from lean_private.pipeline_scope c join lean_private.pipeline_snapshots x on x.shop=c.shop
    where x.work_id=p_work_id and c.enabled for update of c;
  if not found then return false; end if;
  select * into w from lean_private.work where work_id=p_work_id for update;
  if not found or p_token is null or w.state<>'leased' or w.lease_token is distinct from p_token::text
    or w.lease_until<=clock_timestamp() then return false; end if;
  select * into strict s from lean_private.pipeline_snapshots where work_id=p_work_id;
  if s.policy->'retainedReports' is distinct from '"product-v1"'::jsonb then
    raise exception 'extended report policy required';
  end if;
  if jsonb_typeof(p_facts->'order_items') is distinct from 'array' or
    jsonb_typeof(p_reports) is distinct from 'array' or
    jsonb_typeof(p_product_reports) is distinct from 'array' then
    raise exception 'invalid extended batch';
  end if;
  -- Existing reader permits two 250-line pages and up to four report dates.
  if jsonb_array_length(p_facts->'order_items') not between 1 and 500 or
    jsonb_array_length(p_reports) not between 1 and 4 or
    jsonb_array_length(p_product_reports) not between 1 and 2000 then
    raise exception 'extended batch budget';
  end if;
  for r in select value from jsonb_array_elements(p_reports) loop
    if r->'is_stale' is distinct from 'true'::jsonb or jsonb_typeof(r->'readiness') is distinct from 'object' then
      raise exception 'observed store report required';
    end if;
    if exists(select 1 from jsonb_each(r->'readiness') e
      where e.value not in ('"observed_unverified"'::jsonb,'"withheld"'::jsonb)) then
      raise exception 'observed store report required';
    end if;
  end loop;
  for r in select value from jsonb_array_elements(p_product_reports) loop
    if jsonb_typeof(r) is distinct from 'object' then raise exception 'invalid product row'; end if;
    if (select count(*) from jsonb_object_keys(r))<>12 or not r ?& array[
      'shop_id','publication_id','definition_version','readiness','is_stale','report_date',
      'sku_bucket','units','gross_merchandise_sales_usd','discounts_usd','refunds_usd','net_merchandise_sales_usd'] then
      raise exception 'invalid product shape';
    end if;
    foreach k in array array['shop_id','publication_id','definition_version','report_date','sku_bucket'] loop
      if jsonb_typeof(r->k) is distinct from 'string' then raise exception 'invalid product field type'; end if;
    end loop;
    if r->>'shop_id' is distinct from s.shop or r->>'publication_id' is distinct from s.publication_id or
      r->>'definition_version' is distinct from 'shopify-observed-v1' or
      r->'is_stale' is distinct from 'true'::jsonb or
      r->>'report_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or
      jsonb_typeof(r->'readiness') is distinct from 'object' then
      raise exception 'invalid product scope';
    end if;
    if (select count(*) from jsonb_object_keys(r->'readiness'))<>5 or not (r->'readiness') ?& metrics then
      raise exception 'invalid product readiness';
    end if;
    foreach k in array metrics loop
      if r->k='null'::jsonb then
        if r#>>array['readiness',k] is distinct from 'withheld' then raise exception 'invalid product readiness'; end if;
      elsif jsonb_typeof(r->k) is distinct from 'string' or r->>k !~ '^-?[0-9]{1,14}\.[0-9]{6}$' or
        r#>>array['readiness',k] is distinct from 'observed_unverified' then
        raise exception 'invalid product metric';
      end if;
    end loop;
  end loop;
  -- Exactly one row for every retained SKU (including unknown) on each store
  -- report date; no foreign SKU/date, duplicate or silently omitted bucket.
  if (select count(distinct (entry->>'report_date',entry->>'sku_bucket')) from jsonb_array_elements(p_product_reports) entry)
      <>jsonb_array_length(p_product_reports) or
    exists(select 1 from jsonb_array_elements(p_product_reports) entry where
      not exists(select 1 from jsonb_array_elements(p_reports) d where d->>'report_date'=entry->>'report_date') or
      not exists(select 1 from jsonb_array_elements(p_facts->'order_items') i where coalesce(i->>'sku','unknown')=entry->>'sku_bucket')) or
    exists(select 1 from jsonb_array_elements(p_reports) d cross join jsonb_array_elements(p_facts->'order_items') i
      where not exists(select 1 from jsonb_array_elements(p_product_reports) entry
        where entry->>'report_date'=d->>'report_date' and entry->>'sku_bucket'=coalesce(i->>'sku','unknown'))) then
    raise exception 'product report coverage mismatch';
  end if;
  sized := s.policy ? 'orderSize';
  if sized then
    if jsonb_typeof(s.policy->'orderSize') is distinct from 'object' or
      jsonb_typeof(s.policy#>'{orderSize,policyRef}') is distinct from 'string' or
      coalesce(btrim(s.policy#>>'{orderSize,policyRef}'),'')='' or
      jsonb_typeof(s.policy#>'{orderSize,productSemantics}') is distinct from 'object' then
      raise exception 'invalid size policy';
    end if;
    if s.policy#>'{orderSize,productSemantics}'='{}'::jsonb then raise exception 'empty size product semantics'; end if;
    if exists(select 1 from jsonb_each(s.policy#>'{orderSize,productSemantics}') e where
      e.key !~ '^[1-9][0-9]*$' or e.value not in ('"requested_box_top_size"'::jsonb,'"purchased_shirt_variant"'::jsonb)) or
      s.policy->'sourceProjection' is distinct from '"financial_no_geo_order_size"'::jsonb or
      s.source#>'{commerce,projection}' is distinct from '"financial_no_geo_order_size"'::jsonb then
      raise exception 'invalid size policy projection';
    end if;
    if to_regclass('lean_private.order_item_sizes') is null or
      to_regprocedure('lean_private.write_order_item_sizes(text,jsonb)') is null then
      raise exception 'size sink unavailable';
    end if;
    if jsonb_typeof(p_order_item_sizes) is distinct from 'array' then raise exception 'size sidecar required'; end if;
    if jsonb_array_length(p_order_item_sizes)<>jsonb_array_length(p_facts->'order_items') or
      (select count(distinct entry->>'order_item_id') from jsonb_array_elements(p_order_item_sizes) entry)<>jsonb_array_length(p_order_item_sizes) or
      exists(select 1 from jsonb_array_elements(p_order_item_sizes) entry where
        entry->>'publication_id' is distinct from s.publication_id or
        entry->>'policy_ref' is distinct from s.policy#>>'{orderSize,policyRef}' or
        not exists(select 1 from jsonb_array_elements(p_facts->'order_items') i where i->>'order_item_id'=entry->>'order_item_id')) then
      raise exception 'size sidecar scope mismatch';
    end if;
    if exists(select 1 from jsonb_array_elements(p_order_item_sizes) entry
      join jsonb_array_elements(p_facts->'order_items') i on i->>'order_item_id'=entry->>'order_item_id'
      where entry->>'size_semantics' is distinct from coalesce(
        (select e.value from jsonb_each_text(s.policy#>'{orderSize,productSemantics}') e
         -- Match primitives.key(shop,numericProductId), not a reversible ID.
         where i->>'item_class'='merchandise' and i->>'product_id'=
           encode(sha256(convert_to('["'||s.shop||'","'||e.key||'"]','UTF8')),'hex')),
        'unsupported')) then
      raise exception 'size sidecar semantics mismatch';
    end if;
  elsif p_order_item_sizes is not null then
    raise exception 'size sidecar not approved';
  end if;
  -- No catch/compensating write: failure of either extension rolls back ALL
  -- facts, store rows, head advancement and work completion inside 017.
  if not public.lean_pipeline_finish(p_work_id,p_token,p_facts,p_reports) then return false; end if;
  insert into lean_private.report_product_daily
    select * from jsonb_populate_recordset(null::lean_private.report_product_daily,p_product_reports);
  if sized then
    -- Dynamic resolution lets product-only installs operate without 046.
    execute 'select lean_private.write_order_item_sizes($1,$2)' using s.publication_id,p_order_item_sizes;
  end if;
  return true;
end $$;
revoke all on function public.lean_pipeline_finish_extended(bigint,uuid,jsonb,jsonb,jsonb,jsonb) from public;
do $$
declare role_name text;
begin
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on function public.lean_pipeline_finish_extended(bigint,uuid,jsonb,jsonb,jsonb,jsonb) from %I',role_name);
    end if;
  end loop;
end $$;
grant execute on function public.lean_pipeline_finish_extended(bigint,uuid,jsonb,jsonb,jsonb,jsonb) to service_role;
-- Aggregate only latest successful heads, never historical publications or AOV.
-- Missing product coverage on a legacy head makes the entire shop visibly stale.
create view lean_analytics.observed_product_daily with(security_barrier=true) as
with latest as (
  select r.*,
    (not cfg.enabled or s.policy is distinct from cfg.policy or
      s.from_time is distinct from cfg.from_time or s.until_time is distinct from cfg.until_time or
      exists(select 1 from lean_private.work w join lean_private.receipts q using(receipt_id)
        where lean_private.receipt_shop(q.business_key)=h.shop and w.state<>'done') or
      exists(select 1 from lean_private.pipeline_heads other join lean_private.pipeline_snapshots os using(work_id)
        where other.shop=h.shop and not exists(select 1 from lean_private.report_product_daily pr
          where pr.publication_id=os.publication_id))) as pipeline_stale
  from lean_private.pipeline_heads h join lean_private.pipeline_snapshots s using(work_id)
  join lean_private.report_product_daily r on r.publication_id=s.publication_id
  join lean_private.pipeline_scope cfg on cfg.shop=h.shop
), aggregate_rows as (
  select shop_id,report_date,definition_version,sku_bucket,
    case when bool_and(units is not null) then sum(units) end as units,
    case when bool_and(gross_merchandise_sales_usd is not null) then sum(gross_merchandise_sales_usd) end as gross_merchandise_sales_usd,
    case when bool_and(discounts_usd is not null) then sum(discounts_usd) end as discounts_usd,
    case when bool_and(refunds_usd is not null) then sum(refunds_usd) end as refunds_usd,
    case when bool_and(net_merchandise_sales_usd is not null) then sum(net_merchandise_sales_usd) end as net_merchandise_sales_usd,
    bool_or(is_stale) as is_stale,bool_or(pipeline_stale) as pipeline_stale
  from latest group by shop_id,report_date,definition_version,sku_bucket
)
select a.*,
  jsonb_build_object(
    'units',case when units is null then 'withheld' else 'observed_unverified' end,
    'gross_merchandise_sales_usd',case when gross_merchandise_sales_usd is null then 'withheld' else 'observed_unverified' end,
    'discounts_usd',case when discounts_usd is null then 'withheld' else 'observed_unverified' end,
    'refunds_usd',case when refunds_usd is null then 'withheld' else 'observed_unverified' end,
    'net_merchandise_sales_usd',case when net_merchandise_sales_usd is null then 'withheld' else 'observed_unverified' end) as readiness,
  'unverified'::text as certification,'webhook_observed_only'::text as coverage
from aggregate_rows a;
-- Owner-only, even under unexpected per-role default view grants. No login,
-- warehouse binding, existing view grant or global default ACL is changed.
revoke all on lean_analytics.observed_product_daily from public;
do $$
declare recipient text;
begin
  for recipient in select distinct r.rolname from pg_class c
    cross join lateral aclexplode(c.relacl) a join pg_roles r on r.oid=a.grantee
    where c.oid='lean_analytics.observed_product_daily'::regclass and a.grantee<>c.relowner loop
    execute format('revoke all on lean_analytics.observed_product_daily from %I',recipient);
  end loop;
end $$;
commit;
