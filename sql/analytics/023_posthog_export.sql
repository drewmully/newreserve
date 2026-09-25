-- REVIEW ONLY. Apply after 022. A NOLOGIN reader is intentionally unusable until
-- a separately approved operator provisions its credential and source connection.
begin;
create schema lean_export;
revoke all on schema lean_export from public,anon,authenticated,service_role;
create role lean_posthog_reader nologin nosuperuser nocreatedb nocreaterole
  noinherit noreplication nobypassrls;
grant usage on schema lean_export to lean_posthog_reader;
do $$
declare t text;
begin
  foreach t in array array['store_daily','product_daily','acquisition_daily','customer_cohorts','funnel_daily'] loop
    execute format('create table lean_export.%I (like lean_private.%I including defaults including constraints including indexes)',
      t,'report_'||t);
    execute format('revoke all on lean_export.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on lean_export.%I to lean_posthog_reader',t);
  end loop;
end $$;
create table lean_private.export_audit (
  export_id bigint generated always as identity primary key,
  publication_id text not null references lean_private.publications,
  exported_at timestamptz not null default clock_timestamp(),
  approval_ref text not null, actor_ref text not null, row_counts jsonb not null
);
alter table lean_private.export_audit enable row level security;
revoke all on lean_private.export_audit from public,anon,authenticated,service_role,lean_posthog_reader;
create function public.lean_full_export(p_run text,p_project_ref text,p_approval text,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.full_builds; pub text; t text; n bigint; counts jsonb := '{}';
  domains text[] := array['store_daily','product_daily','acquisition_daily','customer_cohorts','funnel_daily'];
begin
  if p_approval is null or length(trim(p_approval))=0 or p_actor is null or length(trim(p_actor))=0
    then raise exception 'export review required'; end if;
  select * into r from lean_private.full_builds where run_id=p_run and project_ref=p_project_ref for share;
  if not found or not r.enabled or r.completed_at is null then raise exception 'full build not complete'; end if;
  pub := 'full:'||p_run;
  lock table lean_private.selected_publications in share mode;
  perform 1 from lean_private.publications where publication_id=pub and state='certified' for share;
  if not found or (select count(*) from lean_private.selected_publications
      where domain=any(domains) and publication_id=pub)<>5 then raise exception 'full selection required'; end if;
  -- Serialize the entire export, not one table at a time. MVCC readers see an old
  -- or new committed snapshot; never a partially written table. PostHog imports
  -- still need a cross-table publication-id readback before customer use.
  lock table lean_private.export_audit in exclusive mode;
  foreach t in array domains loop
    execute format('delete from lean_export.%I',t);
    execute format('insert into lean_export.%I select * from lean_analytics.%I where publication_id=$1',t,t) using pub;
    get diagnostics n = row_count;
    counts := counts || jsonb_build_object(t,n);
  end loop;
  insert into lean_private.export_audit(publication_id,approval_ref,actor_ref,row_counts)
    values(pub,p_approval,p_actor,counts);
  return counts;
end $$;
revoke all on function public.lean_full_export(text,text,text,text)
  from public,anon,authenticated,service_role,lean_posthog_reader;
commit;
