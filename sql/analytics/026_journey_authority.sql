-- REVIEW ONLY. No migration is applied by application startup.
-- This is an integration boundary for the approved analytics-permission
-- authority, not a replacement for or inference from marketing consent.
begin;
create table lean_private.journey_grants (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  project_ref text not null check (project_ref ~ '^[a-z]{20}$'),
  posthog_project text not null,
  shop text not null,
  subject_id text not null check(subject_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  session_id uuid not null,
  firebase_uid text,
  valid_from timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  permission_evidence_ref text not null check (length(permission_evidence_ref) between 1 and 512),
  approval_ref text not null check (length(approval_ref) between 1 and 512),
  check (expires_at > valid_from and expires_at <= valid_from + interval '24 hours'),
  check (revoked_at is null or revoked_at >= valid_from)
);
create unique index journey_subject_scope on lean_private.journey_grants(project_ref,shop,posthog_project,subject_id);
alter table lean_private.journey_grants enable row level security;
create table lean_private.checkout_receipts (
  project_ref text not null,
  shop text not null,
  cart_token text not null,
  grant_hash text not null references lean_private.journey_grants(token_hash),
  context_token text not null check (length(context_token) <= 3000),
  captured_at timestamptz not null default clock_timestamp(),
  primary key(project_ref,shop,cart_token)
);
alter table lean_private.checkout_receipts enable row level security;
revoke all on lean_private.journey_grants, lean_private.checkout_receipts from public, anon, authenticated, service_role;

create function public.lean_journey_grant(p_project text,p_shop text,p_token_hash text)
returns jsonb language sql stable security definer set search_path=pg_catalog,lean_private as $$
  select jsonb_build_object('projectRef',project_ref,'posthogProject',posthog_project,
    'shop',shop,'subjectId',subject_id,'sessionId',session_id,'firebaseUid',firebase_uid,
    'validFrom',valid_from,'expiresAt',expires_at,'permissionEvidenceRef',permission_evidence_ref)
  from lean_private.journey_grants
  where project_ref=p_project and shop=p_shop and token_hash=p_token_hash
    and valid_from<=statement_timestamp() and expires_at>statement_timestamp()
    and revoked_at is null
$$;
create function public.lean_checkout_receipt(p_project text,p_shop text,p_token_hash text,p_cart text,p_context text)
returns boolean language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare g lean_private.journey_grants; prior lean_private.checkout_receipts;
begin
  select * into g from lean_private.journey_grants
    where token_hash=p_token_hash and project_ref=p_project and shop=p_shop for share;
  if not found or g.revoked_at is not null or g.valid_from>clock_timestamp() or g.expires_at<=clock_timestamp()
    then return false; end if;
  if p_cart !~ '^[A-Za-z0-9_-]{1,200}$' or length(p_context)>3000 or length(p_context)<50
    then raise exception 'invalid checkout context'; end if;
  insert into lean_private.checkout_receipts(project_ref,shop,cart_token,grant_hash,context_token)
    values(p_project,p_shop,p_cart,p_token_hash,p_context) on conflict do nothing;
  select * into prior from lean_private.checkout_receipts
    where project_ref=p_project and shop=p_shop and cart_token=p_cart;
  -- A reused cart cannot silently change session or replace an earlier token.
  return prior.grant_hash=p_token_hash;
end $$;
create table lean_private.journey_actions (
  grant_hash text not null references lean_private.journey_grants(token_hash),
  action_id uuid not null,
  family text not null check (family ~ '^lean_[a-z_]+$'),
  occurred_at timestamptz not null default clock_timestamp(),
  primary key(grant_hash,action_id,family)
);
alter table lean_private.journey_actions enable row level security;
revoke all on lean_private.journey_actions from public,anon,authenticated,service_role;
create function public.lean_journey_action(p_project text,p_shop text,p_token_hash text,p_action uuid,p_family text)
returns timestamptz language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare g lean_private.journey_grants; occurred timestamptz;
begin
  select * into g from lean_private.journey_grants
    where token_hash=p_token_hash and project_ref=p_project and shop=p_shop for share;
  if not found or g.revoked_at is not null or g.valid_from>clock_timestamp() or g.expires_at<=clock_timestamp()
    then return null; end if;
  insert into lean_private.journey_actions(grant_hash,action_id,family)
    values(p_token_hash,p_action,p_family) on conflict do nothing;
  select occurred_at into occurred from lean_private.journey_actions
    where grant_hash=p_token_hash and action_id=p_action and family=p_family;
  return occurred;
end $$;
revoke all on function public.lean_journey_grant(text,text,text),
  public.lean_checkout_receipt(text,text,text,text,text),
  public.lean_journey_action(text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.lean_journey_grant(text,text,text),
  public.lean_checkout_receipt(text,text,text,text,text),
  public.lean_journey_action(text,text,text,uuid,text) to service_role;
-- Runtime cannot create, extend, revoke or backdate grants. The approved
-- permission authority/operator owns imports and withdrawal/erasure handling.
create function public.lean_checkout_receipts_read(p_project text,p_shop text,p_carts text[])
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,lean_private as $$
begin
  if p_carts is null or cardinality(p_carts)>100 or exists(
    select 1 from unnest(p_carts) c where c is null or c !~ '^[A-Za-z0-9_-]{1,200}$')
    then raise exception 'invalid receipt read scope'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'cartToken',r.cart_token,'contextToken',r.context_token,'capturedAt',r.captured_at,
    'subjectId',g.subject_id,'sessionId',g.session_id,'posthogProject',g.posthog_project,
    'validFrom',g.valid_from,'expiresAt',g.expires_at,'revokedAt',g.revoked_at,
    'permissionEvidenceRef',g.permission_evidence_ref) order by r.cart_token),'[]'::jsonb)
    from lean_private.checkout_receipts r join lean_private.journey_grants g on g.token_hash=r.grant_hash
    where r.project_ref=p_project and r.shop=p_shop and r.cart_token=any(p_carts)
      and g.project_ref=p_project and g.shop=p_shop);
end $$;
revoke all on function public.lean_checkout_receipts_read(text,text,text[]) from public,anon,authenticated;
grant execute on function public.lean_checkout_receipts_read(text,text,text[]) to service_role;
create function public.lean_journey_permissions_read(p_project text,p_shop text,p_posthog text,
  p_from timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,lean_private as $$
begin
  if p_from is null or p_until is null or p_until<=p_from or p_until>statement_timestamp()
    or p_until-p_from>interval '93 days' then raise exception 'invalid permission window'; end if;
  -- LIMIT+1 lets the caller detect overflow rather than claim complete coverage.
  return (select coalesce(jsonb_agg(jsonb_build_object('subjectId',subject_id,'validFrom',valid_from,
    'expiresAt',expires_at,'revokedAt',revoked_at,'permissionEvidenceRef',permission_evidence_ref)
    order by subject_id),'[]'::jsonb) from (
      select * from lean_private.journey_grants where project_ref=p_project and shop=p_shop
        and posthog_project=p_posthog and valid_from<p_until and expires_at>p_from
      order by subject_id limit 10001
    ) bounded);
end $$;
revoke all on function public.lean_journey_permissions_read(text,text,text,timestamptz,timestamptz)
  from public,anon,authenticated;
grant execute on function public.lean_journey_permissions_read(text,text,text,timestamptz,timestamptz) to service_role;
commit;
