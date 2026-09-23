-- REVIEW ONLY. Saved dependency traversal; no job registration or scheduler.
begin;
create function public.lean_full_next(p_run text,p_project_ref text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.full_builds; b lean_private.report_builds;
  h lean_private.history_jobs; s lean_private.spend_jobs;
  id text; next_history text; next_spend text; pages integer := 0; rows integer := 0;
begin
  select * into r from lean_private.full_builds where run_id=p_run and project_ref=p_project_ref;
  if not found then raise exception 'unapproved full target'; end if;
  if not r.enabled then return jsonb_build_object('state','disabled'); end if;
  if r.completed_at is not null then return jsonb_build_object('state','complete'); end if;
  select * into b from lean_private.report_builds where run_id=r.base_run and project_ref=r.project_ref;
  if not found or not b.enabled then return jsonb_build_object('state','blocked'); end if;
  if b.completed_at is not null then return jsonb_build_object('state','ready','stage','full','runId',r.run_id); end if;
  if cardinality(b.history_runs)<>(select count(distinct x) from unnest(b.history_runs) x) or
     cardinality(b.spend_runs)<>(select count(distinct x) from unnest(b.spend_runs) x)
    then raise exception 'duplicate source run'; end if;
  -- Validate the whole dependency inventory before issuing any external read.
  foreach id in array b.history_runs loop
    select * into h from lean_private.history_jobs where run_id=id and project_ref=r.project_ref and shop=b.shop;
    if not found or not h.enabled then return jsonb_build_object('state','blocked'); end if;
    pages := pages+h.max_pages; rows := rows+h.max_pages*h.page_size;
    if pages>25 or rows>100 then return jsonb_build_object('state','blocked'); end if;
    if not h.complete and next_history is null then next_history := id; end if;
  end loop;
  foreach id in array b.spend_runs loop
    select * into s from lean_private.spend_jobs where run_id=id and project_ref=r.project_ref
      and report_date between b.from_date and b.through_date;
    if not found or not s.enabled then return jsonb_build_object('state','blocked'); end if;
    if s.base is null and next_spend is null then next_spend := id; end if;
  end loop;
  if next_history is not null then
    return jsonb_build_object('state','ready','stage','history','runId',next_history,'shop',b.shop);
  elsif next_spend is not null then
    return jsonb_build_object('state','ready','stage','spend','runId',next_spend);
  else return jsonb_build_object('state','ready','stage','reports','runId',b.run_id);
  end if;
end $$;
revoke all on function public.lean_full_next(text,text) from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_full_next(text,text) to service_role;
commit;
