-- REVIEW ONLY. Additive, absent-only installation. No policy or grant is created.
-- Apply separately from the installed history package, never at app startup.
begin;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
do $$
declare r record;
begin
  perform pg_advisory_xact_lock(hashtextextended('lean:reserve-runtime-v1:install',0));
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'journey runtime installation requires read committed';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='lean_private'
    and table_name='journey_policies' and column_name like 'runtime_%')
    or exists(select 1 from pg_proc where proname like '%journey_runtime_%')
    or exists(select 1 from pg_trigger where tgname like 'journey_runtime_%' and not tgisinternal)
    then raise exception 'journey runtime footprint already present or partial'; end if;
  for r in select * from (values
    ('public.lean_journey_action(text,text,text,uuid,text)','cc14bc31a58aefe2a2b420764bb1447d'),
    ('public.lean_journey_grant(text,text,text)','7eaf1e9796a94d3d00e139dc3fec0315'),
    ('public.lean_journey_issue(text,text,text,text,text,text,uuid,text)','a067597b9ef5b675eac418fd7666f103'),
    ('public.lean_journey_withdraw(text,text,text)','0aeeb56f015ca90f2f69a390e2b0796c')
  ) pins(signature,body_hash) loop
    if not exists(select 1 from pg_proc where oid=to_regprocedure(r.signature)
      and md5(prosrc)=r.body_hash and prosecdef)
      then raise exception 'journey dependency mismatch: %',r.signature; end if;
  end loop;
  if exists(select 1 from lean_private.journey_policies where policy_version='reserve-runtime-v1')
    or exists(select 1 from lean_private.journey_grants
      where permission_evidence_ref like 'explicit-browser-choice:reserve-runtime-v1:%')
    then raise exception 'reserved journey policy already used'; end if;
end $$;

alter table lean_private.journey_policies
  add column runtime_capture_key_sha256 text,
  add column runtime_valid_until timestamptz,
  add constraint journey_runtime_config_shape check (
    (runtime_capture_key_sha256 is null and runtime_valid_until is null) or
    (policy_version='reserve-runtime-v1' and project_ref='xnfjdbpjuaezxjgargto'
      and shop='mullybox-store.myshopify.com' and posthog_project='353503'
      and runtime_capture_key_sha256 is not null
      and runtime_capture_key_sha256 ~ '^[a-f0-9]{64}$' and runtime_valid_until is not null));

create function lean_private.journey_runtime_policy(p_config text default null)
returns lean_private.journey_policies language plpgsql security definer
set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies; token text;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'journey runtime requires read committed';
  end if;
  select * into p from lean_private.journey_policies
    where project_ref='xnfjdbpjuaezxjgargto' and shop='mullybox-store.myshopify.com'
      and posthog_project='353503' and policy_version='reserve-runtime-v1' for share;
  if not found or not p.enabled or p.runtime_capture_key_sha256 is null
    or p.runtime_valid_until is null or p.runtime_valid_until<=clock_timestamp()
    then raise exception 'journey runtime unavailable'; end if;
  token:=md5(jsonb_build_array(p.project_ref,p.shop,p.posthog_project,p.policy_version,
    p.approval_ref,p.ttl_seconds,p.runtime_capture_key_sha256,
    to_char(p.runtime_valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text);
  if p_config is not null and p_config<>token then raise exception 'journey runtime changed'; end if;
  return p;
end $$;

create function public.lean_journey_runtime_config()
returns jsonb language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies; token text;
begin
  -- A missing/disabled/expired row is normal. Other errors remain errors.
  if not exists(select 1 from lean_private.journey_policies where
    project_ref='xnfjdbpjuaezxjgargto' and shop='mullybox-store.myshopify.com'
    and posthog_project='353503' and policy_version='reserve-runtime-v1'
    and enabled and runtime_capture_key_sha256 is not null and runtime_valid_until>clock_timestamp())
    then return null; end if;
  p:=lean_private.journey_runtime_policy();
  token:=md5(jsonb_build_array(p.project_ref,p.shop,p.posthog_project,p.policy_version,
    p.approval_ref,p.ttl_seconds,p.runtime_capture_key_sha256,
    to_char(p.runtime_valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text);
  return jsonb_build_object('policyVersion',p.policy_version,'approvalRef',p.approval_ref,
    'ttlSeconds',p.ttl_seconds,'captureKeySha256',p.runtime_capture_key_sha256,
    'validUntil',to_char(p.runtime_valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'configToken',token);
end $$;

create function lean_private.journey_runtime_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies; g lean_private.journey_grants;
begin
  if tg_table_name='journey_grants' then g:=new;
  else select * into g from lean_private.journey_grants where token_hash=new.grant_hash; end if;
  if g.permission_evidence_ref not like 'explicit-browser-choice:reserve-runtime-v1:%' then return new; end if;
  if tg_table_name in ('checkout_receipts','draft_receipts') then
    raise exception 'journey runtime checkout bridge not approved';
  end if;
  p:=lean_private.journey_runtime_policy();
  if g.project_ref<>p.project_ref or g.shop<>p.shop or g.posthog_project<>p.posthog_project
    or g.approval_ref<>p.approval_ref
    or g.permission_evidence_ref<>'explicit-browser-choice:'||p.policy_version||':'||g.subject_id
    then raise exception 'journey runtime grant mismatch'; end if;
  if tg_table_name='journey_actions' then
    if new.family not in ('lean_reserve_started','lean_reserve_reveal','lean_reserve_checkout')
      then raise exception 'journey runtime family not approved'; end if;
  end if;
  return new;
end $$;
-- These narrow guards also cover calls through the old service-role RPCs.
-- Unmarked existing grants and actions retain their previous behavior.
create trigger journey_runtime_grant_guard before insert on lean_private.journey_grants
for each row execute function lean_private.journey_runtime_guard();
create trigger journey_runtime_action_guard before insert on lean_private.journey_actions
for each row execute function lean_private.journey_runtime_guard();
create trigger journey_runtime_cart_guard before insert on lean_private.checkout_receipts
for each row execute function lean_private.journey_runtime_guard();
create trigger journey_runtime_draft_guard before insert on lean_private.draft_receipts
for each row execute function lean_private.journey_runtime_guard();

create function public.lean_journey_runtime_issue(p_config text,p_token_hash text,p_subject text,p_session uuid,p_uid text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies;
begin
  if p_config is null then raise exception 'journey runtime config required'; end if;
  p:=lean_private.journey_runtime_policy(p_config);
  return public.lean_journey_issue(p.project_ref,p.shop,p.posthog_project,p.policy_version,
    p_token_hash,p_subject,p_session,p_uid);
end $$;

create function public.lean_journey_runtime_grant(p_config text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies; g lean_private.journey_grants;
begin
  if p_config is null then raise exception 'journey runtime config required'; end if;
  p:=lean_private.journey_runtime_policy(p_config);
  select * into g from lean_private.journey_grants where token_hash=p_token_hash;
  if not found or g.approval_ref<>p.approval_ref or
    g.permission_evidence_ref<>'explicit-browser-choice:'||p.policy_version||':'||g.subject_id
    then return null; end if;
  return public.lean_journey_grant(p.project_ref,p.shop,p_token_hash);
end $$;

create function public.lean_journey_runtime_action(p_config text,p_token_hash text,p_action uuid,p_family text)
returns timestamptz language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies;
begin
  if public.lean_journey_runtime_grant(p_config,p_token_hash) is null then return null; end if;
  p:=lean_private.journey_runtime_policy(p_config);
  if p_family is null or p_family not in
    ('lean_reserve_started','lean_reserve_reveal','lean_reserve_checkout')
    then raise exception 'journey runtime family not approved'; end if;
  return public.lean_journey_action(p.project_ref,p.shop,p_token_hash,p_action,p_family);
end $$;

revoke all on function lean_private.journey_runtime_policy(text),lean_private.journey_runtime_guard(),
  public.lean_journey_runtime_config(),public.lean_journey_runtime_issue(text,text,text,uuid,text),
  public.lean_journey_runtime_grant(text,text),public.lean_journey_runtime_action(text,text,uuid,text)
  from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_journey_runtime_config(),public.lean_journey_runtime_issue(text,text,text,uuid,text),
  public.lean_journey_runtime_grant(text,text),public.lean_journey_runtime_action(text,text,uuid,text) to service_role;
do $$
declare r text; f record;
begin
  foreach r in array array['anon','authenticated','service_role','lean_posthog_reader'] loop
    if exists(select 1 from pg_roles where rolname=r and rolsuper)
      or has_table_privilege(r,'lean_private.journey_policies','INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
      or has_any_column_privilege(r,'lean_private.journey_policies','INSERT,UPDATE')
      then raise exception 'journey runtime unsafe effective role: %',r; end if;
    for f in select p.oid,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where p.proname like '%journey_runtime_%' and n.nspname in ('public','lean_private') loop
      if (r<>'service_role' or f.nspname='lean_private') and has_function_privilege(r,f.oid,'execute')
        then raise exception 'journey runtime unsafe effective execute: %',r; end if;
    end loop;
  end loop;
end $$;
commit;
