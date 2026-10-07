-- REVIEW ONLY. Additive successor; no policy, key, grant or event is installed.
-- Keep proposed_journey_runtime_policy.sql and every v1 function unchanged.
begin;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
do $$
declare r record;
begin
  perform pg_advisory_xact_lock(hashtextextended('lean:reserve-cart-runtime-v2:install',0));
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'checkout installation requires read committed';
  end if;
  if to_regprocedure('public.lean_journey_runtime_config()') is null
    or to_regprocedure('lean_private.journey_runtime_guard()') is null then
    raise exception 'Reserve v1 installation required';
  end if;
  for r in select * from (values
    ('public.lean_journey_issue(text,text,text,text,text,text,uuid,text)','a067597b9ef5b675eac418fd7666f103'),
    ('public.lean_journey_grant(text,text,text)','7eaf1e9796a94d3d00e139dc3fec0315'),
    ('public.lean_journey_action(text,text,text,uuid,text)','cc14bc31a58aefe2a2b420764bb1447d'),
    ('public.lean_journey_withdraw(text,text,text)','0aeeb56f015ca90f2f69a390e2b0796c'),
    ('public.lean_checkout_receipt(text,text,text,text,text)','407032c559b62f88bb8463319ff66818'),
    ('lean_private.journey_runtime_guard()','09e7ed1fe929458e78056d76af823c0a')
  ) pins(signature,body_hash) loop
    if not exists(select 1 from pg_proc where oid=to_regprocedure(r.signature)
      and md5(prosrc)=r.body_hash and prosecdef) then
      raise exception 'checkout dependency mismatch: %',r.signature;
    end if;
  end loop;
  if exists(select 1 from information_schema.columns where table_schema='lean_private'
      and table_name='journey_policies' and column_name like 'checkout_%')
    or exists(select 1 from pg_proc where proname like 'lean_journey_checkout_%'
      or proname like 'journey_checkout_%') then
    raise exception 'checkout footprint already present or partial';
  end if;
  if exists(select 1 from lean_private.journey_policies where policy_version='reserve-cart-runtime-v2')
    or exists(select 1 from lean_private.journey_grants
      where permission_evidence_ref like 'explicit-browser-choice:reserve-cart-runtime-v2:%') then
    raise exception 'reserved checkout policy already used';
  end if;
end $$;

alter table lean_private.journey_policies
  add column checkout_enabled boolean not null default false,
  add column checkout_capture_key_sha256 text,
  add column checkout_valid_until timestamptz,
  add constraint journey_checkout_config_shape check (
    (not checkout_enabled and checkout_capture_key_sha256 is null and checkout_valid_until is null)
    or (policy_version='reserve-cart-runtime-v2' and project_ref='xnfjdbpjuaezxjgargto'
      and shop='mullybox-store.myshopify.com' and posthog_project='353503'
      and checkout_capture_key_sha256 is not null
      and checkout_capture_key_sha256 ~ '^[a-f0-9]{64}$' and checkout_valid_until is not null));

create function lean_private.journey_checkout_policy(p_config text default null)
returns lean_private.journey_policies language plpgsql security definer
set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies; token text;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'checkout runtime requires read committed';
  end if;
  select * into p from lean_private.journey_policies
    where project_ref='xnfjdbpjuaezxjgargto' and shop='mullybox-store.myshopify.com'
      and posthog_project='353503' and policy_version='reserve-cart-runtime-v2' for share;
  if not found or not p.enabled or not p.checkout_enabled
    or p.checkout_capture_key_sha256 is null or p.checkout_valid_until is null
    or p.checkout_valid_until<=clock_timestamp() then raise exception 'checkout policy unavailable'; end if;
  token:=md5(jsonb_build_array(p.project_ref,p.shop,p.posthog_project,p.policy_version,
    p.approval_ref,p.ttl_seconds,p.checkout_enabled,p.checkout_capture_key_sha256,
    to_char(p.checkout_valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text);
  if p_config is not null and p_config<>token then raise exception 'checkout policy changed'; end if;
  return p;
end $$;

create function public.lean_journey_checkout_config()
returns jsonb language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies; token text;
begin
  if not exists(select 1 from lean_private.journey_policies where
    project_ref='xnfjdbpjuaezxjgargto' and shop='mullybox-store.myshopify.com'
    and posthog_project='353503' and policy_version='reserve-cart-runtime-v2'
    and enabled and checkout_enabled and checkout_capture_key_sha256 is not null
    and checkout_valid_until>clock_timestamp()) then return null; end if;
  p:=lean_private.journey_checkout_policy();
  token:=md5(jsonb_build_array(p.project_ref,p.shop,p.posthog_project,p.policy_version,
    p.approval_ref,p.ttl_seconds,p.checkout_enabled,p.checkout_capture_key_sha256,
    to_char(p.checkout_valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text);
  return jsonb_build_object('policyVersion',p.policy_version,'approvalRef',p.approval_ref,
    'ttlSeconds',p.ttl_seconds,'captureKeySha256',p.checkout_capture_key_sha256,
    'validUntil',to_char(p.checkout_valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'configToken',token);
end $$;

create function lean_private.journey_checkout_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies; g lean_private.journey_grants;
begin
  if tg_table_name='journey_grants' then g:=new;
  else select * into g from lean_private.journey_grants where token_hash=new.grant_hash; end if;
  if g.permission_evidence_ref not like 'explicit-browser-choice:reserve-cart-runtime-v2:%' then return new; end if;
  p:=lean_private.journey_checkout_policy();
  if g.project_ref<>p.project_ref or g.shop<>p.shop or g.posthog_project<>p.posthog_project
    or g.approval_ref<>p.approval_ref
    or g.permission_evidence_ref<>'explicit-browser-choice:'||p.policy_version||':'||g.subject_id
    or g.revoked_at is not null or g.valid_from>clock_timestamp() or g.expires_at<=clock_timestamp()
    or exists(select 1 from lean_private.journey_removals where token_hash=g.token_hash) then
    raise exception 'checkout grant mismatch';
  end if;
  if tg_table_name='journey_actions' then
    if new.family not in ('lean_reserve_started','lean_reserve_reveal','lean_reserve_checkout') then
      raise exception 'checkout family not approved';
    end if;
  end if;
  if tg_table_name='draft_receipts' then raise exception 'checkout draft capability denied'; end if;
  if tg_table_name='checkout_receipts' then
    if new.project_ref<>p.project_ref or new.shop<>p.shop
      or new.captured_at<g.valid_from or new.captured_at>=g.expires_at
      or new.captured_at>=p.checkout_valid_until or new.captured_at>clock_timestamp() then
      raise exception 'checkout receipt mismatch';
    end if;
  end if;
  return new;
end $$;
create trigger journey_checkout_grant_guard before insert on lean_private.journey_grants
for each row execute function lean_private.journey_checkout_guard();
create trigger journey_checkout_action_guard before insert on lean_private.journey_actions
for each row execute function lean_private.journey_checkout_guard();
create trigger journey_checkout_cart_guard before insert on lean_private.checkout_receipts
for each row execute function lean_private.journey_checkout_guard();
create trigger journey_checkout_draft_guard before insert on lean_private.draft_receipts
for each row execute function lean_private.journey_checkout_guard();

create function public.lean_journey_checkout_issue(p_config text,p_token_hash text,p_subject text,p_session uuid,p_uid text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies;
begin
  if p_config is null then raise exception 'checkout config required'; end if;
  p:=lean_private.journey_checkout_policy(p_config);
  return public.lean_journey_issue(p.project_ref,p.shop,p.posthog_project,p.policy_version,
    p_token_hash,p_subject,p_session,p_uid);
end $$;

create function public.lean_journey_checkout_grant(p_config text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies; g lean_private.journey_grants;
begin
  if p_config is null then raise exception 'checkout config required'; end if;
  p:=lean_private.journey_checkout_policy(p_config);
  select * into g from lean_private.journey_grants where token_hash=p_token_hash for share;
  if not found or g.project_ref<>p.project_ref or g.shop<>p.shop or g.posthog_project<>p.posthog_project
    or g.approval_ref<>p.approval_ref
    or g.permission_evidence_ref<>'explicit-browser-choice:'||p.policy_version||':'||g.subject_id
    or exists(select 1 from lean_private.journey_removals where token_hash=g.token_hash) then return null; end if;
  return public.lean_journey_grant(p.project_ref,p.shop,p_token_hash);
end $$;

create function public.lean_journey_checkout_action(p_config text,p_token_hash text,p_action uuid,p_family text)
returns timestamptz language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies;
begin
  if public.lean_journey_checkout_grant(p_config,p_token_hash) is null then return null; end if;
  p:=lean_private.journey_checkout_policy(p_config);
  if p_family is null or p_family not in
    ('lean_reserve_started','lean_reserve_reveal','lean_reserve_checkout') then
    raise exception 'checkout family not approved';
  end if;
  return public.lean_journey_action(p.project_ref,p.shop,p_token_hash,p_action,p_family);
end $$;

create function public.lean_journey_checkout_receipt(p_config text,p_token_hash text,p_cart text,p_context text)
returns boolean language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies;
begin
  if public.lean_journey_checkout_grant(p_config,p_token_hash) is null then return false; end if;
  p:=lean_private.journey_checkout_policy(p_config);
  return public.lean_checkout_receipt(p.project_ref,p.shop,p_token_hash,p_cart,p_context);
end $$;

revoke all on function lean_private.journey_checkout_policy(text),lean_private.journey_checkout_guard(),
  public.lean_journey_checkout_config(),public.lean_journey_checkout_issue(text,text,text,uuid,text),
  public.lean_journey_checkout_grant(text,text),public.lean_journey_checkout_action(text,text,uuid,text),
  public.lean_journey_checkout_receipt(text,text,text,text)
  from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_journey_checkout_config(),
  public.lean_journey_checkout_issue(text,text,text,uuid,text),public.lean_journey_checkout_grant(text,text),
  public.lean_journey_checkout_action(text,text,uuid,text),public.lean_journey_checkout_receipt(text,text,text,text)
  to service_role;
do $$
declare r text; f record;
begin
  foreach r in array array['anon','authenticated','service_role','lean_posthog_reader'] loop
    if exists(select 1 from pg_roles where rolname=r and rolsuper)
      or has_table_privilege(r,'lean_private.journey_policies','INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
      or has_any_column_privilege(r,'lean_private.journey_policies','INSERT,UPDATE') then
      raise exception 'checkout unsafe effective policy privilege';
    end if;
    for f in select p.oid,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where p.proname like 'lean_journey_checkout_%' or p.proname like 'journey_checkout_%' loop
      if (r<>'service_role' or f.nspname='lean_private') and has_function_privilege(r,f.oid,'execute') then
        raise exception 'checkout unsafe effective execute';
      end if;
    end loop;
  end loop;
end $$;
commit;
