-- Owner-run repair after 013, including schema-only or existing full installs.
-- Only these two function ACLs change. No facts, pointers, defaults or jobs.
begin;
revoke all on function public.lean_select_publication(text,text,text,text) from public,service_role;
revoke all on function public.lean_mark_publication_stale(text) from public,service_role;
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
-- Preserve the existing service-role stale marker, never publication selection.
grant execute on function public.lean_mark_publication_stale(text) to service_role;
commit;
