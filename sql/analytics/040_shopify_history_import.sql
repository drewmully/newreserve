-- Private SOURCE staging only. No policy/ledger/report, job, enablement or schedule.
-- Independent of 025–037; apply after installed 001–024 + 038/039.
begin;
create table lean_private.history_import_jobs (
  job_id text primary key check(job_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  scope jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  enabled boolean not null default false,
  state text not null default 'registered' check(state in
    ('registered','submitting','submitted','running','ready','importing','complete','blocked','purged')),
  operation_id text unique check(operation_id ~ '^gid://shopify/BulkOperation/[1-9][0-9]*$'),
  operation jsonb,
  token uuid, lease_until timestamptz,
  checks integer not null default 0 check(checks between 0 and 30),
  imports integer not null default 0 check(imports between 0 and 3),
  provider_requests integer not null default 0 check(provider_requests between 0 and 64),
  reserved_download_bytes bigint not null default 0 check(reserved_download_bytes between 0 and 268435456),
  orders integer not null default 0 check(orders between 0 and 70000),
  lines integer not null default 0 check(lines between 0 and 1000000),
  completion jsonb
);
create table lean_private.history_import_orders (
  job_id text not null references lean_private.history_import_jobs,
  id text not null, source jsonb not null,
  primary key(job_id,id)
);
create table lean_private.history_import_lines (
  job_id text not null references lean_private.history_import_jobs,
  id text not null, parent_id text not null, source jsonb not null,
  primary key(job_id,id)
);
create index history_import_parent on lean_private.history_import_lines(job_id,parent_id);
alter table lean_private.history_import_jobs enable row level security;
alter table lean_private.history_import_orders enable row level security;
alter table lean_private.history_import_lines enable row level security;
revoke all on lean_private.history_import_jobs,lean_private.history_import_orders,lean_private.history_import_lines
  from public,anon,authenticated,service_role;

create function lean_private.history_import_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if new.job_id<>old.job_id or new.scope<>old.scope or new.created_at<>old.created_at or new.expires_at<>old.expires_at
    then raise exception 'history import scope immutable'; end if;
  return new;
end $$;
create trigger immutable_history_import before update on lean_private.history_import_jobs
  for each row execute function lean_private.history_import_immutable();

create function public.lean_history_import_register(p_scope jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare expiry timestamptz; purge timestamptz;
begin
  if jsonb_typeof(p_scope) is distinct from 'object' or
    p_scope-array['jobId','projectRef','shop','appId','installationId','apiVersion','untilTime','queryText','queryHash',
      'expectedOrders','expiresAt','purgeAfter','approvalRef','actorRef']<>'{}'::jsonb or
    p_scope->>'projectRef' is distinct from 'xeqlgxvrhgwwudyqtnun' or
    p_scope->>'shop' is distinct from 'mullybox-store.myshopify.com' or
    p_scope->>'appId' is distinct from 'gid://shopify/App/280048107521' or
    p_scope->>'installationId' is distinct from 'gid://shopify/AppInstallation/616186609856' or
    p_scope->>'apiVersion' is distinct from '2026-07' or
    p_scope->>'untilTime' is distinct from '2026-09-25T08:04:00Z' or
    p_scope->>'queryHash' is distinct from '57e711044840787e7cbf0a5ac51591329ae1091bebb73f9b3607048468438145' or
    encode(sha256(convert_to(p_scope->>'queryText','UTF8')),'hex') is distinct from p_scope->>'queryHash' or
    coalesce(p_scope->>'expectedOrders','') !~ '^[0-9]{1,5}$' or
    (p_scope->>'expectedOrders')::integer not between 0 and 70000 or
    coalesce(trim(p_scope->>'approvalRef'),'')='' or coalesce(trim(p_scope->>'actorRef'),'')=''
    then raise exception 'invalid history import scope'; end if;
  expiry:=(p_scope->>'expiresAt')::timestamptz; purge:=(p_scope->>'purgeAfter')::timestamptz;
  if expiry is null or not isfinite(expiry) or expiry<=clock_timestamp() or expiry>clock_timestamp()+interval '24 hours' or
    purge is null or not isfinite(purge) or purge<expiry or purge>expiry+interval '24 hours'
    then raise exception 'invalid history import expiry'; end if;
  insert into lean_private.history_import_jobs(job_id,scope,expires_at) values(p_scope->>'jobId',p_scope,expiry);
  return true;
end $$;
revoke all on function public.lean_history_import_register(jsonb) from public,anon,authenticated,service_role;

-- Lock the single immutable manifest for every state transition/batch/finish.
create function lean_private.history_import_lock(p_job text,p_project text,p_shop text)
returns lean_private.history_import_jobs language plpgsql set search_path=pg_catalog as $$
declare j lean_private.history_import_jobs;
begin
  select * into j from lean_private.history_import_jobs where job_id=p_job for update;
  if not found or j.scope->>'projectRef' is distinct from p_project or j.scope->>'shop' is distinct from p_shop
    then raise exception 'unapproved history import'; end if;
  if not j.enabled or j.expires_at<=clock_timestamp() or j.state in ('blocked','purged')
    then raise exception 'history import unavailable'; end if;
  return j;
end $$;
create function lean_private.history_import_live(j lean_private.history_import_jobs,p_token uuid) returns void
language plpgsql set search_path=pg_catalog as $$
begin
  if p_token is null or j.token is distinct from p_token or j.lease_until is null or
    j.lease_until<=clock_timestamp() or j.expires_at<=clock_timestamp()
    then raise exception 'history import fence expired'; end if;
end $$;

create function public.lean_history_import_claim(p_job text,p_project text,p_shop text,p_mode text,p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j lean_private.history_import_jobs; calls integer; bytes bigint:=0;
begin
  j:=lean_private.history_import_lock(p_job,p_project,p_shop);
  if j.state='complete' then return jsonb_build_object('state','complete','completion',j.completion); end if;
  if p_token is null or p_mode not in ('start','check','import') then raise exception 'invalid history action'; end if;
  if j.lease_until>clock_timestamp() then raise exception 'history import busy'; end if;
  if p_mode='start' then
    if j.state<>'registered' or j.operation_id is not null then raise exception 'start uncertain or already submitted'; end if;
    calls:=2; j.state:='submitting';
  elsif p_mode='check' then
    if j.operation_id is null or j.state not in ('submitted','running','ready') or j.checks>=30
      then raise exception 'history check unavailable'; end if;
    calls:=1; j.checks:=j.checks+1;
  else
    if j.operation_id is null or j.state not in ('ready','importing') or j.imports>=3 or
      j.operation->>'status' is distinct from 'COMPLETED' then raise exception 'history import not ready'; end if;
    bytes:=(j.operation->>'fileSize')::bigint;
    if bytes is null or bytes<0 or j.reserved_download_bytes+bytes>268435456 then raise exception 'history download budget'; end if;
    calls:=3; j.imports:=j.imports+1; j.state:='importing';
  end if;
  if j.provider_requests+calls>64 then raise exception 'history provider budget'; end if;
  update lean_private.history_import_jobs set state=j.state,checks=j.checks,imports=j.imports,
    provider_requests=provider_requests+calls,reserved_download_bytes=reserved_download_bytes+bytes,
    token=p_token,lease_until=least(expires_at,clock_timestamp()+interval '10 minutes')
    where job_id=p_job returning * into j;
  perform lean_private.history_import_live(j,p_token);
  return jsonb_build_object('state',j.state,'scope',j.scope,'operationId',j.operation_id,'operation',j.operation,
    'leaseUntil',j.lease_until,'providerRequestsReserved',j.provider_requests);
end $$;

create function public.lean_history_import_bind(p_job text,p_project text,p_shop text,p_token uuid,p_operation text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j lean_private.history_import_jobs;
begin
  j:=lean_private.history_import_lock(p_job,p_project,p_shop); perform lean_private.history_import_live(j,p_token);
  if j.state<>'submitting' or j.operation_id is not null or p_operation is null or
    p_operation !~ '^gid://shopify/BulkOperation/[1-9][0-9]*$' then raise exception 'invalid history operation binding'; end if;
  update lean_private.history_import_jobs set operation_id=p_operation,state='submitted',token=null,lease_until=null where job_id=p_job;
  perform lean_private.history_import_live(j,p_token);
  return true;
end $$;

create function public.lean_history_import_observe(p_job text,p_project text,p_shop text,p_token uuid,p_operation jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j lean_private.history_import_jobs; next_state text;
begin
  j:=lean_private.history_import_lock(p_job,p_project,p_shop); perform lean_private.history_import_live(j,p_token);
  if jsonb_typeof(p_operation) is distinct from 'object' or
    p_operation-array['id','status','queryHash','rootObjectCount','objectCount','fileSize','createdAt','completedAt']<>'{}'::jsonb or
    p_operation->>'id' is distinct from j.operation_id or p_operation->>'queryHash' is distinct from j.scope->>'queryHash' or
    j.state not in ('submitted','running','ready') then raise exception 'history operation mismatch'; end if;
  next_state:=case p_operation->>'status' when 'COMPLETED' then 'ready' when 'CREATED' then 'running'
    when 'RUNNING' then 'running' when 'FAILED' then 'blocked' when 'CANCELED' then 'blocked' when 'EXPIRED' then 'blocked' end;
  if next_state is null then raise exception 'unrecognized operation status'; end if;
  if next_state='ready' and (
    coalesce(p_operation->>'rootObjectCount','') !~ '^[0-9]+$' or
    coalesce(p_operation->>'objectCount','') !~ '^[0-9]+$' or coalesce(p_operation->>'fileSize','') !~ '^[0-9]+$' or
    (p_operation->>'rootObjectCount')::bigint<>(j.scope->>'expectedOrders')::bigint or
    (p_operation->>'objectCount')::bigint<(p_operation->>'rootObjectCount')::bigint or
    (p_operation->>'objectCount')::bigint-(p_operation->>'rootObjectCount')::bigint>1000000 or
    (p_operation->>'fileSize')::bigint>268435456 or p_operation->>'completedAt' is null
  ) then raise exception 'history operation bounds'; end if;
  update lean_private.history_import_jobs set operation=p_operation,state=next_state,token=null,lease_until=null where job_id=p_job;
  perform lean_private.history_import_live(j,p_token);
  return true;
end $$;

-- Defense-in-depth projection check even for an authenticated runtime caller.
create function lean_private.history_import_shape(s jsonb,k text) returns void
language plpgsql set search_path=pg_catalog as $$
declare names text[]; field text; m jsonb; r jsonb;
begin
  if k='order' then
    names:=array['__typename','id','createdAt','updatedAt','processedAt','cancelledAt','test','edited','taxesIncluded',
      'currencyCode','displayFinancialStatus','totalPriceSet','currentTotalPriceSet','subtotalPriceSet','totalTaxSet',
      'totalDiscountsSet','totalRefundedSet','refunds'];
    if s->>'__typename' is distinct from 'Order' or coalesce(s->>'id','') !~ '^gid://shopify/Order/[1-9][0-9]*$' or
      s->>'createdAt' is null or not isfinite((s->>'createdAt')::timestamptz) or
      (s->>'createdAt')::timestamptz>='2026-09-25T08:04:00Z'::timestamptz or
      s->>'updatedAt' is null or not isfinite((s->>'updatedAt')::timestamptz) or
      (s->>'updatedAt')::timestamptz<(s->>'createdAt')::timestamptz or
      coalesce(s->>'currencyCode','') !~ '^[A-Z]{3}$' or
      (s->'displayFinancialStatus' is distinct from 'null'::jsonb and coalesce(s->>'displayFinancialStatus','') !~ '^[A-Z_]{1,40}$') or
      jsonb_typeof(s->'refunds') is distinct from 'array'
      then raise exception 'invalid import order'; end if;
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
  elsif k='line' then
    names:=array['__typename','__parentId','id','quantity','currentQuantity','isGiftCard','requiresShipping','taxable',
      'product','variant','originalTotalSet','originalUnitPriceSet','totalDiscountSet'];
    if s->>'__typename' is distinct from 'LineItem' or coalesce(s->>'id','') !~ '^gid://shopify/LineItem/[1-9][0-9]*$' or
      coalesce(s->>'__parentId','') !~ '^gid://shopify/Order/[1-9][0-9]*$' then raise exception 'invalid import line'; end if;
    foreach field in array array['quantity','currentQuantity'] loop
      if coalesce(s->>field,'') !~ '^[0-9]{1,10}$' or (s->>field)::bigint>1000000000 then raise exception 'invalid source quantity'; end if;
    end loop;
    foreach field in array array['isGiftCard','requiresShipping','taxable'] loop
      if jsonb_typeof(s->field) is distinct from 'boolean' then raise exception 'invalid source flag'; end if;
    end loop;
    foreach field in array array['product','variant'] loop
      if s->field is distinct from 'null'::jsonb and (jsonb_typeof(s->field) is distinct from 'object' or
        (s->field)-'id'<>'{}'::jsonb or coalesce(s#>>array[field,'id'],'') !~
        case when field='product' then '^gid://shopify/Product/[1-9][0-9]*$' else '^gid://shopify/ProductVariant/[1-9][0-9]*$' end)
        then raise exception 'invalid source product'; end if;
    end loop;
  elsif k='money' then names:=array['money'];
  else raise exception 'invalid source kind';
  end if;
  if jsonb_typeof(s) is distinct from 'object' or s-names<>'{}'::jsonb or not s ?& names
    then raise exception 'unapproved source projection'; end if;
  foreach field in array names loop
    if field='money' or field like '%Set' then
      m:=s->field;
      if m='null'::jsonb and field=any(array['subtotalPriceSet','totalTaxSet','totalDiscountsSet']) then continue; end if;
      if jsonb_typeof(m) is distinct from 'object' or m-'shopMoney'<>'{}'::jsonb or
        jsonb_typeof(m->'shopMoney') is distinct from 'object' or (m->'shopMoney')-array['amount','currencyCode']<>'{}'::jsonb or
        coalesce(m#>>'{shopMoney,amount}','') !~ '^-?[0-9]{1,24}([.][0-9]{1,12})?$' or
        coalesce(m#>>'{shopMoney,currencyCode}','') !~ '^[A-Z]{3}$' then raise exception 'invalid source money'; end if;
    end if;
  end loop;
end $$;

create function public.lean_history_import_batch(p_job text,p_project text,p_shop text,p_token uuid,p_rows jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j lean_private.history_import_jobs; r jsonb; s jsonb; prior jsonb; n integer; orders_added integer:=0; lines_added integer:=0;
begin
  j:=lean_private.history_import_lock(p_job,p_project,p_shop); perform lean_private.history_import_live(j,p_token);
  if j.state<>'importing' or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 250 or
    octet_length(p_rows::text)>2000000 then raise exception 'invalid history batch'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r) is distinct from 'object' or r-array['kind','source']<>'{}'::jsonb
      then raise exception 'invalid history record'; end if;
    s:=r->'source'; perform lean_private.history_import_shape(s,r->>'kind');
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
  return true;
end $$;

create function public.lean_history_import_finish(p_job text,p_project text,p_shop text,p_token uuid,p_evidence jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j lean_private.history_import_jobs; actual_orders bigint; actual_lines bigint;
begin
  j:=lean_private.history_import_lock(p_job,p_project,p_shop);
  if j.state='complete' then
    if j.completion is distinct from p_evidence then raise exception 'completion replay mismatch'; end if;
    return true;
  end if;
  perform lean_private.history_import_live(j,p_token);
  if j.state<>'importing' or jsonb_typeof(p_evidence) is distinct from 'object' or
    p_evidence-array['orders','lines','bytes','sha256','beforeCount','afterCount','eof','operationId','queryHash']<>'{}'::jsonb or
    not p_evidence ?& array['orders','lines','bytes','sha256','beforeCount','afterCount','eof','operationId','queryHash'] or
    p_evidence->'eof' is distinct from 'true'::jsonb or
    p_evidence->>'operationId' is distinct from j.operation_id or p_evidence->>'queryHash' is distinct from j.scope->>'queryHash' or
    coalesce(p_evidence->>'sha256','') !~ '^[a-f0-9]{64}$' or
    (p_evidence->>'beforeCount')::integer is distinct from (j.scope->>'expectedOrders')::integer or
    (p_evidence->>'afterCount')::integer is distinct from (j.scope->>'expectedOrders')::integer or
    (p_evidence->>'bytes')::bigint is distinct from (j.operation->>'fileSize')::bigint or
    j.operation->>'status' is distinct from 'COMPLETED'
    then raise exception 'incomplete history evidence'; end if;
  select count(*) into actual_orders from lean_private.history_import_orders where job_id=p_job;
  select count(*) into actual_lines from lean_private.history_import_lines where job_id=p_job;
  if actual_orders<>j.orders or actual_lines<>j.lines or
    actual_orders is distinct from (p_evidence->>'orders')::bigint or actual_lines is distinct from (p_evidence->>'lines')::bigint or
    actual_orders is distinct from (j.operation->>'rootObjectCount')::bigint or
    actual_orders is distinct from (j.scope->>'expectedOrders')::bigint or
    actual_orders+actual_lines is distinct from (j.operation->>'objectCount')::bigint or exists(
      select 1 from lean_private.history_import_lines l left join lean_private.history_import_orders o
        on o.job_id=l.job_id and o.id=l.parent_id where l.job_id=p_job and o.id is null
    ) then raise exception 'history inventory incomplete'; end if;
  update lean_private.history_import_jobs set state='complete',completion=p_evidence,token=null,lease_until=null where job_id=p_job;
  perform lean_private.history_import_live(j,p_token);
  return true;
end $$;

-- Owner-only retention cleanup; no runtime authority to erase evidence.
create function public.lean_history_import_purge(p_job text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare j lean_private.history_import_jobs;
begin
  select * into strict j from lean_private.history_import_jobs where job_id=p_job for update;
  if clock_timestamp()<(j.scope->>'purgeAfter')::timestamptz then raise exception 'retention period not reached'; end if;
  delete from lean_private.history_import_lines where job_id=p_job;
  delete from lean_private.history_import_orders where job_id=p_job;
  update lean_private.history_import_jobs set state='purged',enabled=false,token=null,lease_until=null where job_id=p_job;
  return true;
end $$;
revoke all on function public.lean_history_import_purge(text),
  lean_private.history_import_immutable(),lean_private.history_import_lock(text,text,text),
  lean_private.history_import_live(lean_private.history_import_jobs,uuid),lean_private.history_import_shape(jsonb,text)
  from public,anon,authenticated,service_role;
revoke all on function public.lean_history_import_claim(text,text,text,text,uuid),
  public.lean_history_import_bind(text,text,text,uuid,text),public.lean_history_import_observe(text,text,text,uuid,jsonb),
  public.lean_history_import_batch(text,text,text,uuid,jsonb),public.lean_history_import_finish(text,text,text,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.lean_history_import_claim(text,text,text,text,uuid),
  public.lean_history_import_bind(text,text,text,uuid,text),public.lean_history_import_observe(text,text,text,uuid,jsonb),
  public.lean_history_import_batch(text,text,text,uuid,jsonb),public.lean_history_import_finish(text,text,text,uuid,jsonb)
  to service_role;
commit;
