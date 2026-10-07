-- REVIEW ONLY. No policy row, enabled flag, grant or source data is installed.
begin;
set local statement_timeout='15s';
set local lock_timeout='2s';
do $$ begin
  perform pg_advisory_xact_lock(hashtextextended('lean:source-session-runtime-v3:install',0));
  if current_setting('transaction_isolation')<>'read committed'
    or to_regprocedure('public.lean_journey_checkout_config()') is null then
    raise exception 'source-session prerequisites unavailable'; end if;
  if exists(select 1 from lean_private.journey_policies where policy_version='source-session-runtime-v3') then
    raise exception 'reserved source-session policy already used'; end if;
end $$;

alter table lean_private.journey_policies
  add column source_session_enabled boolean not null default false,
  add column source_session_valid_until timestamptz,
  add column source_session_webhook_sha256 text,
  add column source_session_read_sha256 text,
  add constraint source_session_policy_shape check (
    (not source_session_enabled and source_session_valid_until is null and source_session_webhook_sha256 is null and source_session_read_sha256 is null) or
    (source_session_enabled and policy_version='source-session-runtime-v3'
      and project_ref='xnfjdbpjuaezxjgargto' and shop='mullybox-store.myshopify.com'
      and posthog_project='353503' and source_session_valid_until is not null
      and source_session_webhook_sha256 is not null and source_session_webhook_sha256 ~ '^[a-f0-9]{64}$'
      and source_session_read_sha256 is not null and source_session_read_sha256 ~ '^[a-f0-9]{64}$'));

create table lean_private.source_session_receipts (
  native_session_id uuid primary key,
  grant_hash text not null references lean_private.journey_grants(token_hash),
  source_entry_uuid uuid not null,
  source_started_at timestamptz not null,
  source_ended_at timestamptz not null check(source_ended_at>=source_started_at),
  source_read_sha256 text not null check(source_read_sha256 ~ '^[a-f0-9]{64}$'),
  filter_sha256 text not null check(filter_sha256='61504f7e32de2ff2d4197a26e25ba57f412891b9c03e6d27b3ef7568e3829819'),
  filter_results jsonb not null check(jsonb_typeof(filter_results)='array' and jsonb_array_length(filter_results)=6),
  paid_link_until timestamptz not null check(paid_link_until=source_started_at+interval '216 hours'),
  captured_at timestamptz not null default clock_timestamp(),
  conflicted_at timestamptz
);
create table lean_private.source_session_cart_receipts (
  cart_token text primary key check(cart_token ~ '^[A-Za-z0-9_-]{1,200}$'),
  native_session_id uuid not null references lean_private.source_session_receipts(native_session_id),
  grant_hash text not null references lean_private.journey_grants(token_hash),
  context_token text not null check(length(context_token) between 50 and 3000),
  captured_at timestamptz not null default clock_timestamp(),
  conflicted_at timestamptz
);
alter table lean_private.source_session_receipts enable row level security;
alter table lean_private.source_session_cart_receipts enable row level security;
revoke all on lean_private.source_session_receipts,lean_private.source_session_cart_receipts
  from public,anon,authenticated,service_role,lean_posthog_reader;

create function lean_private.source_session_policy(p_config text default null)
returns lean_private.journey_policies language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies; token text;
begin
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'source isolation'; end if;
  select * into p from lean_private.journey_policies where project_ref='xnfjdbpjuaezxjgargto'
    and shop='mullybox-store.myshopify.com' and posthog_project='353503'
    and policy_version='source-session-runtime-v3' for share;
  if not found or not p.enabled or not p.source_session_enabled
    or p.source_session_valid_until<=clock_timestamp() then raise exception 'source policy unavailable'; end if;
  token:=md5(jsonb_build_array(p.project_ref,p.shop,p.posthog_project,p.policy_version,
    p.approval_ref,p.ttl_seconds,p.source_session_enabled,p.source_session_webhook_sha256,p.source_session_read_sha256,
    to_char(p.source_session_valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text);
  if p_config is not null and p_config<>token then raise exception 'source policy changed'; end if;
  return p;
end $$;

create function public.lean_source_session_config()
returns jsonb language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies;
begin
  if not exists(select 1 from lean_private.journey_policies where policy_version='source-session-runtime-v3'
    and enabled and source_session_enabled and source_session_valid_until>clock_timestamp()) then return null; end if;
  p:=lean_private.source_session_policy();
  return jsonb_build_object('policyVersion',p.policy_version,'approvalRef',p.approval_ref,'ttlSeconds',p.ttl_seconds,
    'webhookKeySha256',p.source_session_webhook_sha256,
    'sourceReadKeySha256',p.source_session_read_sha256,
    'validUntil',to_char(p.source_session_valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'configToken',md5(jsonb_build_array(p.project_ref,p.shop,p.posthog_project,p.policy_version,
      p.approval_ref,p.ttl_seconds,p.source_session_enabled,p.source_session_webhook_sha256,p.source_session_read_sha256,
      to_char(p.source_session_valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text));
end $$;

create function lean_private.source_session_grant(p_config text,p_token_hash text)
returns lean_private.journey_grants language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies; g lean_private.journey_grants;
begin
  if p_config is null then raise exception 'source config required'; end if;
  p:=lean_private.source_session_policy(p_config);
  select * into g from lean_private.journey_grants where token_hash=p_token_hash for share;
  if not found or g.project_ref<>p.project_ref or g.shop<>p.shop or g.posthog_project<>p.posthog_project
    or g.permission_evidence_ref<>'explicit-browser-choice:'||p.policy_version||':'||g.subject_id
    or g.approval_ref<>p.approval_ref or g.firebase_uid is not null or g.revoked_at is not null
    or g.valid_from>clock_timestamp() or g.expires_at<=clock_timestamp()
    or exists(select 1 from lean_private.journey_removals where token_hash=g.token_hash) then
    raise exception 'source grant unavailable'; end if;
  return g;
end $$;

create function lean_private.source_session_old_lane_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare g lean_private.journey_grants; p lean_private.journey_policies;
begin
  if tg_table_name='journey_grants' then g:=new;
  else select * into g from lean_private.journey_grants where token_hash=new.grant_hash; end if;
  if g.permission_evidence_ref not like 'explicit-browser-choice:source-session-runtime-v3:%' then return new; end if;
  if tg_table_name<>'journey_grants' then raise exception 'source policy cannot use legacy collection'; end if;
  p:=lean_private.source_session_policy();
  if g.project_ref<>p.project_ref or g.shop<>p.shop or g.posthog_project<>p.posthog_project
    or g.approval_ref<>p.approval_ref or g.firebase_uid is not null
    or g.permission_evidence_ref<>'explicit-browser-choice:'||p.policy_version||':'||g.subject_id then
    raise exception 'source grant scope'; end if;
  return new;
end $$;
create trigger source_grant_guard before insert on lean_private.journey_grants
  for each row execute function lean_private.source_session_old_lane_guard();
create trigger source_action_guard before insert on lean_private.journey_actions
  for each row execute function lean_private.source_session_old_lane_guard();
create trigger source_legacy_cart_guard before insert on lean_private.checkout_receipts
  for each row execute function lean_private.source_session_old_lane_guard();
create trigger source_draft_guard before insert on lean_private.draft_receipts
  for each row execute function lean_private.source_session_old_lane_guard();

create function public.lean_source_session_issue(p_config text,p_token_hash text,p_subject text,p_session uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies;
begin
  if p_config is null then raise exception 'source config required'; end if;
  p:=lean_private.source_session_policy(p_config);
  return public.lean_journey_issue(p.project_ref,p.shop,p.posthog_project,p.policy_version,
    p_token_hash,p_subject,p_session,null);
end $$;
create function lean_private.source_session_receipt_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies; g lean_private.journey_grants;
begin
  p:=lean_private.source_session_policy();
  g:=lean_private.source_session_grant(public.lean_source_session_config()->>'configToken',new.grant_hash);
  if new.captured_at<g.valid_from or new.captured_at>=g.expires_at or new.captured_at>clock_timestamp()
    or new.captured_at>=p.source_session_valid_until then raise exception 'source receipt clock'; end if;
  return new;
end $$;
create trigger source_binding_clock before insert on lean_private.source_session_receipts
  for each row execute function lean_private.source_session_receipt_guard();
create trigger source_cart_clock before insert on lean_private.source_session_cart_receipts
  for each row execute function lean_private.source_session_receipt_guard();
create function public.lean_source_session_grant(p_config text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare g lean_private.journey_grants;
begin
  g:=lean_private.source_session_grant(p_config,p_token_hash);
  return public.lean_journey_grant(g.project_ref,g.shop,g.token_hash) || jsonb_build_object(
    'validFrom',to_char(g.valid_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'expiresAt',to_char(g.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end $$;
create function public.lean_source_session_bind(p_config text,p_token_hash text,p_native uuid,
  p_entry uuid,p_started timestamptz,p_ended timestamptz,p_read_digest text,p_filters jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare g lean_private.journey_grants; prior lean_private.source_session_receipts;
begin
  g:=lean_private.source_session_grant(p_config,p_token_hash);
  if p_native is null or p_entry is null or p_started is null or p_ended is null or
    p_started<g.valid_from or p_started>=g.expires_at or p_ended<p_started or p_ended>clock_timestamp()
    or p_read_digest is null or p_read_digest !~ '^[a-f0-9]{64}$' or p_filters is null
    or jsonb_typeof(p_filters)<>'array' or jsonb_array_length(p_filters)<>6
    or exists(select 1 from jsonb_array_elements(p_filters) x where jsonb_typeof(x) not in ('boolean','null'))
    then raise exception 'native session proof required'; end if;
  insert into lean_private.source_session_receipts(native_session_id,grant_hash,source_entry_uuid,
    source_started_at,source_ended_at,source_read_sha256,filter_sha256,filter_results,paid_link_until)
    values(p_native,g.token_hash,p_entry,p_started,p_ended,p_read_digest,
      '61504f7e32de2ff2d4197a26e25ba57f412891b9c03e6d27b3ef7568e3829819',p_filters,p_started+interval '216 hours') on conflict do nothing;
  select * into prior from lean_private.source_session_receipts where native_session_id=p_native for update;
  if prior.grant_hash<>g.token_hash or prior.source_entry_uuid<>p_entry or prior.source_started_at<>p_started then
    update lean_private.source_session_receipts set conflicted_at=coalesce(conflicted_at,clock_timestamp())
      where native_session_id=p_native;
    return false;
  end if;
  return prior.conflicted_at is null;
end $$;

create function public.lean_source_session_existing(p_config text,p_token_hash text,p_native uuid)
returns text language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare g lean_private.journey_grants; prior lean_private.source_session_receipts;
begin
  g:=lean_private.source_session_grant(p_config,p_token_hash);
  select * into prior from lean_private.source_session_receipts where native_session_id=p_native for update;
  if not found then return 'missing'; end if;
  if prior.grant_hash<>g.token_hash then
    update lean_private.source_session_receipts set conflicted_at=coalesce(conflicted_at,clock_timestamp()) where native_session_id=p_native;
    return 'conflict';
  end if;
  if prior.conflicted_at is not null then return 'conflict'; end if;
  return 'verified';
end $$;

create function lean_private.source_session_immutable_receipt()
returns trigger language plpgsql security definer set search_path=pg_catalog,lean_private as $$
begin
  if to_jsonb(new)-'conflicted_at' is distinct from to_jsonb(old)-'conflicted_at'
    or old.conflicted_at is not null and new.conflicted_at is distinct from old.conflicted_at then
    raise exception 'source receipt is immutable'; end if;
  return new;
end $$;
create trigger source_binding_immutable before update on lean_private.source_session_receipts
  for each row execute function lean_private.source_session_immutable_receipt();
create trigger source_cart_immutable before update on lean_private.source_session_cart_receipts
  for each row execute function lean_private.source_session_immutable_receipt();
create function public.lean_source_session_cart(p_config text,p_token_hash text,p_native uuid,p_cart text,p_context text)
returns boolean language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare g lean_private.journey_grants; binding lean_private.source_session_receipts;
  prior lean_private.source_session_cart_receipts;
begin
  g:=lean_private.source_session_grant(p_config,p_token_hash);
  select * into binding from lean_private.source_session_receipts where native_session_id=p_native for share;
  if not found or binding.grant_hash<>g.token_hash or binding.conflicted_at is not null then return false; end if;
  if p_cart is null or p_cart !~ '^[A-Za-z0-9_-]{1,200}$' or p_context is null
    or length(p_context) not between 50 and 3000 then raise exception 'source cart shape'; end if;
  insert into lean_private.source_session_cart_receipts(cart_token,native_session_id,grant_hash,context_token)
    values(p_cart,p_native,g.token_hash,p_context) on conflict do nothing;
  select * into prior from lean_private.source_session_cart_receipts where cart_token=p_cart for update;
  if prior.grant_hash<>g.token_hash or prior.native_session_id<>p_native then
    update lean_private.source_session_cart_receipts set conflicted_at=coalesce(conflicted_at,clock_timestamp()) where cart_token=p_cart;
    return false;
  end if;
  return prior.conflicted_at is null;
end $$;

-- Fixed project/shop source. This is not an admission or completeness flag.
create function public.lean_source_session_receipts_read(p_from timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,lean_private as $$
begin
  if p_from is null or p_until is null or p_until<=p_from or p_until>statement_timestamp()
    or p_until-p_from>interval '31 days' then raise exception 'source receipt read scope'; end if;
  return (select coalesce(jsonb_agg(v),'[]'::jsonb) from (
    select jsonb_build_object('nativeSessionId',r.native_session_id,
      'capturedAt',to_char(r.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'entryUuid',r.source_entry_uuid,'sourceReadSha256',r.source_read_sha256,
      'filterSha256',r.filter_sha256,'filterResults',r.filter_results,
      'sourceStartedAt',to_char(r.source_started_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'paidLinkUntil',to_char(r.paid_link_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'conflicted',r.conflicted_at is not null,'subjectId',g.subject_id,
      'permissionEvidenceRef',g.permission_evidence_ref,'approvalRef',g.approval_ref,
      'validFrom',to_char(g.valid_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'expiresAt',to_char(g.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'removed',g.revoked_at is not null or exists(select 1 from lean_private.journey_removals m where m.token_hash=g.token_hash)) v
    from lean_private.source_session_receipts r join lean_private.journey_grants g on g.token_hash=r.grant_hash
    where g.project_ref='xnfjdbpjuaezxjgargto' and g.shop='mullybox-store.myshopify.com' and g.posthog_project='353503'
      and g.valid_from<p_until and g.expires_at>p_from
    order by r.native_session_id limit 10001
  ) bounded);
end $$;
revoke all on function lean_private.source_session_policy(text),lean_private.source_session_grant(text,text),
  lean_private.source_session_old_lane_guard(),lean_private.source_session_receipt_guard(),lean_private.source_session_immutable_receipt(),public.lean_source_session_config(),
  public.lean_source_session_issue(text,text,text,uuid),public.lean_source_session_grant(text,text),
  public.lean_source_session_bind(text,text,uuid,uuid,timestamptz,timestamptz,text,jsonb),
  public.lean_source_session_existing(text,text,uuid),public.lean_source_session_cart(text,text,uuid,text,text),
  public.lean_source_session_receipts_read(timestamptz,timestamptz)
  from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_source_session_config(),public.lean_source_session_issue(text,text,text,uuid),
  public.lean_source_session_grant(text,text),public.lean_source_session_bind(text,text,uuid,uuid,timestamptz,timestamptz,text,jsonb),
  public.lean_source_session_existing(text,text,uuid),
  public.lean_source_session_cart(text,text,uuid,text,text),public.lean_source_session_receipts_read(timestamptz,timestamptz)
  to service_role;
commit;
