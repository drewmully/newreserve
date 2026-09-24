-- REVIEW ONLY. Installs no enabled policy and makes no customer decision.
begin;
create table lean_private.journey_policies (
  project_ref text not null check(project_ref ~ '^[a-z]{20}$'),
  shop text not null,
  posthog_project text not null,
  policy_version text not null check(length(policy_version) between 1 and 128),
  approval_ref text not null check(length(trim(approval_ref)) between 1 and 512),
  ttl_seconds integer not null check(ttl_seconds between 60 and 86400),
  enabled boolean not null default false,
  primary key(project_ref,shop,policy_version)
);
create table lean_private.journey_removals (
  token_hash text primary key references lean_private.journey_grants(token_hash),
  requested_at timestamptz not null default clock_timestamp(),
  -- Never call a local revoke a completed downstream deletion.
  downstream_verified_at timestamptz,
  downstream_evidence_ref text,
  check((downstream_verified_at is null)=(downstream_evidence_ref is null))
);
alter table lean_private.journey_policies enable row level security;
alter table lean_private.journey_removals enable row level security;
revoke all on lean_private.journey_policies,lean_private.journey_removals
  from public,anon,authenticated,service_role,lean_posthog_reader;

create function public.lean_journey_issue(p_project text,p_shop text,p_posthog text,p_policy text,
  p_token_hash text,p_subject text,p_session uuid,p_uid text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies; at_time timestamptz := clock_timestamp(); g lean_private.journey_grants;
begin
  select * into p from lean_private.journey_policies where project_ref=p_project and shop=p_shop
    and policy_version=p_policy and posthog_project=p_posthog and enabled for share;
  if not found then raise exception 'permission policy unavailable'; end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or
    p_subject is null or p_subject !~ '^[a-f0-9]{64}$' or p_session is null or
    (p_uid is not null and length(p_uid) not between 1 and 128)
    then raise exception 'invalid permission decision'; end if;
  insert into lean_private.journey_grants(token_hash,project_ref,shop,posthog_project,subject_id,
    session_id,firebase_uid,valid_from,expires_at,permission_evidence_ref,approval_ref)
  values(p_token_hash,p_project,p_shop,p_posthog,p_subject,p_session,p_uid,at_time,
    at_time+make_interval(secs=>p.ttl_seconds),'explicit-browser-choice:'||p_policy||':'||p_subject,p.approval_ref)
  on conflict do nothing;
  select * into g from lean_private.journey_grants where token_hash=p_token_hash;
  if g.project_ref is distinct from p_project or g.shop is distinct from p_shop or
    g.posthog_project is distinct from p_posthog or g.subject_id is distinct from p_subject or
    g.session_id is distinct from p_session or g.firebase_uid is distinct from p_uid or
    g.revoked_at is not null or g.expires_at<=at_time then raise exception 'permission conflict'; end if;
  return jsonb_build_object('expiresAt',g.expires_at);
end $$;

create function public.lean_journey_withdraw(p_project text,p_shop text,p_token_hash text)
returns boolean language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare g lean_private.journey_grants; t text;
begin
  select * into g from lean_private.journey_grants
    where token_hash=p_token_hash and project_ref=p_project and shop=p_shop for update;
  if not found then return true; end if;
  if g.revoked_at is not null then return true; end if;
  update lean_private.journey_grants set revoked_at=clock_timestamp() where token_hash=p_token_hash;
  insert into lean_private.journey_removals(token_hash) values(p_token_hash) on conflict do nothing;
  -- Conservative privacy fence: a selected aggregate can contain this subject.
  -- Stop serving every current export before acknowledging withdrawal. Rebuild
  -- with fresh permission evidence before an operator can select it again.
  lock table lean_private.selected_publications in exclusive mode;
  delete from lean_private.selected_publications;
  foreach t in array array['store_daily','product_daily','acquisition_daily','customer_cohorts','funnel_daily'] loop
    execute format('delete from lean_export.%I',t);
  end loop;
  return true;
end $$;

-- A pending privacy removal also prevents replaying an old certified snapshot.
-- These guards cover both full and scoped selection/export entry points.
create function lean_private.guard_journey_selection() returns trigger
language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare vintage timestamptz;
begin
  select (policy->>'asOf')::timestamptz into vintage from lean_private.full_builds
    where 'full:'||run_id=new.publication_id;
  if exists(select 1 from lean_private.journey_removals where
    downstream_verified_at is null or vintage is null or requested_at>vintage)
    then raise exception 'privacy removal requires fresh rebuild and downstream verification'; end if;
  return new;
end $$;
create trigger journey_selection_guard before insert or update on lean_private.selected_publications
for each row execute function lean_private.guard_journey_selection();
create trigger journey_export_guard before insert on lean_private.export_audit
for each row execute function lean_private.guard_journey_selection();
revoke all on function public.lean_journey_issue(text,text,text,text,text,text,uuid,text),
  public.lean_journey_withdraw(text,text,text),lean_private.guard_journey_selection()
  from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_journey_issue(text,text,text,text,text,text,uuid,text),
  public.lean_journey_withdraw(text,text,text) to service_role;
commit;
