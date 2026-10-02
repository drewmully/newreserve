-- PRIVATE REVIEW ONLY. Empty/default off. Standing per-invocation capacity,
-- not a renewed EXTRA grant, cumulative allowance, capture window or scheduler.
begin;
create table lean_private.pipeline_ordinary_batch (
  singleton boolean primary key default true check(singleton),
  project_ref text not null check(project_ref='xnfjdbpjuaezxjgargto'),
  shop text not null check(shop='mullybox-store.myshopify.com'),
  scope_sha256 text not null check(scope_sha256='799209cbd0913f5257afaabefc478ec7e402640b4ac5c30e5f9ee81eeee30689'),
  enabled boolean not null default false,
  revision integer not null check(revision>0),
  approval_ref text not null check(length(trim(approval_ref)) between 1 and 500),
  actor_ref text not null check(length(trim(actor_ref)) between 1 and 200),
  created_at timestamptz not null default clock_timestamp()
);
alter table lean_private.pipeline_ordinary_batch enable row level security;
revoke all on lean_private.pipeline_ordinary_batch from public,anon,authenticated,service_role;

create function lean_private.pipeline_ordinary_batch_audit() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op in ('DELETE','TRUNCATE') then raise exception 'ordinary batch history immutable'; end if;
  if tg_op='INSERT' and new.revision<>1 then raise exception 'ordinary batch initial revision'; end if;
  if tg_op='UPDATE' and (
    (to_jsonb(old)-array['enabled','revision','approval_ref','actor_ref']) is distinct from
      (to_jsonb(new)-array['enabled','revision','approval_ref','actor_ref'])
    or new.revision<>old.revision+1 or new.approval_ref=old.approval_ref)
    then raise exception 'ordinary batch immutable terms or revision'; end if;
  insert into lean_private.pipeline_operator_audit(event,previous_state,approval_ref,actor_ref)
    values('ordinary_batch_control',jsonb_build_object('previous',case when tg_op='INSERT' then null else to_jsonb(old) end,
      'new',to_jsonb(new)),new.approval_ref,new.actor_ref);
  return new;
end $$;
create trigger audit_ordinary_batch before insert or update or delete on lean_private.pipeline_ordinary_batch
  for each row execute function lean_private.pipeline_ordinary_batch_audit();
create trigger no_truncate_ordinary_batch before truncate on lean_private.pipeline_ordinary_batch
  for each statement execute function lean_private.pipeline_ordinary_batch_audit();

create function lean_private.set_pipeline_ordinary_batch(
  p_enabled boolean,p_expected_revision integer,p_scope_row_sha256 text,p_approval_ref text,p_actor_ref text,p_deadline timestamptz)
returns integer language plpgsql set search_path=pg_catalog set timezone='UTC' as $$
declare cfg lean_private.pipeline_scope; g lean_private.pipeline_ordinary_batch; n integer; scope_hash text;
begin
  if current_user<>session_user or current_user::regrole::oid<>
    (select relowner from pg_class where oid='lean_private.pipeline_ordinary_batch'::regclass)
    or current_setting('transaction_isolation')<>'read committed' then raise exception 'ordinary batch owner context'; end if;
  if p_enabled is null or p_expected_revision is null or p_expected_revision<0
    or p_scope_row_sha256 is null or p_scope_row_sha256 !~ '^[a-f0-9]{64}$'
    or p_approval_ref is null or length(trim(p_approval_ref)) not between 1 and 500
    or p_actor_ref is null or length(trim(p_actor_ref)) not between 1 and 200
    or p_deadline is null or not isfinite(p_deadline) or p_deadline<=clock_timestamp()
    or p_deadline>clock_timestamp()+interval '15 minutes' then raise exception 'ordinary batch control unbound'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pipeline_ordinary_batch:xnfjdbpjuaezxjgargto',0));
  lock table lean_private.pipeline_ordinary_batch in exclusive mode;
  select * into g from lean_private.pipeline_ordinary_batch for update;
  n:=case when found then g.revision else 0 end;
  if n<>p_expected_revision then raise exception 'ordinary batch revision CAS'; end if;
  select * into strict cfg from lean_private.pipeline_scope
    where project_ref='xnfjdbpjuaezxjgargto' and shop='mullybox-store.myshopify.com' for share;
  if encode(sha256(convert_to(to_jsonb(cfg)::text,'UTF8')),'hex')<>p_scope_row_sha256
    then raise exception 'ordinary batch scope CAS'; end if;
  scope_hash:=encode(sha256(convert_to(jsonb_build_object('shop',cfg.shop,'project',cfg.project_ref,'policy',cfg.policy,
    'from',to_char(cfg.from_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'until',to_char(cfg.until_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'UTF8')),'hex');
  if p_enabled and (not cfg.enabled or scope_hash<>'799209cbd0913f5257afaabefc478ec7e402640b4ac5c30e5f9ee81eeee30689')
    then raise exception 'ordinary batch scope unavailable'; end if;
  if n=0 then
    insert into lean_private.pipeline_ordinary_batch(project_ref,shop,scope_sha256,enabled,revision,approval_ref,actor_ref)
      values(cfg.project_ref,cfg.shop,'799209cbd0913f5257afaabefc478ec7e402640b4ac5c30e5f9ee81eeee30689',
        p_enabled,1,p_approval_ref,p_actor_ref);
  else
    update lean_private.pipeline_ordinary_batch set enabled=p_enabled,revision=n+1,
      approval_ref=p_approval_ref,actor_ref=p_actor_ref where singleton;
  end if;
  if clock_timestamp()>=p_deadline then raise exception 'ordinary batch control deadline'; end if;
  return n+1;
end $$;

create function public.lean_pipeline_ordinary_batch_admission(p_project_ref text,p_shop text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare cfg lean_private.pipeline_scope; g lean_private.pipeline_ordinary_batch; scope_hash text;
begin
  if p_project_ref is distinct from 'xnfjdbpjuaezxjgargto' or p_shop is distinct from 'mullybox-store.myshopify.com'
    then raise exception 'ordinary batch target'; end if;
  select * into g from lean_private.pipeline_ordinary_batch;
  if not found or not g.enabled then return jsonb_build_object('state','off'); end if;
  select * into strict cfg from lean_private.pipeline_scope where project_ref=p_project_ref and shop=p_shop;
  if not cfg.enabled then return jsonb_build_object('state','scope_disabled'); end if;
  scope_hash:=encode(sha256(convert_to(jsonb_build_object('shop',cfg.shop,'project',cfg.project_ref,'policy',cfg.policy,
    'from',to_char(cfg.from_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'until',to_char(cfg.until_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'UTF8')),'hex');
  if scope_hash is distinct from g.scope_sha256 then return jsonb_build_object('state','scope_changed'); end if;
  return jsonb_build_object('state','ready','revision',g.revision,'scopeSha256',g.scope_sha256,
    'maxClaims',20,'maxNativeRequests',160,'deadlineSeconds',80,'minRemainingSeconds',65);
end $$;

-- No new work state or queue algorithm. The shared row lock fences disable/CAS
-- against claim, and the existing claim owns attempts, revision, lease and
-- exact nonterminal-exception selection. A disable cannot retract issued work.
create function public.lean_pipeline_ordinary_batch_claim(p_token uuid,p_project_ref text,p_shop text,p_revision integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare g lean_private.pipeline_ordinary_batch; cfg lean_private.pipeline_scope; scope_hash text; r jsonb;
begin
  if current_setting('transaction_isolation')<>'read committed' or p_token is null
    or p_project_ref is distinct from 'xnfjdbpjuaezxjgargto' or p_shop is distinct from 'mullybox-store.myshopify.com'
    or p_revision is null or p_revision<1 then raise exception 'ordinary batch claim context'; end if;
  select * into g from lean_private.pipeline_ordinary_batch for share;
  if not found or not g.enabled or g.revision<>p_revision then return jsonb_build_object('state','disabled'); end if;
  select * into strict cfg from lean_private.pipeline_scope where project_ref=p_project_ref and shop=p_shop for share;
  scope_hash:=encode(sha256(convert_to(jsonb_build_object('shop',cfg.shop,'project',cfg.project_ref,'policy',cfg.policy,
    'from',to_char(cfg.from_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'until',to_char(cfg.until_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'UTF8')),'hex');
  if not cfg.enabled or scope_hash is distinct from g.scope_sha256 then return jsonb_build_object('state','disabled'); end if;
  r:=public.lean_pipeline_claim(p_token,p_project_ref,p_shop);
  if r->>'state'='claimed' and (r->'policy' is distinct from cfg.policy
    or (r->>'fromTime')::timestamptz is distinct from cfg.from_time
    or (r->>'untilTime')::timestamptz is distinct from cfg.until_time)
    then raise exception 'ordinary batch frozen scope changed'; end if;
  return r;
end $$;

revoke all on function lean_private.pipeline_ordinary_batch_audit(),
  lean_private.set_pipeline_ordinary_batch(boolean,integer,text,text,text,timestamptz),
  public.lean_pipeline_ordinary_batch_admission(text,text),
  public.lean_pipeline_ordinary_batch_claim(uuid,text,text,integer) from public,anon,authenticated,service_role;
do $acl$
declare p record; role_name text;
begin
  if exists(select 1 from pg_roles where rolname='lean_posthog_reader') then
    revoke all on lean_private.pipeline_ordinary_batch from lean_posthog_reader;
  end if;
  if exists(select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
    where c.oid='lean_private.pipeline_ordinary_batch'::regclass and a.grantee<>c.relowner)
    then raise exception 'ordinary batch table ACL'; end if;
  for p in select oid,oid::regprocedure signature from pg_proc where
    (pronamespace='lean_private'::regnamespace and proname in ('pipeline_ordinary_batch_audit','set_pipeline_ordinary_batch'))
    or (pronamespace='public'::regnamespace and proname in ('lean_pipeline_ordinary_batch_admission','lean_pipeline_ordinary_batch_claim'))
  loop
    if exists(select 1 from pg_roles where rolname='lean_posthog_reader') then
      execute format('revoke all on function %s from lean_posthog_reader',p.signature);
    end if;
    if exists(select 1 from pg_proc x cross join lateral aclexplode(x.proacl) a where x.oid=p.oid and a.grantee<>x.proowner)
      then raise exception 'ordinary batch function ACL'; end if;
    for role_name in select rolname from pg_roles where rolname in ('anon','authenticated','service_role','lean_posthog_reader') loop
      if has_function_privilege(role_name,p.oid,'EXECUTE') then raise exception 'ordinary batch effective execute'; end if;
    end loop;
  end loop;
  for role_name in select rolname from pg_roles where rolname in ('anon','authenticated','service_role','lean_posthog_reader') loop
    if has_table_privilege(role_name,'lean_private.pipeline_ordinary_batch','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(role_name,'lean_private.pipeline_ordinary_batch','SELECT,INSERT,UPDATE,REFERENCES')
      then raise exception 'ordinary batch effective table privilege'; end if;
  end loop;
end $acl$;
grant execute on function public.lean_pipeline_ordinary_batch_admission(text,text),
  public.lean_pipeline_ordinary_batch_claim(uuid,text,text,integer) to service_role;
commit;
