-- PRIVATE REVIEW ONLY. Install empty. No source, retry, grant or schedule action.
-- One explicitly approved historical revision, not a general zero-value policy.
begin;
-- Retained catalog414024 had only internal FK triggers on work. Refuse a
-- changed hook/rule footprint rather than assume a no-op has no side effects.
do $work_hooks$
begin
  if exists(select 1 from pg_trigger where tgrelid='lean_private.work'::regclass and not tgisinternal)
    or exists(select 1 from pg_rewrite where ev_class='lean_private.work'::regclass)
    then raise exception 'zero-total unexpected work hooks'; end if;
end $work_hooks$;
create table lean_private.pipeline_zero_total_exception (
  singleton boolean primary key default true check(singleton),
  work_id bigint not null unique references lean_private.work,
  scope_row_sha256 text not null check(scope_row_sha256 ~ '^[a-f0-9]{64}$'),
  work_row_sha256 text not null check(work_row_sha256 ~ '^[a-f0-9]{64}$'),
  receipt_row_sha256 text not null check(receipt_row_sha256 ~ '^[a-f0-9]{64}$'),
  source_sha256 text not null check(source_sha256='7df76771b2de58f8ae485e1bbbe17997a225609c09e8cc4941efa2f1598c4358'),
  snapshot_metadata_sha256 text not null check(snapshot_metadata_sha256='da013d66811726982d6099d1df5fc6d4c7b8f275d3302fe24e0ea012f5093070'),
  reason text not null default 'unresolved_fully_discounted_zero_total'
    check(reason='unresolved_fully_discounted_zero_total'),
  approval_ref text not null check(length(trim(approval_ref)) between 1 and 500),
  actor_ref text not null check(length(trim(actor_ref)) between 1 and 200),
  created_at timestamptz not null default clock_timestamp()
);
alter table lean_private.pipeline_zero_total_exception enable row level security;
revoke all on lean_private.pipeline_zero_total_exception from public,anon,authenticated,service_role;

create function lean_private.pipeline_zero_total_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin raise exception 'zero-total exception evidence immutable'; end $$;
create trigger immutable_zero_total_exception before update or delete
  on lean_private.pipeline_zero_total_exception for each row
  execute function lean_private.pipeline_zero_total_immutable();
create trigger no_truncate_zero_total_exception before truncate
  on lean_private.pipeline_zero_total_exception for each statement
  execute function lean_private.pipeline_zero_total_immutable();

-- Exact eight-field digest from held-work-read72d704 lines161-162: its
-- to_jsonb(snap) MINUS source_bytes/source_retained. Byte length is separate.
-- UTC is part of this contract, independent of the caller's session timezone.
create function lean_private.pipeline_zero_total_metadata(s lean_private.pipeline_snapshots)
returns jsonb language sql immutable set search_path=pg_catalog set timezone='UTC' as $$
  select jsonb_build_object('work_id',s.work_id,'shop',s.shop,'publication_id',s.publication_id,
    'policy',s.policy,'from_time',s.from_time,'until_time',s.until_time,'order_gid',s.order_gid,
    'revision',s.revision);
$$;

-- A new work/receipt, changed source/policy/attempt/state or scope never inherits
-- the exception. Unmatched records take the original claim path.
create function lean_private.pipeline_zero_total_matches(w lean_private.work,cfg lean_private.pipeline_scope)
returns boolean language sql stable set search_path=pg_catalog set timezone='UTC' as $$
  select exists(select 1 from lean_private.pipeline_zero_total_exception e
    join lean_private.pipeline_snapshots s on s.work_id=e.work_id
    join lean_private.receipts r on r.receipt_id=w.receipt_id
    where e.work_id=w.work_id and w.state='pending' and w.lease_token is null and w.lease_until is null
      and cfg.project_ref='xnfjdbpjuaezxjgargto' and cfg.shop='mullybox-store.myshopify.com'
      and e.scope_row_sha256=encode(sha256(convert_to(to_jsonb(cfg)::text,'UTF8')),'hex')
      and e.work_row_sha256=encode(sha256(convert_to(to_jsonb(w)::text,'UTF8')),'hex')
      and e.receipt_row_sha256=encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex')
      and e.snapshot_metadata_sha256=encode(sha256(convert_to(lean_private.pipeline_zero_total_metadata(s)::text,'UTF8')),'hex')
      and e.source_sha256=encode(sha256(convert_to(s.source::text,'UTF8')),'hex'));
$$;

-- Old compiled claim bodies do not take the new advisory lock. A VOLATILE
-- trigger query gets fresh RC visibility without taking an advisory lock while
-- already holding a work-row lock. Registration also advances the row version
-- so pre-existing RR/serializable snapshots cannot lease its older version.
create function lean_private.pipeline_zero_total_lease_fence() returns trigger
language plpgsql volatile set search_path=pg_catalog set timezone='UTC' as $$
declare cfg lean_private.pipeline_scope;
begin
  if old.state='pending' and new.state='leased' then
    select * into cfg from lean_private.pipeline_scope
      where project_ref='xnfjdbpjuaezxjgargto' and shop='mullybox-store.myshopify.com';
    if found and lean_private.pipeline_zero_total_matches(old,cfg)
      then raise exception 'zero-total registered revision cannot be leased'; end if;
  end if;
  return new;
end $$;
create trigger pipeline_zero_total_lease_fence before update of state on lean_private.work
  for each row execute function lean_private.pipeline_zero_total_lease_fence();

-- Owner-only, invoker-rights, one-shot registration. All three row digests must
-- come from a NEW approved metadata read, not last night's work/control receipt.
create function lean_private.register_pipeline_zero_total_exception(
  p_approval_ref text,p_actor_ref text,p_scope_row_sha256 text,p_work_row_sha256 text,
  p_receipt_row_sha256 text,p_deadline timestamptz)
returns boolean language plpgsql set search_path=pg_catalog set timezone='UTC' as $$
declare cfg lean_private.pipeline_scope; s lean_private.pipeline_snapshots;
  w lean_private.work; r lean_private.receipts; scope_hash text; target bigint;
begin
  if current_user<>session_user or current_user::regrole::oid<>
    (select relowner from pg_class where oid='lean_private.pipeline_zero_total_exception'::regclass)
    or current_setting('transaction_isolation')<>'read committed' then raise exception 'zero-total owner context'; end if;
  if p_approval_ref is null or length(trim(p_approval_ref)) not between 1 and 500
    or p_actor_ref is null or length(trim(p_actor_ref)) not between 1 and 200
    or p_scope_row_sha256 is null or p_scope_row_sha256 !~ '^[a-f0-9]{64}$'
    or p_work_row_sha256 is null or p_work_row_sha256 !~ '^[a-f0-9]{64}$'
    or p_receipt_row_sha256 is null or p_receipt_row_sha256 !~ '^[a-f0-9]{64}$'
    or p_deadline is null or not isfinite(p_deadline) or p_deadline<=clock_timestamp()
    or p_deadline>clock_timestamp()+interval '15 minutes' then raise exception 'zero-total operation unbound'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pipeline_zero_total_exception:xnfjdbpjuaezxjgargto',0));
  lock table lean_private.pipeline_zero_total_exception in exclusive mode;
  if exists(select 1 from lean_private.pipeline_zero_total_exception) then raise exception 'zero-total already registered'; end if;
  if (select count(*) from pg_trigger where tgrelid='lean_private.work'::regclass and not tgisinternal)<>1
    or not exists(select 1 from pg_trigger where tgrelid='lean_private.work'::regclass
      and tgname='pipeline_zero_total_lease_fence' and not tgisinternal and tgenabled='O'
      and tgfoid='lean_private.pipeline_zero_total_lease_fence()'::regprocedure and tgtype=19)
    or exists(select 1 from pg_rewrite where ev_class='lean_private.work'::regclass)
    then raise exception 'zero-total work fence footprint changed'; end if;
  select * into strict cfg from lean_private.pipeline_scope
    where shop='mullybox-store.myshopify.com' and project_ref='xnfjdbpjuaezxjgargto' for share;
  scope_hash:=encode(sha256(convert_to(jsonb_build_object('shop',cfg.shop,'project',cfg.project_ref,'policy',cfg.policy,
    'from',to_char(cfg.from_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'until',to_char(cfg.until_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'UTF8')),'hex');
  if not cfg.enabled or scope_hash<>'799209cbd0913f5257afaabefc478ec7e402640b4ac5c30e5f9ee81eeee30689'
    or encode(sha256(convert_to(to_jsonb(cfg)::text,'UTF8')),'hex')<>p_scope_row_sha256
    then raise exception 'zero-total scope CAS'; end if;
  if (select count(*) from (select 1 from lean_private.pipeline_snapshots limit 5001) bounded)>5000
    then raise exception 'zero-total snapshot cap'; end if;
  select s0.work_id into strict target from lean_private.pipeline_snapshots s0
    where encode(sha256(convert_to(lean_private.pipeline_zero_total_metadata(s0)::text,'UTF8')),'hex')=
      'da013d66811726982d6099d1df5fc6d4c7b8f275d3302fe24e0ea012f5093070';
  -- Same work-first lock order as retain/finish. A racing claim wins or loses
  -- this lock; stale CAS/leased state refuses, never clears the other caller.
  select * into strict w from lean_private.work where work_id=target for update;
  select * into strict s from lean_private.pipeline_snapshots where work_id=target for share;
  select * into strict r from lean_private.receipts where receipt_id=w.receipt_id for share;
  if w.state<>'pending' or w.attempts<1 or w.attempts>=5 or w.last_error_code is distinct from 'mapping_rejected'
    or w.lease_token is not null or w.lease_until is not null or w.completed_at is not null
    or encode(sha256(convert_to(to_jsonb(w)::text,'UTF8')),'hex')<>p_work_row_sha256
    or encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex')<>p_receipt_row_sha256
    then raise exception 'zero-total work or receipt CAS'; end if;
  if encode(sha256(convert_to(lean_private.pipeline_zero_total_metadata(s)::text,'UTF8')),'hex')<>
      'da013d66811726982d6099d1df5fc6d4c7b8f275d3302fe24e0ea012f5093070'
    or encode(sha256(convert_to(s.source::text,'UTF8')),'hex') is distinct from
      '7df76771b2de58f8ae485e1bbbe17997a225609c09e8cc4941efa2f1598c4358'
    or octet_length(s.source::text)<>1958 or s.shop<>cfg.shop or s.policy is distinct from cfg.policy
    or s.from_time is distinct from cfg.from_time or s.until_time is distinct from cfg.until_time
    or r.source<>'shopify' or r.topic<>'orders/updated'
    or lean_private.receipt_shop(r.business_key) is distinct from cfg.shop
    then raise exception 'zero-total retained binding'; end if;
  if not exists(select 1 from lean_private.publications where publication_id=s.publication_id and state='candidate')
    or exists(select 1 from lean_private.pipeline_heads where work_id=target)
    or exists(select 1 from lean_private.projections where receipt_id=w.receipt_id)
    or exists(select 1 from lean_private.orders where publication_id=s.publication_id)
    or exists(select 1 from lean_private.order_items where publication_id=s.publication_id)
    or exists(select 1 from lean_private.sales_ledger where publication_id=s.publication_id)
    or exists(select 1 from lean_private.payments where publication_id=s.publication_id)
    or exists(select 1 from lean_private.report_store_daily where publication_id=s.publication_id)
    or exists(select 1 from lean_private.report_product_daily where publication_id=s.publication_id)
    or exists(select 1 from lean_private.certifications where publication_id=s.publication_id)
    or exists(select 1 from lean_private.selected_publications where publication_id=s.publication_id)
    then raise exception 'zero-total unexpected materialization'; end if;
  insert into lean_private.pipeline_zero_total_exception(work_id,scope_row_sha256,work_row_sha256,
    receipt_row_sha256,source_sha256,snapshot_metadata_sha256,approval_ref,actor_ref)
    values(target,p_scope_row_sha256,p_work_row_sha256,p_receipt_row_sha256,
      '7df76771b2de58f8ae485e1bbbe17997a225609c09e8cc4941efa2f1598c4358',
      'da013d66811726982d6099d1df5fc6d4c7b8f275d3302fe24e0ea012f5093070',p_approval_ref,p_actor_ref);
  -- Deliberate MVCC fence, not a state/attempt/error reset. The exact JSON
  -- preimage stays identical. Old RR/serializable writers must serialize-fail.
  update lean_private.work set state=state where work_id=target;
  if (select to_jsonb(current_work) from lean_private.work current_work where work_id=target) is distinct from to_jsonb(w)
    then raise exception 'zero-total logical work changed'; end if;
  insert into lean_private.pipeline_operator_audit(event,work_id,previous_state,approval_ref,actor_ref)
    values('deferred_zero_total_revision',target,jsonb_build_object('work',to_jsonb(w),
      'snapshot_metadata',lean_private.pipeline_zero_total_metadata(s),'source_sha256',
      '7df76771b2de58f8ae485e1bbbe17997a225609c09e8cc4941efa2f1598c4358'),p_approval_ref,p_actor_ref);
  if clock_timestamp()>=p_deadline then raise exception 'zero-total operation deadline'; end if;
  return true;
end $$;

revoke all on function lean_private.pipeline_zero_total_immutable(),
  lean_private.pipeline_zero_total_lease_fence(),
  lean_private.pipeline_zero_total_metadata(lean_private.pipeline_snapshots),
  lean_private.pipeline_zero_total_matches(lean_private.work,lean_private.pipeline_scope),
  lean_private.register_pipeline_zero_total_exception(text,text,text,text,text,timestamptz)
  from public,anon,authenticated,service_role;

create or replace function public.lean_pipeline_claim(p_token uuid,p_project_ref text,p_shop text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare cfg lean_private.pipeline_scope; w lean_private.work; r lean_private.receipts;
  s lean_private.pipeline_snapshots;
begin
  if p_token is null then raise exception 'token required'; end if;
  -- Shared admission lock does not serialize ordinary claimants. Registration
  -- takes its exclusive counterpart before checking pending/no-lease + CAS.
  perform pg_advisory_xact_lock_shared(hashtextextended('pipeline_zero_total_exception:xnfjdbpjuaezxjgargto',0));
  select * into cfg from lean_private.pipeline_scope where shop=p_shop and project_ref=p_project_ref for share;
  if not found then raise exception 'unapproved target'; end if;
  if not cfg.enabled then return jsonb_build_object('state','disabled'); end if;
  update lean_private.work x set state='dead',lease_token=null,lease_until=null,last_error_code='attempts_exhausted'
    from lean_private.receipts y where x.receipt_id=y.receipt_id and lean_private.receipt_shop(y.business_key)=p_shop
      and x.state='leased' and x.lease_until<=clock_timestamp() and x.attempts>=5;
  select x.* into w from lean_private.work x join lean_private.receipts y on y.receipt_id=x.receipt_id
    where y.source='shopify' and lean_private.receipt_shop(y.business_key)=p_shop and x.attempts<5
      and not lean_private.pipeline_zero_total_matches(x,cfg)
      and ((x.state='pending' and x.available_at<=clock_timestamp()) or
           (x.state='leased' and x.lease_until<=clock_timestamp()))
    order by x.available_at,x.work_id for update of x skip locked limit 1;
  if not found then return jsonb_build_object('state','idle'); end if;
  select * into strict r from lean_private.receipts where receipt_id=w.receipt_id;
  insert into lean_private.publications(publication_id,contract_version)
    values('shopify:'||w.receipt_id,'lean-v1-draft.1') on conflict do nothing;
  insert into lean_private.pipeline_snapshots(work_id,shop,publication_id,policy,from_time,until_time)
    values(w.work_id,p_shop,'shopify:'||w.receipt_id,cfg.policy,cfg.from_time,cfg.until_time) on conflict do nothing;
  select * into strict s from lean_private.pipeline_snapshots where work_id=w.work_id;
  update lean_private.work set state='leased',attempts=attempts+1,lease_token=p_token::text,
    lease_until=clock_timestamp()+interval '120 seconds' where work_id=w.work_id;
  return jsonb_build_object('state','claimed','workId',w.work_id::text,'topic',r.topic,'payload',r.payload,
    'source',s.source,'policy',s.policy,'publication',s.publication_id,'fromTime',s.from_time,'untilTime',s.until_time);
end $$;
create or replace function public.lean_pipeline_health(p_project_ref text,p_shop text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb; enabled boolean;
begin
  select c.enabled into enabled from lean_private.pipeline_scope c where shop=p_shop and project_ref=p_project_ref;
  if not found then raise exception 'unapproved target'; end if;
  select jsonb_build_object('enabled',enabled,'pending',count(*) filter(where w.state='pending'),
    'leased',count(*) filter(where w.state='leased'),'dead',count(*) filter(where w.state='dead'),
    'done',count(*) filter(where w.state='done'),
    'excluded',count(*) filter(where w.state='done' and w.last_error_code in ('excluded_before_window','excluded_annual_access')),
    'excludedBeforeWindow',count(*) filter(where w.state='done' and w.last_error_code='excluded_before_window'),
    'excludedAnnualAccess',count(*) filter(where w.state='done' and w.last_error_code='excluded_annual_access'),
    'oldestPendingSeconds',coalesce(extract(epoch from clock_timestamp()-min(r.received_at)
      filter(where w.state in ('pending','leased'))),0),
    'expiredLeases',count(*) filter(where w.state='leased' and w.lease_until<=clock_timestamp()))
    into result from lean_private.work w join lean_private.receipts r using(receipt_id)
      where lean_private.receipt_shop(r.business_key)=p_shop;
  return result || jsonb_build_object('unresolvedExceptions',
    (select count(*) from lean_private.pipeline_zero_total_exception
      where p_project_ref='xnfjdbpjuaezxjgargto' and p_shop='mullybox-store.myshopify.com'));
end $$;
do $acl$
declare p record; role_name text;
begin
  if exists(select 1 from pg_roles where rolname='lean_posthog_reader') then
    revoke all on lean_private.pipeline_zero_total_exception from lean_posthog_reader;
  end if;
  if exists(select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
    where c.oid='lean_private.pipeline_zero_total_exception'::regclass and a.grantee<>c.relowner)
    then raise exception 'zero-total unexpected table grant'; end if;
  for p in select oid,oid::regprocedure signature,proowner from pg_proc
    where pronamespace='lean_private'::regnamespace and proname in
      ('pipeline_zero_total_immutable','pipeline_zero_total_lease_fence','pipeline_zero_total_metadata','pipeline_zero_total_matches',
       'register_pipeline_zero_total_exception')
  loop
    if exists(select 1 from pg_roles where rolname='lean_posthog_reader') then
      execute format('revoke all on function %s from lean_posthog_reader',p.signature);
    end if;
    if exists(select 1 from pg_proc x cross join lateral aclexplode(x.proacl) a
      where x.oid=p.oid and a.grantee<>x.proowner) then raise exception 'zero-total unexpected function grant'; end if;
    for role_name in select rolname from pg_roles where rolname in ('anon','authenticated','service_role','lean_posthog_reader') loop
      if has_function_privilege(role_name,p.oid,'EXECUTE')
        then raise exception 'zero-total unexpected effective execute'; end if;
    end loop;
  end loop;
  for role_name in select rolname from pg_roles where rolname in ('anon','authenticated','service_role','lean_posthog_reader') loop
    if has_table_privilege(role_name,'lean_private.pipeline_zero_total_exception','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(role_name,'lean_private.pipeline_zero_total_exception','SELECT,INSERT,UPDATE,REFERENCES')
      then raise exception 'zero-total unexpected effective table privilege'; end if;
  end loop;
end $acl$;
commit;
