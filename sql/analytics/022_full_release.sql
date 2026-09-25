-- Operator-only release. Rollback uses the existing selected-publication CAS.
-- NO runtime/public grant. No invocation here.
begin;
create function public.lean_full_release(p_run text,p_project_ref text,p_expected_previous jsonb,
  p_approval text,p_reconciliation text,p_actor text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.full_builds; pub text; v_domain text; previous text;
  domains text[] := array['store_daily','product_daily','acquisition_daily','customer_cohorts','funnel_daily'];
begin
  if p_approval is null or length(trim(p_approval))=0 or p_reconciliation is null or length(trim(p_reconciliation))=0 or
    p_actor is null or length(trim(p_actor))=0 or p_expected_previous is null or
    jsonb_typeof(p_expected_previous)<>'object' or not(p_expected_previous ?& domains) or
    (select count(*) from jsonb_object_keys(p_expected_previous))<>5 then raise exception 'release review required'; end if;
  select * into r from lean_private.full_builds where run_id=p_run and project_ref=p_project_ref for update;
  if not found or not r.enabled or r.completed_at is null then raise exception 'full build not complete'; end if;
  pub := 'full:'||p_run;
  perform 1 from lean_private.publications where publication_id=pub and state='candidate' for update;
  if not found then raise exception 'candidate required'; end if;
  -- Review must cover the complete output, not just a single successful metric.
  if jsonb_typeof(r.manifest->'gates') is distinct from 'array' or jsonb_array_length(r.manifest->'gates')=0 or
    exists(select 1 from jsonb_array_elements(r.manifest->'gates') d
      cross join unnest(array['ledger','cash','orders','purchase','customers','spend','attribution','behavior','productAllocation']) k
      where d->'gates'->k is distinct from 'true'::jsonb) then raise exception 'incomplete full coverage'; end if;
  lock table lean_private.selected_publications in exclusive mode;
  foreach v_domain in array domains loop
    select publication_id into previous from lean_private.selected_publications where domain=v_domain;
    if previous is distinct from p_expected_previous->>v_domain then raise exception 'selection changed; re-read before retry'; end if;
    insert into lean_private.certifications(publication_id,domain,evidence_ref,source_reconciliation_ref,approved_by)
      values(pub,v_domain,p_approval,p_reconciliation,p_actor);
    execute format('update lean_private.%I set is_stale=false,readiness=(
      select jsonb_object_agg(k,case when v=''observed_unverified'' then ''ready'' else v end)
      from jsonb_each_text(readiness) as e(k,v)) where publication_id=$1','report_'||v_domain) using pub;
  end loop;
  update lean_private.publications set state='certified',evidence_ref=p_approval where publication_id=pub;
  foreach v_domain in array domains loop
    perform public.lean_select_publication(v_domain,pub,p_expected_previous->>v_domain,p_approval);
  end loop;
end $$;
revoke all on function public.lean_full_release(text,text,jsonb,text,text,text) from public,anon,authenticated,service_role;
commit;
