-- REVIEW ONLY. Server-side proof from an authenticated, successful checkout.
begin;
create table lean_private.draft_receipts (
  project_ref text not null, shop text not null,
  draft_id text not null check(draft_id ~ '^[1-9][0-9]*$'),
  grant_hash text not null references lean_private.journey_grants(token_hash),
  context_token text not null check(length(context_token) between 50 and 3000),
  captured_at timestamptz not null default clock_timestamp(),
  conflicted_at timestamptz,
  primary key(project_ref,shop,draft_id)
);
alter table lean_private.draft_receipts enable row level security;
revoke all on lean_private.draft_receipts from public,anon,authenticated,service_role,lean_posthog_reader;
create function public.lean_draft_receipt(p_project text,p_shop text,p_token_hash text,p_draft text,p_context text)
returns boolean language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare g lean_private.journey_grants; prior lean_private.draft_receipts;
begin
  select * into g from lean_private.journey_grants where token_hash=p_token_hash and
    project_ref=p_project and shop=p_shop for share;
  if not found or g.revoked_at is not null or g.valid_from>clock_timestamp() or g.expires_at<=clock_timestamp()
    then return false; end if;
  insert into lean_private.draft_receipts(project_ref,shop,draft_id,grant_hash,context_token)
    values(p_project,p_shop,p_draft,p_token_hash,p_context) on conflict do nothing;
  select * into prior from lean_private.draft_receipts
    where project_ref=p_project and shop=p_shop and draft_id=p_draft for update;
  if prior.grant_hash<>p_token_hash then
    update lean_private.draft_receipts set conflicted_at=coalesce(conflicted_at,clock_timestamp())
      where project_ref=p_project and shop=p_shop and draft_id=p_draft;
    return false;
  end if;
  return prior.conflicted_at is null;
end $$;
create function public.lean_draft_receipts_read(p_project text,p_shop text,p_from timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,lean_private as $$
begin
  if p_from is null or p_until is null or p_until<=p_from or p_until>statement_timestamp() or
    p_until-p_from>interval '93 days' then raise exception 'invalid draft receipt scope'; end if;
  return (select coalesce(jsonb_agg(v),'[]'::jsonb) from (
    select jsonb_build_object('draftId',r.draft_id,'cartToken','draft_'||r.draft_id,
      'contextToken',r.context_token,'capturedAt',r.captured_at,'subjectId',g.subject_id,
      'sessionId',g.session_id,'posthogProject',g.posthog_project,'validFrom',g.valid_from,
      'expiresAt',g.expires_at,'revokedAt',coalesce(g.revoked_at,r.conflicted_at),
      'permissionEvidenceRef',g.permission_evidence_ref) v
    from lean_private.draft_receipts r join lean_private.journey_grants g on r.grant_hash=g.token_hash
    where r.project_ref=p_project and r.shop=p_shop and g.project_ref=p_project and g.shop=p_shop
      and r.captured_at>=p_from and r.captured_at<p_until
    order by r.draft_id limit 101
  ) bounded);
end $$;
revoke all on function public.lean_draft_receipt(text,text,text,text,text),
  public.lean_draft_receipts_read(text,text,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.lean_draft_receipt(text,text,text,text,text),
  public.lean_draft_receipts_read(text,text,timestamptz,timestamptz) to service_role;
commit;
