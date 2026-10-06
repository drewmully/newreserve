-- PRIVATE REVIEW ONLY. Empty/default off. No scope/source/policy rewrite.
-- Requires the released zero-total v3, standing lifetime and ordinary batch.
begin;
do $baseline$
begin
  if encode(sha256(convert_to((select prosrc from pg_proc where oid=
      'public.lean_pipeline_claim(uuid,text,text)'::regprocedure),'UTF8')),'hex')<>
      '6b28e30036aac903036b380ad3724ee376b46a30e675e4997202ed70afc197c3'
    or encode(sha256(convert_to((select prosrc from pg_proc where oid=
      'public.lean_pipeline_health(text,text)'::regprocedure),'UTF8')),'hex')<>
      'b578b808381c62214d49dd0efc6de4eb22ad3420e099edbf30d9fb3185718566'
    or encode(sha256(convert_to((select prosrc from pg_proc where oid=
      'lean_private.pipeline_zero_total_matches(lean_private.work,lean_private.pipeline_scope)'::regprocedure),'UTF8')),'hex')<>
      '3e514200ef58d40d990ecab3ec82abe00ad578914486886e84f55ad0a52915d2'
    or encode(sha256(convert_to((select prosrc from pg_proc where oid=
      'lean_private.pipeline_zero_total_lease_fence()'::regprocedure),'UTF8')),'hex')<>
      'd6342906e2084ea60f8b91f860cffe79e71fa4e23e1c779c96c54fc6b3a059fc'
    or encode(sha256(convert_to((select prosrc from pg_proc where oid=
      'public.lean_pipeline_finish_extended(bigint,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure),'UTF8')),'hex')<>
      'f696172bd805e4fb20c8f0c3611799e70bf430404932d0d1750db05bd20e6fbf'
    then raise exception 'ingestion baseline changed'; end if;
end $baseline$;

create table lean_private.pipeline_ingestion_amendment (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  revision integer not null check(revision>0),
  scope_sha256 text not null check(scope_sha256='799209cbd0913f5257afaabefc478ec7e402640b4ac5c30e5f9ee81eeee30689'),
  approval_ref text not null check(length(trim(approval_ref)) between 1 and 500),
  actor_ref text not null check(length(trim(actor_ref)) between 1 and 200),
  created_at timestamptz not null default clock_timestamp()
);
create table lean_private.pipeline_ingestion_completions (
  work_id bigint primary key references lean_private.work,
  admission jsonb not null,
  snapshot_metadata_sha256 text not null,
  source_sha256 text not null,
  completed_at timestamptz not null default clock_timestamp()
);
alter table lean_private.pipeline_ingestion_amendment enable row level security;
alter table lean_private.pipeline_ingestion_completions enable row level security;
revoke all on lean_private.pipeline_ingestion_amendment,lean_private.pipeline_ingestion_completions
  from public,anon,authenticated,service_role;
create function lean_private.pipeline_ingestion_audit() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op in ('DELETE','TRUNCATE') or tg_table_name='pipeline_ingestion_completions'
    then raise exception 'ingestion history immutable'; end if;
  if tg_op='INSERT' and new.revision<>1 then raise exception 'ingestion initial revision'; end if;
  if tg_op='UPDATE' and (
    (to_jsonb(old)-array['enabled','revision','approval_ref','actor_ref']) is distinct from
      (to_jsonb(new)-array['enabled','revision','approval_ref','actor_ref'])
    or new.revision<>old.revision+1 or new.approval_ref=old.approval_ref)
    then raise exception 'ingestion immutable terms or revision'; end if;
  insert into lean_private.pipeline_operator_audit(event,previous_state,approval_ref,actor_ref)
    values('ingestion_amendment_control',jsonb_build_object(
      'previous',case when tg_op='INSERT' then null else to_jsonb(old) end,'new',to_jsonb(new),
      'version','ingestion-amendment-20261002',
      'productClasses',jsonb_build_object('10244806213824','merchandise','10249371680960','merchandise','8501257306304','merchandise'),
      'refundSupplement',jsonb_build_object(
        'sourceSha256','967d4d3a6027912a30137d71263421f6c4c64e9a692d49a2f605f1c837ce55c1',
        'evidenceArchiveSha256','df50358fabf53683c634e5f2f56712d3dab0472f2e0cf0a7db2365f7c28e4cfe',
        'component','other_sales_adjustment','amount','-13.50','taxAmount','0.00','currency','USD',
        'allocation','order_level','refundClock','refund_created_at')),
      new.approval_ref,new.actor_ref);
  return new;
end $$;
create trigger audit_ingestion_amendment before insert or update or delete on lean_private.pipeline_ingestion_amendment
  for each row execute function lean_private.pipeline_ingestion_audit();
create trigger no_truncate_ingestion_amendment before truncate on lean_private.pipeline_ingestion_amendment
  for each statement execute function lean_private.pipeline_ingestion_audit();
create trigger immutable_ingestion_completion before update or delete on lean_private.pipeline_ingestion_completions
  for each row execute function lean_private.pipeline_ingestion_audit();
create trigger no_truncate_ingestion_completion before truncate on lean_private.pipeline_ingestion_completions
  for each statement execute function lean_private.pipeline_ingestion_audit();

create function lean_private.pipeline_ingestion_scope(cfg lean_private.pipeline_scope)
returns boolean language sql stable set search_path=pg_catalog set timezone='UTC' as $$
  select cfg.enabled and cfg.project_ref='xnfjdbpjuaezxjgargto' and cfg.shop='mullybox-store.myshopify.com'
    and encode(sha256(convert_to(jsonb_build_object('shop',cfg.shop,'project',cfg.project_ref,'policy',cfg.policy,
      'from',to_char(cfg.from_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'until',to_char(cfg.until_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'UTF8')),'hex')=
      '799209cbd0913f5257afaabefc478ec7e402640b4ac5c30e5f9ee81eeee30689';
$$;
-- Does not depend on enabled admission. Used for the fresh registration CAS.
create function lean_private.pipeline_ingestion_zero_equivalent(s lean_private.pipeline_snapshots,cfg lean_private.pipeline_scope)
returns boolean language sql stable set search_path=pg_catalog set timezone='UTC' as $$
  select lean_private.pipeline_ingestion_scope(cfg) and exists(
    select 1 from lean_private.pipeline_zero_total_exception e
    join lean_private.pipeline_snapshots anchor on anchor.work_id=e.work_id
    where e.source_sha256='7df76771b2de58f8ae485e1bbbe17997a225609c09e8cc4941efa2f1598c4358'
      and e.scope_row_sha256=encode(sha256(convert_to(to_jsonb(cfg)::text,'UTF8')),'hex')
      and e.snapshot_metadata_sha256=encode(sha256(convert_to(lean_private.pipeline_zero_total_metadata(anchor)::text,'UTF8')),'hex')
      and e.source_sha256=encode(sha256(convert_to(anchor.source::text,'UTF8')),'hex')
      and e.source_sha256=encode(sha256(convert_to(s.source::text,'UTF8')),'hex')
      and s.shop=anchor.shop and s.shop=cfg.shop and s.order_gid=anchor.order_gid
      and s.revision=anchor.revision and s.policy=anchor.policy and s.policy=cfg.policy
      and s.from_time=anchor.from_time and s.from_time=cfg.from_time
      and s.until_time=anchor.until_time and s.until_time=cfg.until_time);
$$;

-- Hash-only metadata. Owner can bind a new operation without exporting source.
create function lean_private.pipeline_ingestion_zero_inventory()
returns jsonb language sql stable set search_path=pg_catalog set timezone='UTC' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'workSha256',encode(sha256(convert_to(to_jsonb(w)::text,'UTF8')),'hex'),
    'receiptSha256',encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),
    'snapshotSha256',encode(sha256(convert_to(lean_private.pipeline_zero_total_metadata(s)::text,'UTF8')),'hex'))
    order by w.work_id),'[]'::jsonb)
  from lean_private.pipeline_snapshots s join lean_private.work w using(work_id)
    join lean_private.receipts r using(receipt_id) cross join lean_private.pipeline_scope cfg
  where cfg.shop='mullybox-store.myshopify.com' and cfg.project_ref='xnfjdbpjuaezxjgargto'
    and lean_private.pipeline_ingestion_zero_equivalent(s,cfg);
$$;

create function lean_private.set_pipeline_ingestion_amendment(
  p_enabled boolean,p_expected_revision integer,p_scope_row_sha256 text,p_zero_set_sha256 text,
  p_approval_ref text,p_actor_ref text,p_deadline timestamptz)
returns integer language plpgsql set search_path=pg_catalog set timezone='UTC' as $$
declare cfg lean_private.pipeline_scope; g lean_private.pipeline_ingestion_amendment;
  w lean_private.work; s lean_private.pipeline_snapshots; r lean_private.receipts; n integer; count_zero integer:=0;
  count_pending integer:=0; count_terminal integer:=0;
begin
  if current_user<>session_user or current_user::regrole::oid<>
    (select relowner from pg_class where oid='lean_private.pipeline_ingestion_amendment'::regclass)
    or current_setting('transaction_isolation')<>'read committed' then raise exception 'ingestion owner context'; end if;
  if p_enabled is null or p_expected_revision is null or p_expected_revision<0
    or p_scope_row_sha256 is null or p_scope_row_sha256 !~ '^[a-f0-9]{64}$'
    or p_enabled and (p_zero_set_sha256 is null or p_zero_set_sha256 !~ '^[a-f0-9]{64}$')
    or p_approval_ref is null or length(trim(p_approval_ref)) not between 1 and 500
    or p_actor_ref is null or length(trim(p_actor_ref)) not between 1 and 200
    or p_deadline is null or not isfinite(p_deadline) or p_deadline<=clock_timestamp()
    or p_deadline>clock_timestamp()+interval '15 minutes' then raise exception 'ingestion operation unbound'; end if;
  -- Same order as claim. Never take this lock inside the work-row trigger.
  perform pg_advisory_xact_lock(hashtextextended('pipeline_zero_total_exception:xnfjdbpjuaezxjgargto',0));
  lock table lean_private.pipeline_ingestion_amendment in exclusive mode;
  select * into g from lean_private.pipeline_ingestion_amendment for update;
  n:=case when found then g.revision else 0 end;
  if n<>p_expected_revision then raise exception 'ingestion revision CAS'; end if;
  select * into strict cfg from lean_private.pipeline_scope where
    project_ref='xnfjdbpjuaezxjgargto' and shop='mullybox-store.myshopify.com' for share;
  if encode(sha256(convert_to(to_jsonb(cfg)::text,'UTF8')),'hex')<>p_scope_row_sha256
    or p_enabled and not lean_private.pipeline_ingestion_scope(cfg) then raise exception 'ingestion scope CAS'; end if;
  if p_enabled then
    if (select count(*) from (select 1 from lean_private.pipeline_snapshots limit 5001) b)>5000
      then raise exception 'ingestion snapshot cap'; end if;
    if (select count(*) from pg_trigger where tgrelid='lean_private.work'::regclass and not tgisinternal)<>1
      or not exists(select 1 from pg_trigger where tgrelid='lean_private.work'::regclass
        and tgname='pipeline_zero_total_lease_fence' and not tgisinternal and tgenabled='O'
        and tgfoid='lean_private.pipeline_zero_total_lease_fence()'::regprocedure and tgtype=19)
      or exists(select 1 from pg_rewrite where ev_class='lean_private.work'::regclass)
      then raise exception 'ingestion work fence changed'; end if;
    for w in select x.* from lean_private.work x join lean_private.pipeline_snapshots y using(work_id)
      where lean_private.pipeline_ingestion_zero_equivalent(y,cfg) order by x.work_id for update of x
    loop
      count_zero:=count_zero+1;
      -- Terminal history remains in the locked population and the full CAS.
      -- It is not a completion, exclusion, recovery or newly claimable work.
      if count_zero>100 or not (
          (w.state='pending' and w.attempts between 1 and 4) or
          (w.state='dead' and w.attempts=5))
        or w.last_error_code is distinct from 'mapping_rejected' or w.completed_at is not null
        or w.lease_token is not null or w.lease_until is not null then raise exception 'ingestion zero work unavailable'; end if;
      select * into strict s from lean_private.pipeline_snapshots where work_id=w.work_id for share;
      select * into strict r from lean_private.receipts where receipt_id=w.receipt_id for share;
      if not lean_private.pipeline_ingestion_zero_equivalent(s,cfg)
        or r.source<>'shopify' or r.topic not in ('orders/paid','orders/updated')
        or lean_private.receipt_shop(r.business_key) is distinct from cfg.shop
        or not exists(select 1 from lean_private.publications where publication_id=s.publication_id and state='candidate')
        or exists(select 1 from lean_private.pipeline_heads where work_id=w.work_id)
        or exists(select 1 from lean_private.projections where receipt_id=w.receipt_id)
        or exists(select 1 from lean_private.orders where publication_id=s.publication_id)
        or exists(select 1 from lean_private.order_items where publication_id=s.publication_id)
        or exists(select 1 from lean_private.order_item_sizes where publication_id=s.publication_id)
        or exists(select 1 from lean_private.sales_ledger where publication_id=s.publication_id)
        or exists(select 1 from lean_private.payments where publication_id=s.publication_id)
        or exists(select 1 from lean_private.report_store_daily where publication_id=s.publication_id)
        or exists(select 1 from lean_private.report_product_daily where publication_id=s.publication_id)
        or exists(select 1 from lean_private.selected_publications where publication_id=s.publication_id)
        or exists(select 1 from lean_private.certifications where publication_id=s.publication_id)
        then raise exception 'ingestion zero evidence changed'; end if;
      if w.state='pending' then
        count_pending:=count_pending+1;
        -- MVCC-only fence for an old RR claim. Fresh RC claims hit v3 trigger.
        update lean_private.work set state=state where work_id=w.work_id;
        if (select to_jsonb(x) from lean_private.work x where x.work_id=w.work_id) is distinct from to_jsonb(w)
          then raise exception 'ingestion zero logical work changed'; end if;
      else
        count_terminal:=count_terminal+1;
        -- Do not even advance the physical version of terminal history.
      end if;
    end loop;
    if count_zero<1 or encode(sha256(convert_to(lean_private.pipeline_ingestion_zero_inventory()::text,'UTF8')),'hex')
      <>p_zero_set_sha256 then raise exception 'ingestion zero inventory CAS'; end if;
  end if;
  if n=0 then
    insert into lean_private.pipeline_ingestion_amendment(enabled,revision,scope_sha256,approval_ref,actor_ref)
      values(p_enabled,1,'799209cbd0913f5257afaabefc478ec7e402640b4ac5c30e5f9ee81eeee30689',p_approval_ref,p_actor_ref);
  else
    update lean_private.pipeline_ingestion_amendment set enabled=p_enabled,revision=n+1,
      approval_ref=p_approval_ref,actor_ref=p_actor_ref where singleton;
  end if;
  insert into lean_private.pipeline_operator_audit(event,previous_state,approval_ref,actor_ref)
    values('ingestion_amendment_binding',jsonb_build_object('scopeRowSha256',p_scope_row_sha256,
      'zeroSetSha256',p_zero_set_sha256,'zeroRecords',count_zero,
      'zeroPendingDeferred',count_pending,'zeroTerminalRetained',count_terminal,
      'zeroDispositionVersion','forward-only-20261005','revision',n+1),p_approval_ref,p_actor_ref);
  if clock_timestamp()>=p_deadline then raise exception 'ingestion operation deadline'; end if;
  return n+1;
end $$;

create function lean_private.pipeline_ingestion_context(s lean_private.pipeline_snapshots,cfg lean_private.pipeline_scope)
returns jsonb language sql stable set search_path=pg_catalog as $$
  select jsonb_build_object('version','ingestion-amendment-20261002','revision',a.revision,'approvalRef',a.approval_ref,
    'scopeSha256',a.scope_sha256,'retainedSourceSha256',encode(sha256(convert_to(s.source::text,'UTF8')),'hex'))
  from lean_private.pipeline_ingestion_amendment a where a.enabled and lean_private.pipeline_ingestion_scope(cfg)
    and s.shop=cfg.shop and s.policy=cfg.policy and s.from_time=cfg.from_time and s.until_time=cfg.until_time;
$$;

-- Append equivalence to the exact v3 predicate; retain its original branch.
do $replace$
declare old_body text; new_body text; definition text;
begin
  select prosrc,pg_get_functiondef(oid) into old_body,definition from pg_proc
    where oid='lean_private.pipeline_zero_total_matches(lean_private.work,lean_private.pipeline_scope)'::regprocedure;
  if old_body not like '%where e.work_id=w.work_id%' or old_body like '%pipeline_ingestion_%'
    then raise exception 'ingestion zero baseline changed'; end if;
  new_body:=regexp_replace(old_body,';\s*$','') || $branch$
    or exists(select 1 from lean_private.pipeline_ingestion_amendment a
      join lean_private.pipeline_snapshots s on s.work_id=w.work_id
      join lean_private.receipts r on r.receipt_id=w.receipt_id
      where a.enabled and w.state='pending' and w.attempts between 1 and 4
        and w.last_error_code='mapping_rejected' and w.completed_at is null
        and w.lease_token is null and w.lease_until is null
        and r.source='shopify' and r.topic in ('orders/paid','orders/updated')
        and lean_private.receipt_shop(r.business_key)=cfg.shop
        and lean_private.pipeline_ingestion_zero_equivalent(s,cfg));
  $branch$;
  execute replace(definition,old_body,new_body);
  select prosrc,pg_get_functiondef(oid) into old_body,definition from pg_proc
    where oid='public.lean_pipeline_claim(uuid,text,text)'::regprocedure;
  new_body:=replace(old_body,'select * into cfg from lean_private.pipeline_scope',
    'perform 1 from lean_private.pipeline_ingestion_amendment for share;
  select * into cfg from lean_private.pipeline_scope');
  new_body:=replace(new_body,'''untilTime'',s.until_time);',
    '''untilTime'',s.until_time,''ingestionAmendment'',lean_private.pipeline_ingestion_context(s,cfg));');
  if new_body=old_body or new_body not like '%''ingestionAmendment''%' then raise exception 'ingestion claim splice'; end if;
  execute replace(definition,old_body,new_body);
  select prosrc,pg_get_functiondef(oid) into old_body,definition from pg_proc
    where oid='public.lean_pipeline_health(text,text)'::regprocedure;
  new_body:=replace(old_body,
    'select count(*) from lean_private.pipeline_zero_total_exception',
    'select (select count(*) from lean_private.pipeline_zero_total_exception) +
      (select count(*) from lean_private.work x cross join lean_private.pipeline_scope cfg
        where cfg.project_ref=p_project_ref and cfg.shop=p_shop
          and exists(select 1 from lean_private.pipeline_ingestion_amendment a where a.enabled)
          and exists(select 1 from lean_private.pipeline_snapshots s where s.work_id=x.work_id
            and lean_private.pipeline_ingestion_zero_equivalent(s,cfg))
          and not exists(select 1 from lean_private.pipeline_zero_total_exception e where e.work_id=x.work_id))
      from (values(1)) as one(v)');
  if new_body=old_body then raise exception 'ingestion health splice'; end if;
  execute replace(definition,old_body,new_body);
end $replace$;

create function public.lean_pipeline_finish_amended(
  p_work_id bigint,p_token uuid,p_amendment_revision integer,p_facts jsonb,p_reports jsonb,
  p_product_reports jsonb,p_order_item_sizes jsonb default null)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare a lean_private.pipeline_ingestion_amendment; cfg lean_private.pipeline_scope;
  w lean_private.work; s lean_private.pipeline_snapshots; admission jsonb; ok boolean;
begin
  -- Join claim's shared admission lock BEFORE row locks. A batch may already
  -- hold scope SHARE while waiting on the owner's exclusive advisory lock.
  -- Without this, owner -> admission -> finish -> scope -> batch deadlocks.
  perform pg_advisory_xact_lock_shared(hashtextextended('pipeline_zero_total_exception:xnfjdbpjuaezxjgargto',0));
  -- Advisory -> admission -> scope -> work. Existing 047
  -- takes scope FOR UPDATE, so take that mode here rather than upgrade later.
  select * into a from lean_private.pipeline_ingestion_amendment for share;
  if not found or not a.enabled or p_amendment_revision is distinct from a.revision then return false; end if;
  select * into strict cfg from lean_private.pipeline_scope where project_ref='xnfjdbpjuaezxjgargto'
    and shop='mullybox-store.myshopify.com' for update;
  select * into w from lean_private.work where work_id=p_work_id for update;
  if not found or p_token is null or w.state<>'leased' or w.lease_token is distinct from p_token::text
    or w.lease_until<=clock_timestamp() then return false; end if;
  select * into strict s from lean_private.pipeline_snapshots where work_id=p_work_id;
  admission:=lean_private.pipeline_ingestion_context(s,cfg);
  if admission is null or s.source is null then return false; end if;
  ok:=public.lean_pipeline_finish_extended(p_work_id,p_token,p_facts,p_reports,p_product_reports,p_order_item_sizes);
  if ok then
    insert into lean_private.pipeline_ingestion_completions(work_id,admission,snapshot_metadata_sha256,source_sha256)
      values(p_work_id,admission,encode(sha256(convert_to(lean_private.pipeline_zero_total_metadata(s)::text,'UTF8')),'hex'),
        encode(sha256(convert_to(s.source::text,'UTF8')),'hex'));
  end if;
  return ok;
end $$;

do $acl$
declare p record; t text; role_name text;
begin
  foreach t in array array['pipeline_ingestion_amendment','pipeline_ingestion_completions'] loop
    if exists(select 1 from pg_roles where rolname='lean_posthog_reader') then
      execute format('revoke all on lean_private.%I from lean_posthog_reader',t);
    end if;
    if exists(select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
      where c.oid=('lean_private.'||t)::regclass and a.grantee<>c.relowner)
      then raise exception 'ingestion unexpected table grant'; end if;
    for role_name in select rolname from pg_roles where rolname in ('anon','authenticated','service_role','lean_posthog_reader') loop
      if has_table_privilege(role_name,'lean_private.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege(role_name,'lean_private.'||t,'SELECT,INSERT,UPDATE,REFERENCES')
        then raise exception 'ingestion table ACL'; end if;
    end loop;
  end loop;
  for p in select oid,oid::regprocedure signature from pg_proc where
    pronamespace='lean_private'::regnamespace and proname in
      ('pipeline_ingestion_audit','pipeline_ingestion_scope','pipeline_ingestion_zero_equivalent',
       'pipeline_ingestion_zero_inventory','set_pipeline_ingestion_amendment','pipeline_ingestion_context')
    or oid='public.lean_pipeline_finish_amended(bigint,uuid,integer,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',p.signature);
    if exists(select 1 from pg_roles where rolname='lean_posthog_reader') then
      execute format('revoke all on function %s from lean_posthog_reader',p.signature);
    end if;
    if exists(select 1 from pg_proc x cross join lateral aclexplode(x.proacl) acl where x.oid=p.oid and acl.grantee<>x.proowner)
      then raise exception 'ingestion function ACL'; end if;
    for role_name in select rolname from pg_roles where rolname in ('anon','authenticated','service_role','lean_posthog_reader') loop
      if has_function_privilege(role_name,p.oid,'EXECUTE') then raise exception 'ingestion effective execute'; end if;
    end loop;
  end loop;
end $acl$;
grant execute on function public.lean_pipeline_finish_amended(bigint,uuid,integer,jsonb,jsonb,jsonb,jsonb) to service_role;
commit;
