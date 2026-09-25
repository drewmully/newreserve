-- REVIEW ONLY. No pointer is selected, role provisioned or importer activated.
begin;
create table lean_private.certifications (
  publication_id text not null references lean_private.publications,
  domain text not null check(domain in ('store_daily','acquisition_daily','product_daily','customer_cohorts','funnel_daily')),
  evidence_ref text not null check(length(evidence_ref)>0),
  source_reconciliation_ref text not null check(length(source_reconciliation_ref)>0),
  approved_by text not null check(length(approved_by)>0),
  primary key(publication_id,domain)
);
create table lean_private.selected_publications (
  domain text primary key,
  publication_id text not null,
  is_stale boolean not null default false,
  foreign key(publication_id,domain) references lean_private.certifications
);
create table lean_private.publication_audit (
  audit_id bigint generated always as identity primary key,
  domain text not null, previous_publication text, selected_publication text not null,
  approval_ref text not null, changed_at timestamptz not null default now()
);
revoke all on lean_private.certifications,lean_private.selected_publications,lean_private.publication_audit from public;
create function lean_private.guard_candidate() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare old_id text; new_id text; state_value text;
begin
  if TG_OP <> 'INSERT' then old_id=old.publication_id; end if;
  if TG_OP <> 'DELETE' then new_id=new.publication_id; end if;
  -- Hold a row lock until the fact-write transaction commits. Certification
  -- must not race a writer that observed the previous candidate state.
  if old_id is not null then
    select state into state_value from lean_private.publications where publication_id=old_id for share;
    if state_value is distinct from 'candidate' then raise exception 'publication is immutable'; end if;
  end if;
  if new_id is not null and new_id is distinct from old_id then
    select state into state_value from lean_private.publications where publication_id=new_id for share;
    if state_value is distinct from 'candidate' then raise exception 'publication is immutable'; end if;
  end if;
  if TG_OP='DELETE' then return old; else return new; end if;
end $$;
create function lean_private.guard_publication_state() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if old.state <> 'candidate' then raise exception 'publication is immutable'; end if;
  if TG_OP='DELETE' then return old; else return new; end if;
end $$;
create trigger immutable_publication before update or delete on lean_private.publications
for each row execute function lean_private.guard_publication_state();
create trigger candidate_only before insert or update or delete on lean_private.certifications
for each row execute function lean_private.guard_candidate();
create trigger candidate_only before insert or update or delete on lean_private.coverage
for each row execute function lean_private.guard_candidate();
create function public.lean_select_publication(p_domain text,p_publication text,p_expected_previous text,p_approval text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare previous text;
begin
  if p_approval is null or length(trim(p_approval))=0 then raise exception 'approval required'; end if;
  -- Also serializes initial selections where there is no row to lock yet.
  lock table lean_private.selected_publications in exclusive mode;
  select publication_id into previous from lean_private.selected_publications where domain=p_domain;
  if previous is distinct from p_expected_previous then raise exception 'selection changed; re-read before retry'; end if;
  if not exists (
    select 1 from lean_private.certifications c join lean_private.publications p using(publication_id)
    where c.domain=p_domain and c.publication_id=p_publication and p.state='certified'
  ) then raise exception 'uncertified publication'; end if;
  insert into lean_private.selected_publications(domain,publication_id,is_stale) values(p_domain,p_publication,false)
    on conflict(domain) do update set publication_id=excluded.publication_id,is_stale=false;
  insert into lean_private.publication_audit(domain,previous_publication,selected_publication,approval_ref)
    values(p_domain,previous,p_publication,p_approval);
end $$;
create function public.lean_mark_publication_stale(p_domain text)
returns void language sql security definer set search_path=pg_catalog as $$
  update lean_private.selected_publications set is_stale=true where domain=p_domain
$$;
revoke all on function public.lean_select_publication(text,text,text,text) from public;
revoke all on function public.lean_mark_publication_stale(text) from public;
-- Per-role Supabase defaults survive a PUBLIC revoke. Close them even when
-- this schema-only installation does not include the later 017 pipeline.
revoke all on function public.lean_select_publication(text,text,text,text) from service_role;
revoke all on function public.lean_mark_publication_stale(text) from service_role;
do $$
declare role_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on function public.lean_select_publication(text,text,text,text) from %I',role_name);
      execute format('revoke all on function public.lean_mark_publication_stale(text) from %I',role_name);
    end if;
  end loop;
end $$;
-- No runtime grant for certifying/selecting publications. Explicit approved operator only.
grant execute on function public.lean_mark_publication_stale(text) to service_role;
commit;
