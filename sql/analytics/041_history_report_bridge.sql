-- Completed 040 SOURCE inventory -> resumable private canonical/report candidate.
-- Owner registration only, disabled by default. No 018 substitution, certification,
-- export grants, production activation or schedule. Requires installed 001-024,040.
begin;
create table lean_private.history_report_jobs (
  run_id text primary key check(run_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  scope jsonb not null, source_job text not null references lean_private.history_import_jobs,
  source_hash text not null, enabled boolean not null default false,
  expires_at timestamptz not null, state text not null default 'orders'
    check(state in ('orders','reports','complete')),
  cursor_id text not null default '', processed integer not null default 0,
  unresolved integer not null default 0, report_date date not null,
  token uuid, lease_until timestamptz, claimed_order text, claimed_date date,
  check(processed between 0 and 70000 and unresolved between 0 and processed)
);
create table lean_private.history_report_sources (
  run_id text not null references lean_private.history_report_jobs,
  order_id text not null, source jsonb, captured_at timestamptz, source_hash text,
  outcome text, result_hash text, primary key(run_id,order_id),
  check((source is null)=(captured_at is null) and (source is null)=(source_hash is null))
);
alter table lean_private.history_report_jobs enable row level security;
alter table lean_private.history_report_sources enable row level security;
revoke all on lean_private.history_report_jobs,lean_private.history_report_sources from public,anon,authenticated,service_role;
create function lean_private.history_report_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if (new.run_id,new.scope,new.source_job,new.source_hash,new.expires_at)
    is distinct from (old.run_id,old.scope,old.source_job,old.source_hash,old.expires_at)
    then raise exception 'history report immutable scope'; end if;
  return new;
end $$;
create trigger immutable_history_report before update on lean_private.history_report_jobs
for each row execute function lean_private.history_report_immutable();
create function public.lean_history_report_register(p_scope jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare h lean_private.history_import_jobs; expiry timestamptz; f date; t date; p jsonb;
begin
  if jsonb_typeof(p_scope) is distinct from 'object' or
    p_scope-array['runId','sourceJob','sourceHash','projectRef','shop','expiresAt','fromDate','throughDate',
      'includeCustomerId','policy','spendRuns','approvalRef','actorRef']<>'{}'::jsonb or
    coalesce(trim(p_scope->>'approvalRef'),'')='' or coalesce(trim(p_scope->>'actorRef'),'')='' or
    jsonb_typeof(p_scope->'includeCustomerId') is distinct from 'boolean' or not (p_scope ? 'policy') or
    jsonb_typeof(p_scope->'spendRuns') is distinct from 'array' or jsonb_array_length(p_scope->'spendRuns')>100 or
    p_scope->>'projectRef' is distinct from 'xeqlgxvrhgwwudyqtnun' or
    p_scope->>'shop' is distinct from 'mullybox-store.myshopify.com'
    then raise exception 'invalid history report scope'; end if;
  select * into h from lean_private.history_import_jobs where job_id=p_scope->>'sourceJob' for share;
  if not found or h.state<>'complete' or not h.enabled or
    h.scope->>'projectRef' is distinct from p_scope->>'projectRef' or h.scope->>'shop' is distinct from p_scope->>'shop' or
    encode(sha256(convert_to(h.completion::text,'UTF8')),'hex') is distinct from p_scope->>'sourceHash'
    then raise exception 'unavailable completed history'; end if;
  expiry:=(p_scope->>'expiresAt')::timestamptz; f:=(p_scope->>'fromDate')::date; t:=(p_scope->>'throughDate')::date;
  if expiry is null or not isfinite(expiry) or expiry<=clock_timestamp() or expiry>clock_timestamp()+interval '30 days' or
    f is null or t is null or not isfinite(f) or not isfinite(t) or t-f not between 0 and 3659
    then raise exception 'invalid history report duration'; end if;
  -- Whole completed inventory is processed, even when reports select a narrower
  -- calendar. Policy, if supplied, explicitly applies to this entire source job.
  p:=p_scope->'policy';
  if p is distinct from 'null'::jsonb and
    (jsonb_typeof(p) is distinct from 'object' or coalesce(trim(p->>'financialApprovalRef'),'')='' or
      coalesce(trim(p#>>'{decision,approvalRef}'),'')='' or p#>>'{decision,eligibility}' is distinct from 'eligible' or
      p#>'{decision,acquisitionEligible}' is distinct from 'false'::jsonb or
      p->>'saleClock' is distinct from 'paid_at' or p->>'refundClock' is distinct from 'refund_created_at' or
      jsonb_typeof(p->'productClasses') is distinct from 'object')
    then raise exception 'invalid historical financial policy'; end if;
  if (select count(*)<>count(distinct x) from jsonb_array_elements_text(p_scope->'spendRuns') x)
    then raise exception 'duplicate spend run'; end if;
  insert into lean_private.history_report_jobs(run_id,scope,source_job,source_hash,expires_at,report_date)
    values(p_scope->>'runId',p_scope,h.job_id,p_scope->>'sourceHash',expiry,f);
  insert into lean_private.publications(publication_id,contract_version)
    values('history:'||(p_scope->>'runId'),'lean-v1-draft.1');
  return true;
end $$;
revoke all on function public.lean_history_report_register(jsonb) from public,anon,authenticated,service_role;

-- Source execution expiry does not expire durable 040 read access. The new
-- normalization run has its own deadline; source kill/purge/completion still bind.
create function lean_private.history_report_lock(p_run text,p_project text)
returns lean_private.history_report_jobs language plpgsql set search_path=pg_catalog as $$
declare r lean_private.history_report_jobs; h lean_private.history_import_jobs;
begin
  select * into r from lean_private.history_report_jobs
    where run_id=p_run and scope->>'projectRef'=p_project for update;
  if not found then raise exception 'unapproved history report'; end if;
  select * into h from lean_private.history_import_jobs where job_id=r.source_job for share;
  if not found or h.state<>'complete' or not h.enabled or
    encode(sha256(convert_to(h.completion::text,'UTF8')),'hex')<>r.source_hash
    then raise exception 'history source changed'; end if;
  return r;
end $$;
create function lean_private.history_report_live(r lean_private.history_report_jobs,p_token uuid)
returns void language plpgsql set search_path=pg_catalog as $$
begin
  if not r.enabled or r.expires_at<=clock_timestamp() or r.token is distinct from p_token or p_token is null or
    r.lease_until is null or r.lease_until<=clock_timestamp() then raise exception 'history report fence expired'; end if;
end $$;
create function lean_private.history_report_day_input(r lean_private.history_report_jobs)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare f jsonb:='{}'; t text; rows jsonb; input jsonb; spend jsonb:='[]'; s lean_private.spend_jobs; id text;
  numeric_fields text[];
  pub text:='history:'||r.run_id; ids text[];
begin
  select array_agg(o.order_id order by o.order_id) into ids from lean_private.orders o where o.publication_id=pub and
    (o.purchase_date=r.report_date or (o.created_at at time zone 'America/New_York')::date=r.report_date or
      exists(select 1 from lean_private.sales_ledger l where l.publication_id=pub and
        l.order_id=o.order_id and l.report_date=r.report_date));
  if coalesce(cardinality(ids),0)>10000 then raise exception 'history report day budget'; end if;
  foreach t in array array['customers','identity_map','orders','order_items','sales_ledger','payments',
    'order_item_offers','sessions','marketing_spend_daily','order_attribution'] loop
    rows:='[]';
    if t in ('orders','order_items','sales_ledger','payments') then
      select array_agg(column_name::text) into numeric_fields from information_schema.columns
        where table_schema='lean_private' and table_name=t and data_type='numeric';
      -- Never round a PG numeric via JavaScript JSON number before formulas.
      execute format('select coalesce(jsonb_agg((select jsonb_object_agg(k,
        case when k=any($3) and jsonb_typeof(v)=''number'' then to_jsonb(v#>>''{}'') else v end)
        from jsonb_each(to_jsonb(x)) kv(k,v)) order by to_jsonb(x)::text),''[]''::jsonb) from lean_private.%I x
        where publication_id=$1 and order_id=any($2)',t) into rows using pub,ids,numeric_fields;
    end if;
    f:=f||jsonb_build_object(t,rows);
  end loop;
  for id in select jsonb_array_elements_text(r.scope->'spendRuns') order by 1 loop
    select * into s from lean_private.spend_jobs where run_id=id for share;
    if not found or s.project_ref<>r.scope->>'projectRef' or not s.enabled or s.base is null
      then raise exception 'unavailable selected spend'; end if;
    if s.report_date=r.report_date then spend:=spend||jsonb_build_array(s.base); end if;
  end loop;
  input:=jsonb_build_object('state','report','shop',r.scope->>'shop','publication',pub,'date',r.report_date,
    'financialComplete',r.unresolved=0,'facts',f,'spend',spend);
  if octet_length(input::text)>16000000 then raise exception 'history report input budget'; end if;
  return input||jsonb_build_object('inputHash',encode(sha256(convert_to(input::text,'UTF8')),'hex'));
end $$;
create function public.lean_history_report_claim(p_run text,p_project text,p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.history_report_jobs; o lean_private.history_import_orders; raw jsonb;
  retained jsonb; n integer; inserted integer; input jsonb; pub text:='history:'||p_run;
begin
  r:=lean_private.history_report_lock(p_run,p_project);
  if not r.enabled then return jsonb_build_object('state','disabled'); end if;
  if r.state='complete' then return jsonb_build_object('state','complete','processed',r.processed,'unresolved',r.unresolved); end if;
  if r.expires_at<=clock_timestamp() then return jsonb_build_object('state','expired'); end if;
  if r.token is not null and r.lease_until>clock_timestamp() then return jsonb_build_object('state','busy'); end if;
  if p_token is null then raise exception 'missing token'; end if;
  if r.state='orders' then
    select * into o from lean_private.history_import_orders
      where job_id=r.source_job and id>r.cursor_id order by id limit 1;
    if not found then
      if r.processed<>(select orders from lean_private.history_import_jobs where job_id=r.source_job)
        then raise exception 'history progress incomplete'; end if;
      update lean_private.history_report_jobs set state='reports' where run_id=p_run;
      r.state:='reports';
    end if;
  end if;
  update lean_private.history_report_jobs set token=p_token,lease_until=least(expires_at,clock_timestamp()+interval '90 seconds'),
    claimed_order=case when r.state='orders' then o.id else null end,
    claimed_date=case when r.state='reports' then report_date else null end where run_id=p_run returning * into r;
  if r.state='reports' then return lean_private.history_report_day_input(r); end if;
  select count(*) into n from lean_private.history_import_lines where job_id=r.source_job and parent_id=o.id;
  select coalesce(jsonb_agg(source order by id),'[]') into raw from
    (select source,id from lean_private.history_import_lines where job_id=r.source_job and parent_id=o.id order by id limit 500) l;
  select source into retained from lean_private.history_report_sources where run_id=p_run and order_id=o.id;
  -- Reserve the one source attempt before any external call. An interrupted
  -- unretained request becomes an explicit unresolved outcome, never auto-retry.
  insert into lean_private.history_report_sources(run_id,order_id) values(p_run,o.id) on conflict do nothing;
  get diagnostics inserted=row_count;
  input:=jsonb_build_object('state','order','shop',r.scope->>'shop','publication',pub,'sourceJob',r.source_job,
    'sourceHash',r.source_hash,'original',o.source,'lines',raw,'lineCount',n,'source',retained,
    'policy',r.scope->'policy','includeCustomerId',r.scope->'includeCustomerId','canRead',inserted=1);
  if octet_length(input::text)>12000000 then raise exception 'history order input budget'; end if;
  return input;
end $$;
create function public.lean_history_report_retain(p_run text,p_project text,p_token uuid,
  p_order text,p_source jsonb,p_captured_at timestamptz) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.history_report_jobs; old jsonb; h text;
begin
  r:=lean_private.history_report_lock(p_run,p_project); perform lean_private.history_report_live(r,p_token);
  if r.state<>'orders' or r.claimed_order is distinct from p_order or
    p_source-array['commerce','financial','refunds']<>'{}'::jsonb or
    (p_source->'commerce')-array['shop','apiVersion','projection','order']<>'{}'::jsonb or
    (p_source#>'{commerce,order}')-array['id','createdAt','updatedAt','currencyCode','edited','taxesIncluded','test',
      'cancelledAt','originalTotalPriceSet','subtotalPriceSet','transactionsCount','transactions','lineItems','customer']<>'{}'::jsonb or
    p_source#>>'{commerce,order,id}' is distinct from p_order or
    p_source#>>'{commerce,shop}' is distinct from r.scope->>'shop' or
    p_source#>>'{commerce,apiVersion}' is distinct from '2026-07' or
    p_source#>>'{commerce,projection}' is distinct from
      (case when (r.scope->>'includeCustomerId')::boolean then 'financial_customer_id' else 'financial_no_geo' end) or
    (p_source#>'{commerce,order}') ? 'shippingAddress' or
    p_source#>>'{financial,id}' is distinct from p_order or
    p_source#>>'{financial,updatedAt}' is distinct from p_source#>>'{commerce,order,updatedAt}' or
    jsonb_typeof(p_source->'refunds') is distinct from 'array' or octet_length(p_source::text)>8388608 or
    p_captured_at is null or not isfinite(p_captured_at) or p_captured_at>clock_timestamp()+interval '5 seconds'
    then raise exception 'invalid retained historical source'; end if;
  if exists(select 1 from jsonb_array_elements(p_source#>'{commerce,order,lineItems,nodes}') l
    where l-array['id','sku','quantity','isGiftCard','product','originalUnitPriceSet','originalTotalSet','discountAllocations']<>'{}'::jsonb) or
    exists(select 1 from jsonb_array_elements(p_source#>'{commerce,order,transactions}') t
      where t-array['id','kind','status','gateway','test','createdAt','processedAt','amountSet','parentTransaction']<>'{}'::jsonb) or
    (p_source->'financial')-array['id','updatedAt','currencyCode','originalTotalPriceSet','totalTaxSet',
      'originalTotalDutiesSet','originalTotalAdditionalFeesSet','totalTipReceivedSet','shippingLines','refunds']<>'{}'::jsonb or
    exists(select 1 from jsonb_array_elements(p_source->'refunds') f where f-array['id','createdAt','updatedAt','order',
      'totalRefundedSet','duties','orderAdjustments','refundLineItems','refundShippingLines','transactions']<>'{}'::jsonb)
    then raise exception 'unrequested historical source fields'; end if;
  if not (r.scope->>'includeCustomerId')::boolean and (p_source#>'{commerce,order}') ? 'customer'
    then raise exception 'unrequested customer identity'; end if;
  h:=encode(sha256(convert_to(p_source::text,'UTF8')),'hex');
  update lean_private.history_report_sources set source=p_source,captured_at=p_captured_at,source_hash=h
    where run_id=p_run and order_id=p_order and source is null and outcome is null;
  select source into old from lean_private.history_report_sources where run_id=p_run and order_id=p_order;
  if old is distinct from p_source then raise exception 'retained history source immutable'; end if;
  perform lean_private.history_report_live(r,p_token); return true;
end $$;
create function public.lean_history_report_order(p_run text,p_project text,p_token uuid,p_order text,
  p_facts jsonb,p_outcome text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.history_report_jobs; s lean_private.history_report_sources; h text; t text; item jsonb;
  pub text:='history:'||p_run; expected text;
begin
  r:=lean_private.history_report_lock(p_run,p_project); perform lean_private.history_report_live(r,p_token);
  if r.state<>'orders' or r.claimed_order is distinct from p_order or p_outcome !~ '^[a-z_]{1,80}$' or
    jsonb_typeof(p_facts) is distinct from 'object' or octet_length(p_facts::text)>16000000 or
    (select count(*) from jsonb_object_keys(p_facts))<>10 then raise exception 'invalid history order output'; end if;
  select * into s from lean_private.history_report_sources where run_id=p_run and order_id=p_order;
  if p_outcome='financial_observed' and (r.scope->'policy'='null'::jsonb or s.source is null or
    s.source#>>'{commerce,order,updatedAt}' is distinct from (select source->>'updatedAt'
      from lean_private.history_import_orders where job_id=r.source_job and id=p_order))
    then raise exception 'unproven financial output'; end if;
  -- Matches key(): SHA256 of compact JSON tuple, preserving 64-bit IDs.
  expected:=encode(sha256(convert_to(replace(jsonb_build_array(r.scope->>'shop',
    substring(p_order from '[0-9]+$'))::text,', ',','),'UTF8')),'hex');
  if jsonb_array_length(p_facts->'orders')<>1 then raise exception 'missing canonical order'; end if;
  foreach t in array array['customers','identity_map','order_item_offers','sessions','marketing_spend_daily','order_attribution'] loop
    if p_facts->t is distinct from '[]'::jsonb then raise exception 'unproven history domain'; end if;
  end loop;
  foreach t in array array['orders','order_items','sales_ledger','payments'] loop
    if jsonb_typeof(p_facts->t) is distinct from 'array' or jsonb_array_length(p_facts->t)>10000
      then raise exception 'invalid history facts'; end if;
    for item in select value from jsonb_array_elements(p_facts->t) loop
      if item->>'publication_id' is distinct from pub or item->>'order_id' is distinct from expected
        then raise exception 'mixed history fact'; end if;
      if t='orders' and (item->>'shop_id' is distinct from r.scope->>'shop' or
        item->'customer_id' is distinct from 'null'::jsonb or item->'acquisition_eligible' is distinct from 'false'::jsonb or
        p_outcome<>'financial_observed' and item->>'eligibility_status' not in ('pending','excluded_test'))
        then raise exception 'unproven history order'; end if;
      if t='sales_ledger' and p_outcome<>'financial_observed' then raise exception 'unproven ledger'; end if;
      if t='payments' and (item->'cash_eligible' is distinct from 'false'::jsonb or
        item->'cash_amount_usd' is distinct from 'null'::jsonb) then raise exception 'unproven cash'; end if;
    end loop;
    execute format('insert into lean_private.%I select * from jsonb_populate_recordset(null::lean_private.%I,$1)',t,t)
      using p_facts->t;
  end loop;
  h:=encode(sha256(convert_to(p_facts::text||p_outcome,'UTF8')),'hex');
  insert into lean_private.history_report_sources(run_id,order_id,outcome,result_hash)
    values(p_run,p_order,p_outcome,h) on conflict(run_id,order_id)
    do update set outcome=excluded.outcome,result_hash=excluded.result_hash;
  update lean_private.history_report_jobs set cursor_id=p_order,processed=processed+1,
    unresolved=unresolved+case when p_outcome='financial_observed' then 0 else 1 end,
    token=null,lease_until=null,claimed_order=null where run_id=p_run;
  perform lean_private.history_report_live(r,p_token); return true;
end $$;
create function public.lean_history_report_day(p_run text,p_project text,p_token uuid,
  p_date date,p_input_hash text,p_reports jsonb,p_spend jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.history_report_jobs; input jsonb; t text; item jsonb; pub text:='history:'||p_run;
begin
  r:=lean_private.history_report_lock(p_run,p_project); perform lean_private.history_report_live(r,p_token);
  if r.state<>'reports' or r.claimed_date is distinct from p_date then raise exception 'wrong history report date'; end if;
  input:=lean_private.history_report_day_input(r);
  if input->>'inputHash' is distinct from p_input_hash then return false; end if;
  if jsonb_typeof(p_reports) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_reports))<>3 or
    jsonb_typeof(p_spend) is distinct from 'array' or jsonb_array_length(p_spend)>10000 or
    octet_length(p_reports::text)+octet_length(p_spend::text)>16000000
    then raise exception 'invalid history daily report'; end if;
  for item in select value from jsonb_array_elements(p_spend) loop
    if item->>'publication_id' is distinct from pub or (item->>'report_date')::date is distinct from p_date
      then raise exception 'invalid history spend'; end if;
  end loop;
  insert into lean_private.marketing_spend_daily
    select * from jsonb_populate_recordset(null::lean_private.marketing_spend_daily,p_spend);
  foreach t in array array['store_daily','product_daily','acquisition_daily'] loop
    if jsonb_typeof(p_reports->t) is distinct from 'array' or jsonb_array_length(p_reports->t)>20000
      then raise exception 'history report row budget'; end if;
    if t='store_daily' and jsonb_array_length(p_reports->t)<>1 then raise exception 'missing store date'; end if;
    for item in select value from jsonb_array_elements(p_reports->t) loop
      if item->>'publication_id' is distinct from pub or item->>'shop_id' is distinct from r.scope->>'shop' or
        item->>'definition_version' is distinct from 'history-bridge-v1' or item->'is_stale' is distinct from 'true'::jsonb or
        (item->>'report_date')::date is distinct from p_date or jsonb_typeof(item->'readiness') is distinct from 'object' or
        exists(select 1 from jsonb_each_text(item->'readiness') v where v.value not in ('withheld','observed_unverified'))
        then raise exception 'uncertified history report'; end if;
      if r.unresolved>0 and exists(select 1 from jsonb_each(item->'readiness') v
        where v.key<>'spend_usd' and (v.value<>'"withheld"'::jsonb or item->v.key is distinct from 'null'::jsonb))
        then raise exception 'partial historical sales'; end if;
      if t='store_daily' and (item->'collected_cash_usd' is distinct from 'null'::jsonb or
        item->'new_customers' is distinct from 'null'::jsonb or item->'ncac_usd' is distinct from 'null'::jsonb or
        item->'mer' is distinct from 'null'::jsonb)
        then raise exception 'unproven customer cash'; end if;
      if t='acquisition_daily' and exists(select 1 from jsonb_each(item->'readiness') v where v.key<>'spend_usd'
        and (v.value<>'"withheld"'::jsonb or item->v.key is distinct from 'null'::jsonb))
        then raise exception 'unproven historical attribution'; end if;
    end loop;
    execute format('insert into lean_private.%I select * from jsonb_populate_recordset(null::lean_private.%I,$1)',
      'report_'||t,'report_'||t) using p_reports->t;
  end loop;
  update lean_private.history_report_jobs set
    state=case when report_date=(scope->>'throughDate')::date then 'complete' else 'reports' end,
    report_date=report_date+1,token=null,lease_until=null,claimed_date=null where run_id=p_run;
  perform lean_private.history_report_live(r,p_token); return true;
end $$;
revoke all on function lean_private.history_report_immutable(),lean_private.history_report_lock(text,text),
  lean_private.history_report_live(lean_private.history_report_jobs,uuid),
  lean_private.history_report_day_input(lean_private.history_report_jobs) from public,anon,authenticated,service_role;
revoke all on function public.lean_history_report_claim(text,text,uuid),
  public.lean_history_report_retain(text,text,uuid,text,jsonb,timestamptz),
  public.lean_history_report_order(text,text,uuid,text,jsonb,text),
  public.lean_history_report_day(text,text,uuid,date,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.lean_history_report_claim(text,text,uuid),
  public.lean_history_report_retain(text,text,uuid,text,jsonb,timestamptz),
  public.lean_history_report_order(text,text,uuid,text,jsonb,text),
  public.lean_history_report_day(text,text,uuid,date,text,jsonb,jsonb) to service_role;
commit;
