-- REVIEW ONLY. No source, schedule or job is enabled by this migration.
-- JSON timestamp text must not depend on the database session timezone: the
-- bounded source readers accept only canonical UTC evidence timestamps.
begin;
create or replace function public.lean_checkout_receipts_read(p_project text,p_shop text,p_carts text[])
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,lean_private as $$
begin
  if p_carts is null or cardinality(p_carts)>100 or exists(
    select 1 from unnest(p_carts) c where c is null or c !~ '^[A-Za-z0-9_-]{1,200}$')
    then raise exception 'invalid receipt read scope'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'cartToken',r.cart_token,'contextToken',r.context_token,
    'capturedAt',to_char(r.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'subjectId',g.subject_id,'sessionId',g.session_id,'posthogProject',g.posthog_project,
    'validFrom',to_char(g.valid_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'expiresAt',to_char(g.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'revokedAt',to_char(g.revoked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'permissionEvidenceRef',g.permission_evidence_ref) order by r.cart_token),'[]'::jsonb)
    from lean_private.checkout_receipts r join lean_private.journey_grants g on g.token_hash=r.grant_hash
    where r.project_ref=p_project and r.shop=p_shop and r.cart_token=any(p_carts)
      and g.project_ref=p_project and g.shop=p_shop);
end $$;

create or replace function public.lean_journey_permissions_read(p_project text,p_shop text,p_posthog text,
  p_from timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,lean_private as $$
begin
  if p_from is null or p_until is null or p_until<=p_from or p_until>statement_timestamp()
    or p_until-p_from>interval '93 days' then raise exception 'invalid permission window'; end if;
  -- LIMIT+1 lets the caller detect overflow rather than claim complete coverage.
  return (select coalesce(jsonb_agg(jsonb_build_object('subjectId',subject_id,
    'validFrom',to_char(valid_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'expiresAt',to_char(expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'revokedAt',to_char(revoked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'permissionEvidenceRef',permission_evidence_ref) order by subject_id),'[]'::jsonb) from (
      select * from lean_private.journey_grants where project_ref=p_project and shop=p_shop
        and posthog_project=p_posthog and valid_from<p_until and expires_at>p_from
      order by subject_id limit 10001
    ) bounded);
end $$;

create or replace function public.lean_draft_receipts_read(p_project text,p_shop text,p_from timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,lean_private as $$
begin
  if p_from is null or p_until is null or p_until<=p_from or p_until>statement_timestamp() or
    p_until-p_from>interval '93 days' then raise exception 'invalid draft receipt scope'; end if;
  return (select coalesce(jsonb_agg(v),'[]'::jsonb) from (
    select jsonb_build_object('draftId',r.draft_id,'cartToken','draft_'||r.draft_id,
      'contextToken',r.context_token,
      'capturedAt',to_char(r.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'subjectId',g.subject_id,'sessionId',g.session_id,'posthogProject',g.posthog_project,
      'validFrom',to_char(g.valid_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'expiresAt',to_char(g.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'revokedAt',to_char(coalesce(g.revoked_at,r.conflicted_at) at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'permissionEvidenceRef',g.permission_evidence_ref) v
    from lean_private.draft_receipts r join lean_private.journey_grants g on r.grant_hash=g.token_hash
    where r.project_ref=p_project and r.shop=p_shop and g.project_ref=p_project and g.shop=p_shop
      and r.captured_at>=p_from and r.captured_at<p_until
    order by r.draft_id limit 101
  ) bounded);
end $$;

revoke all on function public.lean_checkout_receipts_read(text,text,text[]),
  public.lean_journey_permissions_read(text,text,text,timestamptz,timestamptz),
  public.lean_draft_receipts_read(text,text,timestamptz,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.lean_checkout_receipts_read(text,text,text[]),
  public.lean_journey_permissions_read(text,text,text,timestamptz,timestamptz),
  public.lean_draft_receipts_read(text,text,timestamptz,timestamptz) to service_role;
commit;
