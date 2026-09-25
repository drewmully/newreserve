-- Completed 040 inventory -> genuine pending canonical facts, without a provider.
-- Forward-only supplement to 041. No eligibility, report selection or schedule.
begin;
create table lean_private.history_inventory_runs (
  run_id text primary key references lean_private.history_report_jobs,
  source_mode text not null default 'inventory_only' check(source_mode='inventory_only'),
  complete boolean not null default false,
  source_lines bigint not null default 0, canonical_lines bigint not null default 0
);
create table lean_private.history_inventory_batches (
  run_id text not null references lean_private.history_inventory_runs,
  batch_no integer not null, ids text[] not null,
  input_hash text not null, token uuid not null, lease_until timestamptz not null,
  completed_at timestamptz, result_hash text, counts jsonb,
  primary key(run_id,batch_no)
);
alter table lean_private.history_inventory_runs enable row level security;
alter table lean_private.history_inventory_batches enable row level security;
revoke all on lean_private.history_inventory_runs,lean_private.history_inventory_batches
  from public,anon,authenticated,service_role;

create function public.lean_history_inventory_register(p_scope jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if p_scope->>'sourceMode' is distinct from 'inventory_only' or
    p_scope->'policy' is distinct from 'null'::jsonb or
    p_scope->'includeCustomerId' is distinct from 'false'::jsonb
    then raise exception 'inventory-only pending scope required'; end if;
  perform public.lean_history_report_register(p_scope-'sourceMode');
  insert into lean_private.history_inventory_runs(run_id) values(p_scope->>'runId');
  return true;
end $$;
revoke all on function public.lean_history_inventory_register(jsonb) from public,anon,authenticated,service_role;
-- No changes to 041 function definitions. Its hydration/day writers require a
-- job token; an inventory registration can never acquire that token.
create function lean_private.history_inventory_no_hydration() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if new.token is not null and exists(select 1 from lean_private.history_inventory_runs where run_id=new.run_id)
    then raise exception 'inventory-only job cannot hydrate'; end if;
  return new;
end $$;
create trigger inventory_no_hydration before update on lean_private.history_report_jobs
for each row execute function lean_private.history_inventory_no_hydration();

create function lean_private.history_inventory_order(r lean_private.history_report_jobs,p_id text)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare o jsonb; lines jsonb:='[]'; n integer; z integer; reasons jsonb:='[]';
begin
  select source into o from lean_private.history_import_orders where job_id=r.source_job and id=p_id;
  if not found then raise exception 'missing pinned inventory order'; end if;
  select count(*),count(*) filter(where (source->>'quantity')::numeric=0) into n,z
    from lean_private.history_import_lines where job_id=r.source_job and parent_id=p_id;
  if o->'edited'='true'::jsonb then reasons:=reasons||'"edited_source"'::jsonb; end if;
  if n>500 then reasons:=reasons||'"source_line_bound"'::jsonb; end if;
  if z>0 then reasons:=reasons||'"zero_quantity"'::jsonb; end if;
  if o->'edited'='false'::jsonb and n<=500 then
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'quantity',source->'quantity','product',source->'product')
      order by id),'[]') into lines from lean_private.history_import_lines where job_id=r.source_job and parent_id=p_id;
  end if;
  return jsonb_build_object('original',jsonb_build_object('id',o->'id','createdAt',o->'createdAt',
    'updatedAt',o->'updatedAt','currencyCode',o->'currencyCode','edited',o->'edited','test',o->'test','cancelledAt',o->'cancelledAt'),
    'sourceOrderHash',encode(sha256(convert_to(o::text,'UTF8')),'hex'),
    'lineCount',n,'zeroQuantityCount',z,'lines',lines,'withheldReasons',reasons,
    'canonicalExpectedCount',case when o->'edited'='false'::jsonb and n<=500 then n-z else 0 end);
end $$;
create function lean_private.history_inventory_input(r lean_private.history_report_jobs,p_ids text[])
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare orders jsonb:='[]'; id text; input jsonb; lines integer:=0; o jsonb;
begin
  if cardinality(p_ids) not between 1 and 100 then raise exception 'inventory order budget'; end if;
  foreach id in array p_ids loop
    o:=lean_private.history_inventory_order(r,id);orders:=orders||jsonb_build_array(o);
    lines:=lines+jsonb_array_length(o->'lines');
  end loop;
  input:=jsonb_build_object('state','inventory','sourceMode','inventory_only','shop',r.scope->>'shop',
    'publication','history:'||r.run_id,'sourceJob',r.source_job,'sourceHash',r.source_hash,'orders',orders);
  if lines>1000 or octet_length(input::text)>8388608 then raise exception 'inventory batch budget'; end if;
  return input;
end $$;
create function public.lean_history_inventory_claim(p_run text,p_project text,p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.history_report_jobs; i lean_private.history_inventory_runs;
  b lean_private.history_inventory_batches; ids text[]:='{}'; id text; o jsonb; input jsonb;
  n integer:=0; k integer; bytes integer:=0; h text;
begin
  r:=lean_private.history_report_lock(p_run,p_project);
  select * into i from lean_private.history_inventory_runs where run_id=p_run;
  if not found then raise exception 'unapproved inventory mode'; end if;
  if not r.enabled then return jsonb_build_object('state','disabled'); end if;
  if r.expires_at<=clock_timestamp() then return jsonb_build_object('state','expired'); end if;
  if p_token is null then raise exception 'inventory token required'; end if;
  if i.complete then return jsonb_build_object('state','inventory_complete','processedOrders',r.processed,
    'sourceLines',i.source_lines,'canonicalLines',i.canonical_lines,'withheldLines',i.source_lines-i.canonical_lines); end if;
  select * into b from lean_private.history_inventory_batches where run_id=p_run and completed_at is null;
  if found then
    if b.lease_until>clock_timestamp() then return jsonb_build_object('state','busy'); end if;
    input:=lean_private.history_inventory_input(r,b.ids);
    if encode(sha256(convert_to(input::text,'UTF8')),'hex')<>b.input_hash then raise exception 'inventory source changed'; end if;
    update lean_private.history_inventory_batches set token=p_token,
      lease_until=least(r.expires_at,clock_timestamp()+interval '90 seconds') where run_id=p_run and batch_no=b.batch_no;
  else
    for id in select x.id from lean_private.history_import_orders x
      where job_id=r.source_job and x.id>r.cursor_id order by x.id limit 100 loop
      o:=lean_private.history_inventory_order(r,id);k:=jsonb_array_length(o->'lines');
      if n+k>1000 or bytes+octet_length(o::text)>8380000 then exit; end if;
      ids:=array_append(ids,id);n:=n+k;bytes:=bytes+octet_length(o::text);
    end loop;
    if cardinality(ids)=0 then
      if r.processed=0 and (select orders=0 and lines=0 from lean_private.history_import_jobs where job_id=r.source_job) then
        update lean_private.history_inventory_runs set complete=true where run_id=p_run;
        return jsonb_build_object('state','inventory_complete','processedOrders',0,
          'sourceLines',0,'canonicalLines',0,'withheldLines',0);
      end if;
      raise exception 'inventory cursor or single order budget';
    end if;
    input:=lean_private.history_inventory_input(r,ids);
    h:=encode(sha256(convert_to(input::text,'UTF8')),'hex');
    select coalesce(max(batch_no),0)+1 into k from lean_private.history_inventory_batches where run_id=p_run;
    insert into lean_private.history_inventory_batches(run_id,batch_no,ids,input_hash,token,lease_until)
      values(p_run,k,ids,h,p_token,least(r.expires_at,clock_timestamp()+interval '90 seconds')) returning * into b;
  end if;
  return input||jsonb_build_object('batch',b.batch_no,'inputHash',b.input_hash);
end $$;
create function public.lean_history_inventory_finish(p_run text,p_project text,p_token uuid,
  p_batch integer,p_input_hash text,p_results jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.history_report_jobs; b lean_private.history_inventory_batches; input jsonb; h text;
  result jsonb; o jsonb; item jsonb; line jsonb; facts jsonb; t text; expected text; pub text:='history:'||p_run;
  v_source_lines bigint:=0; v_canonical_lines bigint:=0; n integer; actual_ids text[];
begin
  r:=lean_private.history_report_lock(p_run,p_project);
  select * into b from lean_private.history_inventory_batches where run_id=p_run and batch_no=p_batch;
  if not found or not r.enabled or r.expires_at<=clock_timestamp() or p_token is null or b.token is distinct from p_token or
    b.input_hash is distinct from p_input_hash then raise exception 'inventory fence'; end if;
  if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results)<>cardinality(b.ids) or
    octet_length(p_results::text)>8388608 then raise exception 'inventory result budget'; end if;
  h:=encode(sha256(convert_to(p_results::text,'UTF8')),'hex');
  if b.completed_at is not null then return b.result_hash=h; end if;
  if b.lease_until<=clock_timestamp() then raise exception 'inventory lease'; end if;
  input:=lean_private.history_inventory_input(r,b.ids);
  if encode(sha256(convert_to(input::text,'UTF8')),'hex')<>b.input_hash then raise exception 'inventory source changed'; end if;
  select array_agg(x->>'sourceOrderId' order by x->>'sourceOrderId') into actual_ids from jsonb_array_elements(p_results) x;
  if actual_ids is distinct from b.ids then raise exception 'inventory exact order set required'; end if;
  for result in select value from jsonb_array_elements(p_results) loop
    select value into o from jsonb_array_elements(input->'orders') where value#>>'{original,id}'=result->>'sourceOrderId';
    facts:=result->'facts';n:=(o->>'canonicalExpectedCount')::integer;
    if result->>'sourceMode' is distinct from 'inventory_only' or result->>'outcome' is distinct from 'inventory_pending' or
      result->'sourceOrderHash' is distinct from o->'sourceOrderHash' or result->'sourceLineCount' is distinct from o->'lineCount' or
      result->'canonicalLineCount' is distinct from to_jsonb(n) or
      result->'withheldLineCount' is distinct from to_jsonb((o->>'lineCount')::integer-n) or
      result->'withheldReasons' is distinct from o->'withheldReasons' or
      jsonb_typeof(facts) is distinct from 'object' or (select count(*) from jsonb_object_keys(facts))<>10 or
      jsonb_typeof(facts->'orders') is distinct from 'array' or jsonb_typeof(facts->'order_items') is distinct from 'array' or
      jsonb_array_length(facts->'orders')<>1 or jsonb_array_length(facts->'order_items')<>n
      then raise exception 'invalid inventory result'; end if;
    foreach t in array array['customers','identity_map','sales_ledger','payments','order_item_offers','sessions',
      'marketing_spend_daily','order_attribution'] loop
      if facts->t is distinct from '[]'::jsonb then raise exception 'inventory cannot infer other domains'; end if;
    end loop;
    expected:=encode(sha256(convert_to(replace(jsonb_build_array(r.scope->>'shop',
      substring(result->>'sourceOrderId' from '[0-9]+$'))::text,', ',','),'UTF8')),'hex');
    item:=facts#>'{orders,0}';
    if item->>'order_id' is distinct from expected or item->>'source_order_id' is distinct from
      substring(result->>'sourceOrderId' from '[0-9]+$') or item->>'shop_id' is distinct from r.scope->>'shop' or
      item->>'source_currency' is distinct from o#>>'{original,currencyCode}' or
      (item->>'created_at')::timestamptz is distinct from (o#>>'{original,createdAt}')::timestamptz or
      (item->>'source_updated_at')::timestamptz is distinct from (o#>>'{original,updatedAt}')::timestamptz or
      item->>'eligibility_status' is distinct from 'pending' or item->>'commerce_source' is distinct from 'other' or
      item->>'checkout_link_status' is distinct from 'pending' or item->>'checkout_link_method' is distinct from 'none' or
      item->>'link_version' is distinct from 'unlinked-v1' or
      item->'acquisition_eligible' is distinct from 'false'::jsonb
      then raise exception 'unproven inventory order'; end if;
    foreach t in array array['customer_id','checkout_id','paid_at','purchase_date','shipping_country','shipping_region',
      'checkout_session_key','evidence_ref','purchase_merchandise_gross_usd','purchase_discount_usd','purchase_merchandise_net_usd'] loop
      if item->t is distinct from 'null'::jsonb then raise exception 'inventory order field must be unknown'; end if;
    end loop;
    for item in select value from jsonb_array_elements(facts->'order_items') loop
      select value into line from jsonb_array_elements(o->'lines')
        where substring(value->>'id' from '[0-9]+$')=item->>'source_line_id' and (value->>'quantity')::numeric>0;
      if not found or item->>'order_id' is distinct from expected or
        item->>'order_item_id' is distinct from encode(sha256(convert_to(replace(jsonb_build_array(r.scope->>'shop',
          substring(result->>'sourceOrderId' from '[0-9]+$'),item->>'source_line_id')::text,', ',','),'UTF8')),'hex') or
        (item->>'quantity')::numeric is distinct from (line->>'quantity')::numeric or
        item->'sku' is distinct from 'null'::jsonb or item->>'item_class' is distinct from 'unknown' or
        item->'purchase_value_complete' is distinct from 'false'::jsonb or
        item->'product_id' is distinct from (case when line->'product'='null'::jsonb then 'null'::jsonb else
          to_jsonb(encode(sha256(convert_to(replace(jsonb_build_array(r.scope->>'shop',
            substring(line#>>'{product,id}' from '[0-9]+$'))::text,', ',','),'UTF8')),'hex')) end)
        then raise exception 'unproven inventory item'; end if;
      foreach t in array array['unit_price_usd','purchase_gross_usd','purchase_discount_usd','purchase_net_usd',
        'unit_cost_usd','cost_evidence_ref'] loop
        if item->t is distinct from 'null'::jsonb then raise exception 'inventory item value must be unknown'; end if;
      end loop;
    end loop;
    foreach t in array array['orders','order_items'] loop
      if exists(select 1 from jsonb_array_elements(facts->t) x where x->>'publication_id' is distinct from pub or
        x->>'source_currency' is distinct from o#>>'{original,currencyCode}' or x->>'report_currency' is distinct from 'USD')
        then raise exception 'mixed inventory facts'; end if;
      execute format('insert into lean_private.%I select * from jsonb_populate_recordset(null::lean_private.%I,$1)',t,t) using facts->t;
    end loop;
    insert into lean_private.history_report_sources(run_id,order_id,outcome,result_hash)
      values(p_run,result->>'sourceOrderId','inventory_pending',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
    v_source_lines:=v_source_lines+(o->>'lineCount')::integer;v_canonical_lines:=v_canonical_lines+n;
  end loop;
  update lean_private.history_inventory_batches set completed_at=clock_timestamp(),result_hash=h,
    counts=jsonb_build_object('orders',cardinality(b.ids),'sourceLines',v_source_lines,'canonicalLines',v_canonical_lines,
      'withheldLines',v_source_lines-v_canonical_lines)
    where run_id=p_run and batch_no=p_batch;
  -- Compact per-order coverage, no copied source packet or artificial errors.
  update lean_private.history_inventory_batches set counts=counts||jsonb_build_object('ordersCoverage',
    (select jsonb_agg(x-'facts') from jsonb_array_elements(p_results) x)) where run_id=p_run and batch_no=p_batch;
  update lean_private.history_report_jobs set cursor_id=b.ids[cardinality(b.ids)],
    processed=processed+cardinality(b.ids),unresolved=unresolved+cardinality(b.ids) where run_id=p_run returning * into r;
  if not exists(select 1 from lean_private.history_import_orders where job_id=r.source_job and id>r.cursor_id) then
    if r.processed<>(select orders from lean_private.history_import_jobs where job_id=r.source_job)
      then raise exception 'inventory completion count'; end if;
    if (select source_lines from lean_private.history_inventory_runs where run_id=p_run)+v_source_lines <>
      (select lines from lean_private.history_import_jobs where job_id=r.source_job)
      then raise exception 'inventory complete source line count'; end if;
    update lean_private.history_inventory_runs set complete=true where run_id=p_run;
  end if;
  update lean_private.history_inventory_runs set source_lines=source_lines+v_source_lines,
    canonical_lines=canonical_lines+v_canonical_lines where run_id=p_run;
  if b.lease_until<=clock_timestamp() or r.expires_at<=clock_timestamp()
    then raise exception 'inventory postwrite fence'; end if;
  return true;
end $$;
revoke all on function lean_private.history_inventory_no_hydration(),
  lean_private.history_inventory_order(lean_private.history_report_jobs,text),
  lean_private.history_inventory_input(lean_private.history_report_jobs,text[]) from public,anon,authenticated,service_role;
revoke all on function public.lean_history_inventory_claim(text,text,uuid),
  public.lean_history_inventory_finish(text,text,uuid,integer,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.lean_history_inventory_claim(text,text,uuid),
  public.lean_history_inventory_finish(text,text,uuid,integer,text,jsonb) to service_role;
commit;
