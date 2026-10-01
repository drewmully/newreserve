-- PRIVATE proposal. Requires unchanged 040/041. No authority rows, enabled jobs,
-- provider calls, customer analytics permission or runtime registration grants.
begin;
create table lean_private.history_target_approvals (
  approval_id text primary key check(approval_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  manifest jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create table lean_private.history_target_revocations (
  approval_id text primary key references lean_private.history_target_approvals,
  reason text not null check(length(trim(reason)) between 1 and 500),
  revoked_at timestamptz not null default clock_timestamp()
);
alter table lean_private.history_target_approvals enable row level security;
alter table lean_private.history_target_revocations enable row level security;
revoke all on lean_private.history_target_approvals,lean_private.history_target_revocations
  from public,anon,authenticated,service_role;

create function lean_private.history_target_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin raise exception 'target authority immutable; revoke, never renew'; end $$;
create trigger immutable_history_target_approval before update or delete on lean_private.history_target_approvals
for each row execute function lean_private.history_target_immutable();
create trigger immutable_history_target_revocation before update or delete on lean_private.history_target_revocations
for each row execute function lean_private.history_target_immutable();

-- Fixed old field projection, parameterized only by the approved UTC cutoff.
create function lean_private.history_target_query(p_until text) returns text
language plpgsql immutable set search_path=pg_catalog as $$
begin
  if p_until is null or p_until !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' or
    not isfinite(p_until::timestamptz) or to_char(p_until::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')<>p_until
    then raise exception 'invalid target cutoff'; end if;
  return '{ orders(query: "created_at:<'''||p_until||'''", sortKey: CREATED_AT) { edges { node {
  __typename id createdAt updatedAt processedAt cancelledAt test edited taxesIncluded currencyCode displayFinancialStatus
  totalPriceSet { shopMoney { amount currencyCode } } currentTotalPriceSet { shopMoney { amount currencyCode } } subtotalPriceSet { shopMoney { amount currencyCode } }
  totalTaxSet { shopMoney { amount currencyCode } } totalDiscountsSet { shopMoney { amount currencyCode } } totalRefundedSet { shopMoney { amount currencyCode } }
  refunds { id createdAt updatedAt totalRefundedSet { shopMoney { amount currencyCode } } }
  lineItems { edges { node { __typename id quantity currentQuantity isGiftCard requiresShipping taxable
    product { id } variant { id } originalTotalSet { shopMoney { amount currencyCode } } originalUnitPriceSet { shopMoney { amount currencyCode } } totalDiscountSet { shopMoney { amount currencyCode } }
  } } }
} } } }';
end $$;

create function lean_private.history_target_report_queries(p_customer boolean) returns jsonb
language plpgsql immutable set search_path=pg_catalog as $$
declare q text:=$query$
query AnalyticsOrder($id: ID!, $cursor: String) {
  order(id: $id) {
    id createdAt updatedAt currencyCode edited taxesIncluded test cancelledAt
    originalTotalPriceSet { shopMoney { amount currencyCode } }
    subtotalPriceSet { shopMoney { amount currencyCode } }
    transactionsCount { count precision }
    transactions(first: 250) {
      id kind status gateway test createdAt processedAt
      amountSet { shopMoney { amount currencyCode } }
      parentTransaction { id gateway }
    }
    lineItems(first: 250, after: $cursor) {
      nodes {
        id sku quantity isGiftCard product { id }
        originalUnitPriceSet { shopMoney { amount currencyCode } }
        originalTotalSet { shopMoney { amount currencyCode } }
        discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}$query$;
begin
  if p_customer then q:=replace(q,'id createdAt updatedAt currencyCode',E'customer { id }\n    id createdAt updatedAt currencyCode'); end if;
  return jsonb_build_object('order',q,'financial',$query$query AnalyticsFinancial($id: ID!) {
  order(id: $id) {
    id updatedAt currencyCode
    originalTotalPriceSet { shopMoney { amount currencyCode } } totalTaxSet { shopMoney { amount currencyCode } }
    originalTotalDutiesSet { shopMoney { amount currencyCode } } originalTotalAdditionalFeesSet { shopMoney { amount currencyCode } }
    totalTipReceivedSet { shopMoney { amount currencyCode } }
    shippingLines(first: 100, includeRemovals: true) {
      nodes { id discountedPriceSet { shopMoney { amount currencyCode } } } pageInfo { hasNextPage endCursor }
    }
    refunds { id updatedAt }
  }
}$query$,'refund',$query$query AnalyticsRefund($id: ID!) {
  refund(id: $id) {
    id createdAt updatedAt order { id } totalRefundedSet { shopMoney { amount currencyCode } }
    duties { amountSet { shopMoney { amount currencyCode } } }
    orderAdjustments(first: 1) { nodes { id } pageInfo { hasNextPage endCursor } }
    refundLineItems(first: 100) {
      nodes { id quantity lineItem { id } subtotalSet { shopMoney { amount currencyCode } } totalTaxSet { shopMoney { amount currencyCode } } } pageInfo { hasNextPage endCursor }
    }
    refundShippingLines(first: 100) {
      nodes { id shippingLine { id } subtotalAmountSet { shopMoney { amount currencyCode } } taxAmountSet { shopMoney { amount currencyCode } } } pageInfo { hasNextPage endCursor }
    }
    transactions(first: 100) {
      nodes { id kind status processedAt amountSet { shopMoney { amount currencyCode } } } pageInfo { hasNextPage endCursor }
    }
  }
}$query$);
end $$;

-- This validator checks structure, not provenance. Only the DB owner may stage
-- the independently approved receipt, after out-of-band review of its evidence.
create function lean_private.history_target_validate(m jsonb) returns void
language plpgsql set search_path=pg_catalog as $$
declare s jsonb:=m->'scope'; r jsonb:=m->'report'; e timestamptz; p timestamptz; policy jsonb; f date; t date;
begin
  if jsonb_typeof(m) is distinct from 'object' or
    m-array['approvalId','scope','projection','inventoryRef','operatorRef','report']<>'{}'::jsonb or
    not m ?& array['approvalId','scope','projection','inventoryRef','operatorRef','report'] or
    coalesce(m->>'approvalId','') !~ '^[a-zA-Z0-9_-]{1,100}$' or
    m->>'projection' is distinct from '040_no_customer_v1' or
    coalesce(trim(m->>'inventoryRef'),'')='' or coalesce(trim(m->>'operatorRef'),'')='' or
    jsonb_typeof(s) is distinct from 'object' or
    s-array['jobId','projectRef','shop','appId','installationId','apiVersion','untilTime','queryText','queryHash',
      'expectedOrders','expiresAt','purgeAfter','approvalRef','actorRef']<>'{}'::jsonb or
    not s ?& array['jobId','projectRef','shop','appId','installationId','apiVersion','untilTime','queryText','queryHash',
      'expectedOrders','expiresAt','purgeAfter','approvalRef','actorRef'] or
    coalesce(s->>'jobId','') !~ '^[a-zA-Z0-9_-]{1,100}$' or
    s->>'projectRef' is distinct from 'xnfjdbpjuaezxjgargto' or
    s->>'shop' is distinct from 'mullybox-store.myshopify.com' or
    coalesce(s->>'appId','') !~ '^gid://shopify/App/[1-9][0-9]*$' or
    coalesce(s->>'installationId','') !~ '^gid://shopify/AppInstallation/[1-9][0-9]*$' or
    s->>'apiVersion' is distinct from '2026-07' or
    s->>'queryText' is distinct from lean_private.history_target_query(s->>'untilTime') or
    s->>'queryHash' is distinct from encode(sha256(convert_to(s->>'queryText','UTF8')),'hex') or
    s->>'approvalRef' is distinct from m->>'approvalId' or s->>'actorRef' is distinct from m->>'operatorRef' or
    jsonb_typeof(s->'expectedOrders') is distinct from 'number' or coalesce(s->>'expectedOrders','') !~ '^[0-9]{1,5}$' or
    (s->>'expectedOrders')::integer not between 0 and 70000
    then raise exception 'invalid target manifest'; end if;
  e:=(s->>'expiresAt')::timestamptz; p:=(s->>'purgeAfter')::timestamptz;
  if e is null or not isfinite(e) or p is null or not isfinite(p) or p<e or p>e+interval '24 hours'
    then raise exception 'invalid target expiry'; end if;
  if jsonb_typeof(r) is distinct from 'object' or
    r-array['runId','fromDate','throughDate','includeCustomerId','policy','spendRuns','queries','expiresAt']<>'{}'::jsonb or
    not r ?& array['runId','fromDate','throughDate','includeCustomerId','policy','spendRuns','queries','expiresAt'] or
    coalesce(r->>'runId','') !~ '^[a-zA-Z0-9_-]{1,100}$' or
    jsonb_typeof(r->'includeCustomerId') is distinct from 'boolean' or
    jsonb_typeof(r->'spendRuns') is distinct from 'array' or jsonb_array_length(r->'spendRuns')>100 or
    jsonb_typeof(r->'queries') is distinct from 'object' or
    (r->'queries')-array['order','financial','refund']<>'{}'::jsonb or
    not (r->'queries') ?& array['order','financial','refund'] or
    exists(select 1 from jsonb_each(r->'queries') q where jsonb_typeof(value)<>'string' or length(value#>>'{}') not between 1 and 10000)
    then raise exception 'invalid target report plan'; end if;
  if r->'queries' is distinct from lean_private.history_target_report_queries((r->>'includeCustomerId')::boolean)
    then raise exception 'unapproved target report projection'; end if;
  f:=(r->>'fromDate')::date; t:=(r->>'throughDate')::date;
  if r->>'expiresAt' is null or not isfinite((r->>'expiresAt')::timestamptz)
    then raise exception 'invalid report approval expiry'; end if;
  if f is null or t is null or not isfinite(f) or not isfinite(t) or t-f not between 0 and 3659
    then raise exception 'invalid target report duration'; end if;
  policy:=r->'policy';
  if policy is distinct from 'null'::jsonb and
    (jsonb_typeof(policy) is distinct from 'object' or coalesce(trim(policy->>'financialApprovalRef'),'')='' or
      coalesce(trim(policy#>>'{decision,approvalRef}'),'')='' or policy#>>'{decision,eligibility}' is distinct from 'eligible' or
      policy#>'{decision,acquisitionEligible}' is distinct from 'false'::jsonb or
      policy->>'saleClock' is distinct from 'paid_at' or policy->>'refundClock' is distinct from 'refund_created_at' or
      jsonb_typeof(policy->'productClasses') is distinct from 'object')
    then raise exception 'invalid historical financial policy'; end if;
  if (select count(*)<>count(distinct x) from jsonb_array_elements_text(r->'spendRuns') x)
    then raise exception 'duplicate spend run'; end if;
end $$;
create function public.lean_history_target_stage(p_manifest jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare e timestamptz;
begin
  perform lean_private.history_target_validate(p_manifest);
  e:=(p_manifest#>>'{scope,expiresAt}')::timestamptz;
  if e<=clock_timestamp() or e>clock_timestamp()+interval '24 hours' or
    (p_manifest#>>'{report,expiresAt}')::timestamptz<=clock_timestamp() or
    (p_manifest#>>'{report,expiresAt}')::timestamptz>clock_timestamp()+interval '30 days'
    then raise exception 'invalid original approval expiry'; end if;
  insert into lean_private.history_target_approvals values(p_manifest->>'approvalId',p_manifest,clock_timestamp());
  return true;
end $$;
-- All transitions acquire a share lock on the approval before sampling the clock.
-- Revocation takes the conflicting update lock, including its first insertion.
create function lean_private.history_target_revoke_guard() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  perform 1 from lean_private.history_target_approvals where approval_id=new.approval_id for update;
  if not found then raise exception 'no target approval to revoke'; end if;
  return new;
end $$;
create trigger serialize_history_target_revocation before insert on lean_private.history_target_revocations
for each row execute function lean_private.history_target_revoke_guard();
create function public.lean_history_target_revoke(p_approval text,p_reason text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
begin
  insert into lean_private.history_target_revocations(approval_id,reason) values(p_approval,p_reason);
  return true;
end $$;
create function lean_private.history_target_manifest(p_id text,p_phase text default 'import') returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare m jsonb;
begin
  -- A share lock cannot refresh an older REPEATABLE READ/SERIALIZABLE snapshot
  -- of the append-only revocation relation. Reject unsupported isolation before
  -- any marked authority decision, including replay and post-write checks.
  if current_setting('transaction_isolation') is distinct from 'read committed'
    then raise exception 'unsupported target transaction isolation; requires read committed'; end if;
  select manifest into m from lean_private.history_target_approvals where approval_id=p_id for share;
  if not found or exists(select 1 from lean_private.history_target_revocations where approval_id=p_id)
    then raise exception 'no current target approval'; end if;
  perform lean_private.history_target_validate(m);
  if p_phase not in ('import','report') or
    (case when p_phase='import' then m#>>'{scope,expiresAt}' else m#>>'{report,expiresAt}' end)::timestamptz<=clock_timestamp()
    then raise exception 'target approval expired'; end if;
  return m;
end $$;
create function lean_private.history_target_import_scope(m jsonb) returns jsonb
language sql immutable set search_path=pg_catalog as $$
  select (m->'scope')||jsonb_build_object('targetApproval',m->>'approvalId')
$$;
create function lean_private.history_target_report_scope(m jsonb,p_hash text) returns jsonb
language sql immutable set search_path=pg_catalog as $$
  select ((m->'report')-'queries')||jsonb_build_object('sourceJob',m#>>'{scope,jobId}','sourceHash',p_hash,
    'projectRef',m#>>'{scope,projectRef}','shop',m#>>'{scope,shop}',
    'approvalRef',m->>'approvalId','actorRef',m->>'operatorRef','targetApproval',m->>'approvalId')
$$;
create function public.lean_history_target_import_register(p_approval text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare m jsonb:=lean_private.history_target_manifest(p_approval);
begin
  insert into lean_private.history_import_jobs(job_id,scope,expires_at)
    values(m#>>'{scope,jobId}',lean_private.history_target_import_scope(m),(m#>>'{scope,expiresAt}')::timestamptz);
  return true;
end $$;
create function public.lean_history_target_report_register(p_approval text,p_source_hash text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare m jsonb:=lean_private.history_target_manifest(p_approval,'report'); h lean_private.history_import_jobs; s jsonb;
begin
  select * into h from lean_private.history_import_jobs where job_id=m#>>'{scope,jobId}' for share;
  if not found or h.state<>'complete' or not h.enabled or h.scope is distinct from lean_private.history_target_import_scope(m) or
    encode(sha256(convert_to(h.completion::text,'UTF8')),'hex') is distinct from p_source_hash
    then raise exception 'unavailable completed target history'; end if;
  s:=lean_private.history_target_report_scope(m,p_source_hash);
  insert into lean_private.history_report_jobs(run_id,scope,source_job,source_hash,expires_at,report_date)
    values(s->>'runId',s,h.job_id,p_source_hash,(s->>'expiresAt')::timestamptz,(s->>'fromDate')::date);
  insert into lean_private.publications(publication_id,contract_version) values('history:'||(s->>'runId'),'lean-v1-draft.1');
  return true;
end $$;

-- Preserve the old function OIDs/bodies as aliases. Only new marked jobs dispatch.
alter function lean_private.history_import_lock(text,text,text) rename to history_target_legacy_import_lock;
create function lean_private.history_import_lock(p_job text,p_project text,p_shop text)
returns lean_private.history_import_jobs language plpgsql set search_path=pg_catalog as $$
declare j lean_private.history_import_jobs; m jsonb;
begin
  j:=lean_private.history_target_legacy_import_lock(p_job,p_project,p_shop);
  if j.scope ? 'targetApproval' then
    m:=lean_private.history_target_manifest(j.scope->>'targetApproval');
    if j.scope is distinct from lean_private.history_target_import_scope(m) or
      j.expires_at is distinct from (m#>>'{scope,expiresAt}')::timestamptz
      then raise exception 'target import binding changed'; end if;
  end if;
  return j;
end $$;
alter function lean_private.history_report_lock(text,text) rename to history_target_legacy_report_lock;
create function lean_private.history_report_lock(p_run text,p_project text)
returns lean_private.history_report_jobs language plpgsql set search_path=pg_catalog as $$
declare r lean_private.history_report_jobs; m jsonb; h lean_private.history_import_jobs;
begin
  r:=lean_private.history_target_legacy_report_lock(p_run,p_project);
  if r.scope ? 'targetApproval' then
    m:=lean_private.history_target_manifest(r.scope->>'targetApproval','report');
    select * into h from lean_private.history_import_jobs where job_id=r.source_job;
    if r.scope is distinct from lean_private.history_target_report_scope(m,r.source_hash) or
      h.scope is distinct from lean_private.history_target_import_scope(m) or
      r.expires_at is distinct from (m#>>'{report,expiresAt}')::timestamptz
      then raise exception 'target report binding changed'; end if;
  end if;
  return r;
end $$;
create function public.lean_history_target_authority(p_kind text,p_id text,p_project text,p_operator text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s jsonb; m jsonb; j lean_private.history_import_jobs; r lean_private.history_report_jobs;
begin
  if p_kind='import' then
    j:=lean_private.history_import_lock(p_id,p_project,'mullybox-store.myshopify.com'); s:=j.scope;
  elsif p_kind='report' then
    r:=lean_private.history_report_lock(p_id,p_project);
    if not r.enabled then raise exception 'target report disabled'; end if;
    s:=r.scope;
  else raise exception 'invalid target action'; end if;
  m:=lean_private.history_target_manifest(s->>'targetApproval',p_kind);
  if m->>'operatorRef' is distinct from p_operator then raise exception 'target operator mismatch'; end if;
  return m;
end $$;

-- This is the unchanged 040 order-shape arm except for the explicit cutoff.
-- Line/money arms continue to use the old validator.
create function lean_private.history_target_shape(s jsonb,k text,p_until timestamptz) returns void
language plpgsql set search_path=pg_catalog as $$
declare names text[]; field text; r jsonb;
begin
  if k is distinct from 'order' then perform lean_private.history_import_shape(s,k); return; end if;
  names:=array['__typename','id','createdAt','updatedAt','processedAt','cancelledAt','test','edited','taxesIncluded',
    'currencyCode','displayFinancialStatus','totalPriceSet','currentTotalPriceSet','subtotalPriceSet','totalTaxSet',
    'totalDiscountsSet','totalRefundedSet','refunds'];
  if jsonb_typeof(s) is distinct from 'object' or s-names<>'{}'::jsonb or not s ?& names
    then raise exception 'unapproved source projection'; end if;
  if p_until is null or not isfinite(p_until) or s->>'__typename' is distinct from 'Order' or
    coalesce(s->>'id','') !~ '^gid://shopify/Order/[1-9][0-9]*$' or
    s->>'createdAt' is null or not isfinite((s->>'createdAt')::timestamptz) or
    (s->>'createdAt')::timestamptz>=p_until or
    s->>'updatedAt' is null or not isfinite((s->>'updatedAt')::timestamptz) or
    (s->>'updatedAt')::timestamptz<(s->>'createdAt')::timestamptz or coalesce(s->>'currencyCode','') !~ '^[A-Z]{3}$' or
    (s->'displayFinancialStatus' is distinct from 'null'::jsonb and coalesce(s->>'displayFinancialStatus','') !~ '^[A-Z_]{1,40}$') or
    jsonb_typeof(s->'refunds') is distinct from 'array' then raise exception 'invalid import order'; end if;
  foreach field in array array['test','edited','taxesIncluded'] loop
    if jsonb_typeof(s->field) is distinct from 'boolean' then raise exception 'invalid source flag'; end if;
  end loop;
  foreach field in array array['processedAt','cancelledAt'] loop
    if s->field is distinct from 'null'::jsonb and
      (s->>field is null or not isfinite((s->>field)::timestamptz)) then raise exception 'invalid source time'; end if;
  end loop;
  for r in select value from jsonb_array_elements(s->'refunds') loop
    if jsonb_typeof(r) is distinct from 'object' or r-array['id','createdAt','updatedAt','totalRefundedSet']<>'{}'::jsonb or
      not r ?& array['id','createdAt','updatedAt','totalRefundedSet'] or
      coalesce(r->>'id','') !~ '^gid://shopify/Refund/[1-9][0-9]*$' or
      r->>'updatedAt' is null or not isfinite((r->>'updatedAt')::timestamptz) or
      (r->'createdAt'<>'null'::jsonb and not isfinite((r->>'createdAt')::timestamptz))
      then raise exception 'invalid refund summary'; end if;
    perform lean_private.history_import_shape(jsonb_build_object('money',r->'totalRefundedSet'),'money');
  end loop;
  foreach field in array array['totalPriceSet','currentTotalPriceSet','subtotalPriceSet','totalTaxSet','totalDiscountsSet','totalRefundedSet'] loop
    if s->field='null'::jsonb and field=any(array['subtotalPriceSet','totalTaxSet','totalDiscountsSet']) then continue; end if;
    perform lean_private.history_import_shape(jsonb_build_object('money',s->field),'money');
  end loop;
end $$;
alter function public.lean_history_import_batch(text,text,text,uuid,jsonb) set schema lean_private;
alter function lean_private.lean_history_import_batch(text,text,text,uuid,jsonb) rename to history_target_legacy_import_batch;
create function public.lean_history_import_batch(p_job text,p_project text,p_shop text,p_token uuid,p_rows jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j lean_private.history_import_jobs; r jsonb; s jsonb; prior jsonb; n integer; orders_added integer:=0; lines_added integer:=0;
begin
  j:=lean_private.history_import_lock(p_job,p_project,p_shop);
  if not j.scope ? 'targetApproval' then
    return lean_private.history_target_legacy_import_batch(p_job,p_project,p_shop,p_token,p_rows);
  end if;
  perform lean_private.history_import_live(j,p_token);
  if j.state<>'importing' or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 250 or
    octet_length(p_rows::text)>2000000 then raise exception 'invalid history batch'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r) is distinct from 'object' or r-array['kind','source']<>'{}'::jsonb or
      coalesce(r->>'kind','') not in ('order','line') then raise exception 'invalid history record'; end if;
    s:=r->'source'; perform lean_private.history_target_shape(s,r->>'kind',(j.scope->>'untilTime')::timestamptz);
    if r->>'kind'='order' then
      insert into lean_private.history_import_orders values(p_job,s->>'id',s) on conflict do nothing;
      get diagnostics n=row_count; orders_added:=orders_added+n;
      select source into prior from lean_private.history_import_orders where job_id=p_job and id=s->>'id';
    else
      insert into lean_private.history_import_lines values(p_job,s->>'id',s->>'__parentId',s) on conflict do nothing;
      get diagnostics n=row_count; lines_added:=lines_added+n;
      select source into prior from lean_private.history_import_lines where job_id=p_job and id=s->>'id';
    end if;
    if prior is distinct from s then raise exception 'conflicting retained source'; end if;
  end loop;
  update lean_private.history_import_jobs set orders=orders+orders_added,lines=lines+lines_added where job_id=p_job;
  perform lean_private.history_import_live(j,p_token);
  perform lean_private.history_target_manifest(j.scope->>'targetApproval');
  return true;
end $$;

-- End-of-statement checks cover all existing claim/write/finish implementations,
-- including expiry during a write. Disabled registration and owner purge remain possible.
create function lean_private.history_target_write_guard() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare m jsonb;
begin
  if new.scope ? 'targetApproval' and new.enabled then
    m:=lean_private.history_target_manifest(new.scope->>'targetApproval',
      case when tg_table_name='history_import_jobs' then 'import' else 'report' end);
    if new.expires_at is distinct from
      (case when tg_table_name='history_import_jobs' then m#>>'{scope,expiresAt}' else m#>>'{report,expiresAt}' end)::timestamptz or
      (tg_table_name='history_import_jobs' and new.scope is distinct from lean_private.history_target_import_scope(m)) or
      (tg_table_name='history_report_jobs' and new.scope is distinct from
        lean_private.history_target_report_scope(m,new.scope->>'sourceHash'))
      then raise exception 'target write binding changed'; end if;
  end if;
  return new;
end $$;
create trigger target_import_write_guard after insert or update on lean_private.history_import_jobs
for each row execute function lean_private.history_target_write_guard();
create trigger target_report_write_guard after insert or update on lean_private.history_report_jobs
for each row execute function lean_private.history_target_write_guard();
-- 041 retain and progress finish write only child rows, not the job itself.
create function lean_private.history_target_report_write_guard() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare r lean_private.history_report_jobs;
begin
  select * into r from lean_private.history_report_jobs where run_id=new.run_id;
  if r.scope ? 'targetApproval' then
    perform lean_private.history_report_lock(r.run_id,r.scope->>'projectRef');
    if not r.enabled then raise exception 'target report disabled'; end if;
  end if;
  return new;
end $$;
create trigger target_report_source_write_guard after insert or update on lean_private.history_report_sources
for each row execute function lean_private.history_target_report_write_guard();
create trigger target_report_progress_write_guard after insert or update on lean_private.history_report_progress
for each row execute function lean_private.history_target_report_write_guard();

-- Check effective privileges, including inherited roles. Never rely on raw ACL alone.
revoke all on function public.lean_history_target_stage(jsonb),public.lean_history_target_revoke(text,text),
  public.lean_history_target_import_register(text),public.lean_history_target_report_register(text,text),
  lean_private.history_target_immutable(),lean_private.history_target_query(text),
  lean_private.history_target_report_queries(boolean),
  lean_private.history_target_validate(jsonb),lean_private.history_target_manifest(text,text),
  lean_private.history_target_revoke_guard(),
  lean_private.history_target_import_scope(jsonb),lean_private.history_target_report_scope(jsonb,text),
  lean_private.history_target_legacy_import_lock(text,text,text),lean_private.history_import_lock(text,text,text),
  lean_private.history_target_legacy_report_lock(text,text),lean_private.history_report_lock(text,text),
  lean_private.history_target_legacy_import_batch(text,text,text,uuid,jsonb),
  lean_private.history_target_shape(jsonb,text,timestamptz),
  lean_private.history_target_write_guard(),lean_private.history_target_report_write_guard()
from public,anon,authenticated,service_role;
revoke all on function public.lean_history_target_authority(text,text,text,text),
  public.lean_history_import_batch(text,text,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.lean_history_target_authority(text,text,text,text),
  public.lean_history_import_batch(text,text,text,uuid,jsonb) to service_role;
do $$
declare r text; f record; t text;
begin
  foreach r in array array['anon','authenticated','service_role'] loop
    for f in select p.oid,p.proname,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where (n.nspname='lean_private' and (p.proname like 'history_target_%' or p.proname in ('history_import_lock','history_report_lock')))
        or (n.nspname='public' and p.proname in ('lean_history_target_stage','lean_history_target_revoke','lean_history_target_import_register','lean_history_target_report_register'))
    loop
      if has_function_privilege(r,f.oid,'EXECUTE') then raise exception 'inherited target bypass: %.% %',f.nspname,f.proname,r; end if;
    end loop;
    foreach t in array array['history_target_approvals','history_target_revocations'] loop
      if has_table_privilege(r,'lean_private.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        then raise exception 'inherited target authority access: % %',t,r; end if;
    end loop;
  end loop;
end $$;
commit;
