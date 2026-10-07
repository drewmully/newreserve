-- PRIVATE REVIEW. No claim, credential, enabled flag or visitor authority.
begin;
set local statement_timeout='15s';
set local lock_timeout='2s';
create table lean_private.source_session_setup_claims (
  claim_id uuid primary key,
  auth_sha256 text not null unique check(auth_sha256 ~ '^[a-f0-9]{64}$'),
  project_ref text not null check(project_ref='xnfjdbpjuaezxjgargto'),
  posthog_project text not null check(posthog_project='353503'),
  native_session_id uuid not null,
  source_from timestamptz not null check(source_from='2026-10-01T04:00:00Z'),
  source_until timestamptz not null check(source_until='2026-10-02T04:00:00Z'),
  filter_sha256 text not null check(filter_sha256='61504f7e32de2ff2d4197a26e25ba57f412891b9c03e6d27b3ef7568e3829819'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null check(isfinite(expires_at) and expires_at>created_at and expires_at<=created_at+interval '1 hour'),
  revoked_at timestamptz check(revoked_at is null or revoked_at>=created_at)
);
create table lean_private.source_session_setup_attempts (
  claim_id uuid primary key references lean_private.source_session_setup_claims,
  attempt_id uuid not null unique,
  started_at timestamptz not null default clock_timestamp()
);
create table lean_private.source_session_setup_proofs (
  claim_id uuid primary key references lean_private.source_session_setup_attempts,
  attempt_id uuid not null unique,
  key_sha256 text not null check(key_sha256 ~ '^[a-f0-9]{64}$'),
  source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
  filter_results jsonb not null check(filter_results='[true,true,true,true,true,true]'::jsonb),
  captured_at timestamptz not null default clock_timestamp()
);
create table lean_private.source_session_setup_copies (
  claim_id uuid primary key references lean_private.source_session_setup_proofs,
  matched boolean not null,
  captured_at timestamptz not null default clock_timestamp()
);
alter table lean_private.source_session_setup_claims enable row level security;
alter table lean_private.source_session_setup_attempts enable row level security;
alter table lean_private.source_session_setup_proofs enable row level security;
alter table lean_private.source_session_setup_copies enable row level security;
revoke all on lean_private.source_session_setup_claims,lean_private.source_session_setup_attempts,
  lean_private.source_session_setup_proofs,lean_private.source_session_setup_copies
  from public,anon,authenticated,service_role,lean_posthog_reader;

create function lean_private.source_session_setup_immutable()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' then raise exception 'setup evidence immutable'; end if;
  if tg_table_name<>'source_session_setup_claims' or
    to_jsonb(new)-'revoked_at' is distinct from to_jsonb(old)-'revoked_at' or
    old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'setup evidence immutable'; end if;
  return new;
end $$;
create trigger source_setup_claim_immutable before update or delete on lean_private.source_session_setup_claims
  for each row execute function lean_private.source_session_setup_immutable();
create trigger source_setup_attempt_immutable before update or delete on lean_private.source_session_setup_attempts
  for each row execute function lean_private.source_session_setup_immutable();
create trigger source_setup_proof_immutable before update or delete on lean_private.source_session_setup_proofs
  for each row execute function lean_private.source_session_setup_immutable();
create trigger source_setup_copy_immutable before update or delete on lean_private.source_session_setup_copies
  for each row execute function lean_private.source_session_setup_immutable();

create function lean_private.source_session_setup_authority(p_claim uuid,p_auth text)
returns lean_private.source_session_setup_claims language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare c lean_private.source_session_setup_claims;
begin
  if current_setting('transaction_isolation')<>'read committed' or p_auth is null
    or p_auth !~ '^[a-f0-9]{64}$' then raise exception 'setup unavailable'; end if;
  select * into c from lean_private.source_session_setup_claims where claim_id=p_claim for update;
  if not found or c.auth_sha256<>p_auth or c.revoked_at is not null
    or c.created_at>clock_timestamp() or c.expires_at<=clock_timestamp() then raise exception 'setup unavailable'; end if;
  return c;
end $$;
create function public.lean_source_session_setup_begin(p_claim uuid,p_auth text,p_attempt uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare c lean_private.source_session_setup_claims;
begin
  c:=lean_private.source_session_setup_authority(p_claim,p_auth);
  if p_attempt is null then raise exception 'setup unavailable'; end if;
  insert into lean_private.source_session_setup_attempts(claim_id,attempt_id) values(c.claim_id,p_attempt)
    on conflict do nothing;
  if not found then return null; end if;
  -- This committed claim is spent even if HTTP delivery fails or is ambiguous.
  return jsonb_build_object('nativeSessionId',c.native_session_id,'filterSha256',c.filter_sha256,
    'from',to_char(c.source_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'until',to_char(c.source_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'expiresAt',to_char(c.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end $$;
create function public.lean_source_session_setup_finish(p_claim uuid,p_auth text,p_attempt uuid,
  p_key text,p_source text,p_filters jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare c lean_private.source_session_setup_claims; proof lean_private.source_session_setup_proofs;
begin
  c:=lean_private.source_session_setup_authority(p_claim,p_auth);
  if p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_source is null or p_source !~ '^[a-f0-9]{64}$'
    or p_filters is distinct from '[true,true,true,true,true,true]'::jsonb
    or not exists(select 1 from lean_private.source_session_setup_attempts a where a.claim_id=c.claim_id and a.attempt_id=p_attempt)
    then raise exception 'setup unavailable'; end if;
  insert into lean_private.source_session_setup_proofs(claim_id,attempt_id,key_sha256,source_sha256,filter_results)
    values(c.claim_id,p_attempt,p_key,p_source,p_filters) on conflict do nothing;
  if not found then return null; end if;
  select * into proof from lean_private.source_session_setup_proofs where claim_id=c.claim_id;
  if proof.captured_at>=c.expires_at or clock_timestamp()>=c.expires_at then raise exception 'setup expired'; end if;
  return jsonb_build_object('state','verified','phase','source','project',c.posthog_project,
    'keySha256',proof.key_sha256,'projectionSha256',proof.source_sha256,'filterResults',proof.filter_results,
    'capturedAt',to_char(proof.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'expiresAt',to_char(c.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end $$;
create function public.lean_source_session_setup_copy(p_claim uuid,p_auth text,p_key text,p_project text,p_filters text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare c lean_private.source_session_setup_claims; proof lean_private.source_session_setup_proofs;
  copied lean_private.source_session_setup_copies;
begin
  c:=lean_private.source_session_setup_authority(p_claim,p_auth);
  select * into proof from lean_private.source_session_setup_proofs where claim_id=c.claim_id;
  if not found then return null; end if;
  insert into lean_private.source_session_setup_copies(claim_id,matched)
    values(c.claim_id,coalesce(p_key=proof.key_sha256 and p_project=c.posthog_project and p_filters=c.filter_sha256,false))
    on conflict do nothing;
  if not found then return null; end if;
  select * into copied from lean_private.source_session_setup_copies where claim_id=c.claim_id;
  if copied.captured_at>=c.expires_at or clock_timestamp()>=c.expires_at then raise exception 'setup expired'; end if;
  if not copied.matched then return jsonb_build_object('state','unavailable','phase','copy'); end if;
  return jsonb_build_object('state','verified','phase','copy','project',c.posthog_project,
    'keySha256',proof.key_sha256,'projectionSha256',proof.source_sha256,'filterResults',proof.filter_results,
    'capturedAt',to_char(copied.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'expiresAt',to_char(c.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end $$;
revoke all on function lean_private.source_session_setup_immutable(),lean_private.source_session_setup_authority(uuid,text),
  public.lean_source_session_setup_begin(uuid,text,uuid),public.lean_source_session_setup_finish(uuid,text,uuid,text,text,jsonb),
  public.lean_source_session_setup_copy(uuid,text,text,text,text) from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_source_session_setup_begin(uuid,text,uuid),
  public.lean_source_session_setup_finish(uuid,text,uuid,text,text,jsonb),public.lean_source_session_setup_copy(uuid,text,text,text,text) to service_role;
commit;
