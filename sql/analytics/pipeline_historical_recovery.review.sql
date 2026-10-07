-- PRIVATE REVIEW ONLY. Additive, owner-only, no enabled permits on install.
-- Requires the separately reviewed ingestion amendment. No queue or runtime hook.
begin;
create table lean_private.pipeline_recovery_permits (
  operation_id uuid primary key,
  original_work_id bigint not null references lean_private.work,
  binding jsonb not null,
  output_sha256 text not null check(output_sha256 ~ '^[a-f0-9]{64}$'),
  approval_ref text not null check(length(trim(approval_ref)) between 1 and 500),
  actor_ref text not null check(length(trim(actor_ref)) between 1 and 200),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);
create table lean_private.pipeline_recovery_revocations (
  operation_id uuid primary key references lean_private.pipeline_recovery_permits,
  approval_ref text not null check(length(trim(approval_ref)) between 1 and 500),
  actor_ref text not null check(length(trim(actor_ref)) between 1 and 200),
  created_at timestamptz not null default clock_timestamp()
);
create table lean_private.pipeline_recovery_completions (
  operation_id uuid primary key references lean_private.pipeline_recovery_permits,
  original_work_id bigint not null unique references lean_private.work,
  recovery_work_id bigint not null unique references lean_private.work,
  publication_id text not null unique references lean_private.publications,
  shop text not null, order_gid text not null, revision timestamptz not null,
  source_sha256 text not null, binding jsonb not null, output_sha256 text not null,
  completed_at timestamptz not null default clock_timestamp(),
  unique(shop,order_gid,revision)
);
create function lean_private.pipeline_recovery_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin raise exception 'recovery evidence immutable'; end $$;
do $tables$
declare t text;
begin
  foreach t in array array['pipeline_recovery_permits','pipeline_recovery_revocations','pipeline_recovery_completions'] loop
    execute format('alter table lean_private.%I enable row level security',t);
    execute format('create trigger immutable_recovery before update or delete on lean_private.%I
      for each row execute function lean_private.pipeline_recovery_immutable()',t);
    execute format('create trigger no_truncate_recovery before truncate on lean_private.%I
      for each statement execute function lean_private.pipeline_recovery_immutable()',t);
  end loop;
end $tables$;

-- Hash PostgreSQL JSONB text, not JSON.stringify. No source/payload is exported.
-- Exact definitions bind completion dependencies as well as retained input.
create function lean_private.pipeline_recovery_binding(p_work_id bigint)
returns jsonb language sql stable set search_path=pg_catalog set timezone='UTC' as $$
  select jsonb_build_object(
    'work',encode(sha256(convert_to(to_jsonb(w)::text,'UTF8')),'hex'),
    'receipt',encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),
    'snapshot',encode(sha256(convert_to((to_jsonb(s)-'source')::text,'UTF8')),'hex'),
    'source',encode(sha256(convert_to(s.source::text,'UTF8')),'hex'),
    'scope',encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex'),
    'admission',encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex'),
    'head',encode(sha256(convert_to(coalesce(to_jsonb(h),'null'::jsonb)::text,'UTF8')),'hex'),
    'dependencies',(select jsonb_object_agg(p.oid::regprocedure::text,
      encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') order by p.oid::regprocedure::text)
      from pg_proc p where p.oid in (
        'public.lean_pipeline_finish(bigint,uuid,jsonb,jsonb)'::regprocedure,
        'public.lean_pipeline_finish_extended(bigint,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure,
        'public.lean_pipeline_finish_amended(bigint,uuid,integer,jsonb,jsonb,jsonb,jsonb)'::regprocedure,
        'lean_private.pipeline_ingestion_context(lean_private.pipeline_snapshots,lean_private.pipeline_scope)'::regprocedure)))
  from lean_private.work w join lean_private.receipts r using(receipt_id)
    join lean_private.pipeline_snapshots s using(work_id)
    join lean_private.pipeline_scope c on c.shop=s.shop
    cross join lean_private.pipeline_ingestion_amendment a
    left join lean_private.pipeline_heads h on h.shop=s.shop and h.order_gid=s.order_gid
  where w.work_id=p_work_id;
$$;

-- Only an owner can enter. Scope UPDATE serializes against every normal finish.
-- Table SHARE freezes retained-source conflicts while we validate/materialize.
create function lean_private.pipeline_recovery_check(p_work_id bigint)
returns jsonb language plpgsql set search_path=pg_catalog set timezone='UTC' as $$
declare w lean_private.work; s lean_private.pipeline_snapshots; r lean_private.receipts;
  c lean_private.pipeline_scope; a lean_private.pipeline_ingestion_amendment; t text; has_effect boolean;
begin
  if current_user<>session_user or current_user::regrole::oid<>
    (select relowner from pg_class where oid='lean_private.pipeline_recovery_permits'::regclass)
    or current_setting('transaction_isolation')<>'read committed'
    then raise exception 'recovery owner context'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('pipeline_zero_total_exception:xnfjdbpjuaezxjgargto',0));
  select * into strict a from lean_private.pipeline_ingestion_amendment for share;
  select * into strict c from lean_private.pipeline_scope
    where project_ref='xnfjdbpjuaezxjgargto' and shop='mullybox-store.myshopify.com' for update;
  select * into strict w from lean_private.work where work_id=p_work_id for update;
  if w.state<>'dead' or w.attempts<>5 or w.last_error_code is distinct from 'mapping_rejected'
    or w.lease_token is not null or w.lease_until is not null or w.completed_at is not null
    then raise exception 'recovery terminal work unavailable'; end if;
  lock table lean_private.pipeline_snapshots in share mode;
  select * into strict s from lean_private.pipeline_snapshots where work_id=p_work_id;
  select * into strict r from lean_private.receipts where receipt_id=w.receipt_id for share;
  if not a.enabled or not lean_private.pipeline_ingestion_scope(c)
    or lean_private.pipeline_ingestion_context(s,c) is null
    or s.source is null or s.order_gid is null or s.revision is null
    or r.source<>'shopify' or r.topic not in ('orders/paid','orders/updated','refunds/create')
    or lean_private.receipt_shop(r.business_key) is distinct from c.shop
    or s.source#>>'{commerce,order,id}' is distinct from s.order_gid
    or (s.source#>>'{commerce,order,updatedAt}')::timestamptz is distinct from s.revision
    or (s.source#>>'{commerce,order,originalTotalPriceSet,shopMoney,amount}')::numeric is not distinct from 0
    or s.source#>>'{commerce,order,originalTotalPriceSet,shopMoney,amount}' is null
    then raise exception 'recovery source or admission unavailable'; end if;
  -- Candidate publication must be empty in every established materialization sink.
  perform 1 from lean_private.publications where publication_id=s.publication_id and state='candidate' for share;
  if not found then raise exception 'recovery publication unavailable'; end if;
  foreach t in array array['orders','order_items','order_item_sizes','sales_ledger','payments',
    'report_store_daily','report_product_daily','selected_publications','certifications'] loop
    execute format('select exists(select 1 from lean_private.%I where publication_id=$1)',t)
      into has_effect using s.publication_id;
    if has_effect then raise exception 'recovery existing materialization'; end if;
  end loop;
  if exists(select 1 from lean_private.projections where receipt_id=r.receipt_id)
    or exists(select 1 from lean_private.pipeline_ingestion_completions where work_id=w.work_id)
    or exists(select 1 from lean_private.pipeline_heads where work_id=w.work_id)
    or exists(select 1 from lean_private.pipeline_recovery_completions
      where original_work_id=w.work_id or shop=s.shop and order_gid=s.order_gid and revision=s.revision)
    then raise exception 'recovery already materialized'; end if;
  if exists(select 1 from lean_private.pipeline_heads h
      where h.shop=s.shop and h.order_gid=s.order_gid and h.revision>=s.revision)
    or exists(select 1 from lean_private.orders o where o.shop_id=s.shop
      and 'gid://shopify/Order/'||o.source_order_id=s.order_gid and o.source_updated_at>=s.revision)
    then raise exception 'recovery equal or newer materialization'; end if;
  if exists(select 1 from lean_private.pipeline_snapshots x where x.shop=s.shop
      and x.order_gid=s.order_gid and x.revision=s.revision and x.source is distinct from s.source)
    then raise exception 'recovery conflicting retained source'; end if;
  return lean_private.pipeline_recovery_binding(p_work_id);
end $$;

create function lean_private.authorize_pipeline_recovery(
  p_operation_id uuid,p_work_id bigint,p_expected jsonb,p_output_sha256 text,
  p_approval_ref text,p_actor_ref text,p_deadline timestamptz,p_enable boolean default false)
returns uuid language plpgsql set search_path=pg_catalog set timezone='UTC' as $$
declare binding jsonb;
begin
  if p_enable is distinct from true or p_operation_id is null or p_expected is null
    or p_deadline is null or not isfinite(p_deadline) or p_deadline<=clock_timestamp()
    or p_deadline>clock_timestamp()+interval '15 minutes'
    then raise exception 'recovery authorization unbound'; end if;
  binding:=lean_private.pipeline_recovery_check(p_work_id);
  if binding is null or binding is distinct from p_expected then raise exception 'recovery binding CAS'; end if;
  insert into lean_private.pipeline_recovery_permits
    (operation_id,original_work_id,binding,output_sha256,approval_ref,actor_ref,expires_at)
    values(p_operation_id,p_work_id,binding,p_output_sha256,p_approval_ref,p_actor_ref,p_deadline);
  insert into lean_private.pipeline_operator_audit(event,work_id,previous_state,approval_ref,actor_ref)
    values('historical_recovery_authorized',p_work_id,jsonb_build_object('operation',p_operation_id,
      'binding',binding,'outputSha256',p_output_sha256,'deadline',p_deadline),p_approval_ref,p_actor_ref);
  if clock_timestamp()>=p_deadline then raise exception 'recovery authorization deadline'; end if;
  return p_operation_id;
end $$;

create function lean_private.revoke_pipeline_recovery(p_operation_id uuid,p_approval_ref text,p_actor_ref text)
returns void language plpgsql set search_path=pg_catalog as $$
begin
  if current_user<>session_user or current_user::regrole::oid<>
    (select relowner from pg_class where oid='lean_private.pipeline_recovery_permits'::regclass)
    then raise exception 'recovery owner context'; end if;
  perform 1 from lean_private.pipeline_recovery_permits where operation_id=p_operation_id for update;
  if not found then raise exception 'recovery permit missing'; end if;
  insert into lean_private.pipeline_recovery_revocations(operation_id,approval_ref,actor_ref)
    values(p_operation_id,p_approval_ref,p_actor_ref);
end $$;

create function lean_private.complete_pipeline_recovery(p_operation_id uuid,p_output jsonb)
returns bigint language plpgsql set search_path=pg_catalog set timezone='UTC' as $$
declare permit lean_private.pipeline_recovery_permits; binding jsonb; s lean_private.pipeline_snapshots;
  receipt bigint; work bigint; pub text; token uuid:=gen_random_uuid(); amendment integer; digest text;
begin
  -- Same admission/scope/work order as authorize and amended finish. Read permit
  -- without locking only to obtain the original identity, then re-read locked.
  select * into strict permit from lean_private.pipeline_recovery_permits where operation_id=p_operation_id;
  binding:=lean_private.pipeline_recovery_check(permit.original_work_id);
  select * into strict permit from lean_private.pipeline_recovery_permits where operation_id=p_operation_id for update;
  if exists(select 1 from lean_private.pipeline_recovery_revocations where operation_id=p_operation_id)
    or clock_timestamp()>=permit.expires_at then raise exception 'recovery permit revoked or expired'; end if;
  if binding is null or binding is distinct from permit.binding then raise exception 'recovery binding CAS'; end if;
  digest:=encode(sha256(convert_to(p_output::text,'UTF8')),'hex');
  if digest is null or digest<>permit.output_sha256 then raise exception 'recovery output CAS'; end if;
  if jsonb_typeof(p_output) is distinct from 'object' or
    (select array_agg(k order by k) from jsonb_object_keys(p_output) k)
      is distinct from array['facts','orderItemSizes','productReports','reports']::text[]
    then raise exception 'recovery output shape'; end if;
  select * into strict s from lean_private.pipeline_snapshots where work_id=permit.original_work_id;
  select revision into strict amendment from lean_private.pipeline_ingestion_amendment;
  pub:='recovery:'||p_operation_id::text;
  -- This is internal recovery evidence, never a provider observation.
  insert into lean_private.receipts(source,delivery_id,business_key,topic,payload_hash,payload)
    values('internal_recovery',p_operation_id::text,jsonb_build_array(s.shop,s.order_gid)::text,
      'historical/recovery',permit.binding->>'source',
      jsonb_build_object('originalWorkId',permit.original_work_id,'operationId',p_operation_id))
    returning receipt_id into receipt;
  insert into lean_private.work(receipt_id,destination,state,attempts,lease_token,lease_until)
    values(receipt,'lean_warehouse','leased',1,token::text,least(permit.expires_at,clock_timestamp()+interval '120 seconds'))
    returning work_id into work;
  insert into lean_private.publications(publication_id,contract_version,evidence_ref)
    values(pub,'lean-v1-draft.1','lean_private.pipeline_recovery_permits/'||p_operation_id::text);
  insert into lean_private.pipeline_snapshots(work_id,shop,publication_id,policy,from_time,until_time,source,order_gid,revision)
    values(work,s.shop,pub,s.policy,s.from_time,s.until_time,s.source,s.order_gid,s.revision);
  if not public.lean_pipeline_finish_amended(work,token,amendment,p_output->'facts',p_output->'reports',
      p_output->'productReports',nullif(p_output->'orderItemSizes','null'::jsonb))
    then raise exception 'recovery completion refused'; end if;
  -- Failure here rolls back facts, head, amended provenance and all synthetic rows.
  insert into lean_private.pipeline_recovery_completions(operation_id,original_work_id,recovery_work_id,
    publication_id,shop,order_gid,revision,source_sha256,binding,output_sha256)
    values(p_operation_id,permit.original_work_id,work,pub,s.shop,s.order_gid,s.revision,
      binding->>'source',binding,digest);
  insert into lean_private.pipeline_operator_audit(event,work_id,previous_state,approval_ref,actor_ref)
    values('historical_recovery_completed',permit.original_work_id,jsonb_build_object(
      'operation',p_operation_id,'recoveryWorkId',work,'publication',pub,'binding',binding,'outputSha256',digest),
      permit.approval_ref,permit.actor_ref);
  if clock_timestamp()>=permit.expires_at then raise exception 'recovery operation deadline'; end if;
  return work;
end $$;

-- Revoke default ACL grants as well as PUBLIC. No hosted/service-role entry point.
do $acl$
declare obj record; recipient text;
begin
  for obj in select oid,oid::regclass::text as identity from pg_class
    where relnamespace='lean_private'::regnamespace and relname in
      ('pipeline_recovery_permits','pipeline_recovery_revocations','pipeline_recovery_completions') loop
    execute format('revoke all on table %s from public',obj.identity);
    for recipient in select distinct r.rolname from pg_class c cross join lateral aclexplode(c.relacl) a
      join pg_roles r on r.oid=a.grantee where c.oid=obj.oid and a.grantee<>c.relowner loop
      execute format('revoke all on table %s from %I',obj.identity,recipient);
    end loop;
  end loop;
  for obj in select oid,oid::regprocedure::text as identity from pg_proc
    where pronamespace='lean_private'::regnamespace and proname in
      ('pipeline_recovery_immutable','pipeline_recovery_binding','pipeline_recovery_check',
       'authorize_pipeline_recovery','revoke_pipeline_recovery','complete_pipeline_recovery') loop
    execute format('revoke all on function %s from public',obj.identity);
    for recipient in select distinct r.rolname from pg_proc p cross join lateral aclexplode(p.proacl) a
      join pg_roles r on r.oid=a.grantee where p.oid=obj.oid and a.grantee<>p.proowner loop
      execute format('revoke all on function %s from %I',obj.identity,recipient);
    end loop;
  end loop;
end $acl$;
commit;
