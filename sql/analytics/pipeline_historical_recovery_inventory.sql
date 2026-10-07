-- PRIVATE READ-ONLY TEMPLATE. Do not dispatch without separate read approval.
-- No source bodies or receipt payloads. This is inventory, not eligibility.
-- Limit 5001 detects overflow. A capped result MUST NOT be used to approve work.
begin transaction isolation level repeatable read read only;
set local statement_timeout='10s';
set local lock_timeout='2s';
set local timezone='UTC';
with population as materialized (
  select w.*,s.shop,s.order_gid,s.revision,s.source,s.publication_id,
    encode(sha256(convert_to(to_jsonb(w)::text,'UTF8')),'hex') work_sha256,
    encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') receipt_sha256,
    encode(sha256(convert_to((to_jsonb(s)-'source')::text,'UTF8')),'hex') snapshot_sha256,
    encode(sha256(convert_to(s.source::text,'UTF8')),'hex') source_sha256
  from lean_private.work w join lean_private.receipts r using(receipt_id)
  left join lean_private.pipeline_snapshots s using(work_id)
  where r.source='shopify' and lean_private.receipt_shop(r.business_key)='mullybox-store.myshopify.com'
    and w.state<>'done'
  order by w.work_id limit 5001
), rows as (
  select jsonb_build_object(
    'workId',p.work_id::text,'state',p.state,'attempts',p.attempts,'lastError',p.last_error_code,
    'completedAt',p.completed_at,'hasLease',p.lease_token is not null or p.lease_until is not null,
    'workSha256',p.work_sha256,'receiptSha256',p.receipt_sha256,
    'snapshotSha256',p.snapshot_sha256,'sourceSha256',p.source_sha256,
    'economicIdentitySha256',encode(sha256(convert_to(jsonb_build_array(p.shop,p.order_gid,p.revision)::text,'UTF8')),'hex'),
    'sameRevisionRecords',(select count(*) from lean_private.pipeline_snapshots x
      where x.shop=p.shop and x.order_gid=p.order_gid and x.revision=p.revision),
    'sameRevisionConflict',exists(select 1 from lean_private.pipeline_snapshots x
      where x.shop=p.shop and x.order_gid=p.order_gid and x.revision=p.revision and x.source is distinct from p.source),
    'equalOrNewerHead',exists(select 1 from lean_private.pipeline_heads h
      where h.shop=p.shop and h.order_gid=p.order_gid and h.revision>=p.revision),
    'hasOrderFacts',exists(select 1 from lean_private.orders o where o.publication_id=p.publication_id),
    'category',case
      when p.source_sha256='7df76771b2de58f8ae485e1bbbe17997a225609c09e8cc4941efa2f1598c4358' then 'zero_total_unresolved'
      when p.source_sha256='967d4d3a6027912a30137d71263421f6c4c64e9a692d49a2f605f1c837ce55c1' then 'exact_historical_refund'
      when exists(select 1 from jsonb_array_elements(
        case when jsonb_typeof(p.source#>'{commerce,order,lineItems,nodes}')='array'
          then p.source#>'{commerce,order,lineItems,nodes}' else '[]'::jsonb end) l
        where l#>>'{product,id}' in ('gid://shopify/Product/10244806213824',
          'gid://shopify/Product/10249371680960','gid://shopify/Product/8501257306304')) then 'catalog_candidate'
      else 'unclassified_unresolved' end) row,p.work_id
  from population p
)
select jsonb_build_object('capturedAt',clock_timestamp(),'transactionSnapshot',txid_current_snapshot()::text,
  'scope',(select to_jsonb(c)-'policy' from lean_private.pipeline_scope c
    where c.shop='mullybox-store.myshopify.com' and c.project_ref='xnfjdbpjuaezxjgargto'),
  'scopeSha256',(select encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex')
    from lean_private.pipeline_scope c where c.shop='mullybox-store.myshopify.com' and c.project_ref='xnfjdbpjuaezxjgargto'),
  'overflow',(select count(*)>5000 from population),
  'recordCount',(select count(*) from population),
  'distinctRetainedOrders',(select count(distinct (shop,order_gid)) from population where order_gid is not null),
  'rows',coalesce((select jsonb_agg(row order by work_id) from rows),'[]'::jsonb),
  'executionAuthorized',false);
commit;
