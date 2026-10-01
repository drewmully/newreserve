-- PRIVATE REVIEW ONLY. New dependency after 021-030, 034-038, 053 and
-- proposed_history_customer_source. Not an installer, activation or source binding.
-- Existing 021/053 bodies remain unchanged behind owner-only aliases.
begin;

create function lean_private.customer_generation_policy(p_policy jsonb,p_evidence jsonb)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare b jsonb := p_policy->'customerGeneration';
begin
  if p_evidence ? 'customerGeneration' then raise exception 'precomputed customer generation forbidden'; end if;
  if not(p_policy ? 'customerGeneration') then return null; end if;
  if jsonb_typeof(b) is distinct from 'object' or
    not(b ?& array['runId','generationHash','resultHash','authorityId','authorityRevision','authorityFingerprint']) or
    b-array['runId','generationHash','resultHash','authorityId','authorityRevision','authorityFingerprint']<>'{}' or
    exists(select 1 from jsonb_each(b) x where jsonb_typeof(x.value)<>'string' or
      length(trim(x.value#>>'{}')) not between 1 and 128) or
    b->>'runId' !~ '^[a-zA-Z0-9_-]{1,100}$' or
    b->>'generationHash' !~ '^[a-f0-9]{64}$' or b->>'resultHash' !~ '^[a-f0-9]{64}$' or
    b->>'authorityFingerprint' !~ '^[a-f0-9]{64}$' or b->>'authorityRevision' !~ '^[1-9][0-9]{0,18}$' or
    (b->>'authorityRevision')::numeric>9223372036854775807
    then raise exception 'invalid customer generation policy'; end if;
  return b;
end $$;
create function lean_private.customer_generation_registration_guard() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  perform lean_private.customer_generation_policy(new.policy,new.evidence);
  return new;
end $$;
create trigger customer_generation_registration_guard before insert on lean_private.full_builds
for each row execute function lean_private.customer_generation_registration_guard();

-- Caller locks serving selection before obtaining any authority/source locks.
-- p_sources=false checks immutable lineage and CURRENT privacy only. Pausing an
-- old financial collector does not become a privacy withdrawal of saved output.
create function lean_private.customer_generation_full_check(p_run text,p_project text,p_sources boolean)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare f lean_private.full_builds; base lean_private.report_builds;
  c lean_private.history_customer_runs; b jsonb; a jsonb;
begin
  select * into strict f from lean_private.full_builds where run_id=p_run and project_ref=p_project;
  b:=lean_private.customer_generation_policy(f.policy,f.evidence);
  if b is null then return null; end if;
  select * into strict base from lean_private.report_builds where run_id=f.base_run and project_ref=p_project;
  select * into strict c from lean_private.history_customer_runs where run_id=b->>'runId' for share;
  if c.state<>'complete' or c.result_hash is distinct from b->>'resultHash' or
    c.generation_hash is distinct from b->>'generationHash' or
    c.scope->>'projectRef' is distinct from p_project or c.scope->>'shop' is distinct from base.shop or
    c.scope#>>'{reporting,fromDate}' is distinct from base.from_date::text or
    c.scope#>>'{reporting,throughDate}' is distinct from base.through_date::text or
    c.scope#>>'{reporting,definition}' is distinct from f.policy->>'definition' or
    c.scope->>'mappingVersion' is distinct from f.policy->>'mappingVersion' or
    c.scope->>'asOf' is distinct from f.policy->>'asOf' or c.scope#>'{reporting,cohorts}' is distinct from f.policy->'cohorts' or
    c.scope->>'authorityId' is distinct from b->>'authorityId' or
    c.scope->>'authorityRevision' is distinct from b->>'authorityRevision' or
    c.scope->>'authorityFingerprint' is distinct from b->>'authorityFingerprint'
    then raise exception 'customer generation full binding mismatch'; end if;
  a:=lean_private.history_customer_current_authority(c.run_id);
  if p_sources and (not c.enabled or
    lean_private.history_customer_generation(c.run_id,false) is distinct from b->>'generationHash')
    then raise exception 'customer generation source unavailable'; end if;
  return a;
end $$;

alter function public.lean_full_inputs(text,text) rename to lean_full_inputs_before_customer_generation;
revoke all on function public.lean_full_inputs_before_customer_generation(text,text)
  from public,anon,authenticated,service_role,lean_posthog_reader;
create function public.lean_full_inputs(p_run text,p_project_ref text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare f lean_private.full_builds; b jsonb; input jsonb; derived jsonb; ids text[]; replacements jsonb;
begin
  select * into strict f from lean_private.full_builds where run_id=p_run and project_ref=p_project_ref;
  b:=lean_private.customer_generation_policy(f.policy,f.evidence);
  if b is null then return public.lean_full_inputs_before_customer_generation(p_run,p_project_ref); end if;
  lock table lean_private.selected_publications in share mode;
  perform lean_private.customer_generation_full_check(p_run,p_project_ref,true);
  input:=public.lean_full_inputs_before_customer_generation(p_run,p_project_ref);
  if input->>'state' is distinct from 'ready' then return input; end if;
  replacements:=input#>'{evidence,replacements}';
  if jsonb_typeof(replacements) is distinct from 'array' or jsonb_array_length(replacements)>100 or
    exists(select 1 from jsonb_array_elements(replacements) x where
      x#>>'{snapshot,shop}' is distinct from input->>'shop' or
      jsonb_typeof(x#>'{snapshot,id}') is distinct from 'string' or length(x#>>'{snapshot,id}')=0) or
    (select count(distinct x#>>'{snapshot,id}') from jsonb_array_elements(replacements) x)<>jsonb_array_length(replacements)
    then raise exception 'customer generation replacement scope'; end if;
  -- Match primitives.key(shop,id): compact JSON array, retaining string escapes.
  select coalesce(array_agg(id order by id),'{}') into ids from (
    select x->>'order_id' id from jsonb_array_elements(input#>'{facts,orders}') x
    union
    select encode(sha256(convert_to('['||to_json(input->>'shop')::text||','||
      to_json(x#>>'{snapshot,id}')::text||']','UTF8')),'hex')
      from jsonb_array_elements(replacements) x
  ) keys;
  derived:=lean_private.history_customer_report_input(b->>'runId',p_project_ref,
    (input->>'fromDate')::date,(input->>'throughDate')::date,f.policy,ids);
  if derived->>'runId' is distinct from b->>'runId' or
    derived->>'generationHash' is distinct from b->>'generationHash' or derived->>'resultHash' is distinct from b->>'resultHash' or
    derived#>>'{authority,authorityId}' is distinct from b->>'authorityId' or
    derived#>>'{authority,revision}' is distinct from b->>'authorityRevision' or
    derived#>>'{authority,fingerprint}' is distinct from b->>'authorityFingerprint' or
    derived->>'projectRef' is distinct from p_project_ref or derived->>'shop' is distinct from input->>'shop'
    then raise exception 'customer generation derived binding mismatch'; end if;
  input:=jsonb_set(input-'inputHash','{evidence,customerGeneration}',derived);
  if octet_length(input::text)>8000000 then raise exception 'full input budget'; end if;
  return input||jsonb_build_object('inputHash',md5(input::text));
end $$;

alter function public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb)
  rename to lean_full_finish_before_customer_generation;
revoke all on function public.lean_full_finish_before_customer_generation(text,text,uuid,text,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role,lean_posthog_reader;
create function public.lean_full_finish(p_run text,p_project_ref text,p_token uuid,p_input_hash text,
  p_facts jsonb,p_reports jsonb,p_manifest jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare f lean_private.full_builds; b jsonb; done boolean;
begin
  select * into f from lean_private.full_builds where run_id=p_run and project_ref=p_project_ref;
  if not found or not f.enabled then return false; end if;
  b:=lean_private.customer_generation_policy(f.policy,f.evidence);
  if b is not null then
    lock table lean_private.selected_publications in share mode;
    perform lean_private.customer_generation_full_check(p_run,p_project_ref,true);
  end if;
  -- This precheck precedes 021's completed-result idempotent return.
  done:=public.lean_full_finish_before_customer_generation(p_run,p_project_ref,p_token,p_input_hash,p_facts,p_reports,p_manifest);
  if done and b is not null then
    perform lean_private.customer_generation_full_check(p_run,p_project_ref,true);
  end if;
  return done;
end $$;

-- Both owner release entry points take selection first. Their original bodies
-- still perform all certification, CAS, metric readiness and privacy checks.
alter function public.lean_scoped_release(text,text,text[],jsonb,text,text,text)
  rename to lean_scoped_release_before_customer_generation;
revoke all on function public.lean_scoped_release_before_customer_generation(text,text,text[],jsonb,text,text,text)
  from public,anon,authenticated,service_role,lean_posthog_reader;
create function public.lean_scoped_release(p_run text,p_project_ref text,p_domains text[],p_expected_previous jsonb,
  p_approval text,p_reconciliation text,p_actor text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare affected boolean := p_domains&&array['store_daily','acquisition_daily','customer_cohorts'];
begin
  lock table lean_private.selected_publications in exclusive mode;
  if affected then perform lean_private.customer_generation_full_check(p_run,p_project_ref,true); end if;
  perform public.lean_scoped_release_before_customer_generation(p_run,p_project_ref,p_domains,
    p_expected_previous,p_approval,p_reconciliation,p_actor);
  if affected then perform lean_private.customer_generation_full_check(p_run,p_project_ref,true); end if;
end $$;
alter function public.lean_full_release(text,text,jsonb,text,text,text)
  rename to lean_full_release_before_customer_generation;
revoke all on function public.lean_full_release_before_customer_generation(text,text,jsonb,text,text,text)
  from public,anon,authenticated,service_role,lean_posthog_reader;
create function public.lean_full_release(p_run text,p_project_ref text,p_expected_previous jsonb,
  p_approval text,p_reconciliation text,p_actor text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  lock table lean_private.selected_publications in exclusive mode;
  perform lean_private.customer_generation_full_check(p_run,p_project_ref,true);
  perform public.lean_full_release_before_customer_generation(p_run,p_project_ref,p_expected_previous,
    p_approval,p_reconciliation,p_actor);
  perform lean_private.customer_generation_full_check(p_run,p_project_ref,true);
end $$;

-- Export must acquire selection before the original body locks full_builds.
-- Otherwise release(selection -> full_builds) and export(full_builds ->
-- selection) can deadlock. The audit trigger below still denies bound customer
-- resources, including selected zero-row exports, before any cache write commits.
alter function public.lean_scoped_export(text,text,text[],text,text)
  rename to lean_scoped_export_before_customer_generation;
revoke all on function public.lean_scoped_export_before_customer_generation(text,text,text[],text,text)
  from public,anon,authenticated,service_role,lean_posthog_reader;
create function public.lean_scoped_export(p_run text,p_project_ref text,p_domains text[],p_approval text,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
  lock table lean_private.selected_publications in share mode;
  return public.lean_scoped_export_before_customer_generation(p_run,p_project_ref,p_domains,p_approval,p_actor);
end $$;
alter function public.lean_full_export(text,text,text,text)
  rename to lean_full_export_before_customer_generation;
revoke all on function public.lean_full_export_before_customer_generation(text,text,text,text)
  from public,anon,authenticated,service_role,lean_posthog_reader;
create function public.lean_full_export(p_run text,p_project_ref text,p_approval text,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
  lock table lean_private.selected_publications in share mode;
  return public.lean_full_export_before_customer_generation(p_run,p_project_ref,p_approval,p_actor);
end $$;

create function lean_private.customer_generation_serving_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare f lean_private.full_builds;
begin
  if tg_table_name='selected_publications' then
    if new.domain not in ('store_daily','acquisition_daily','customer_cohorts') then return new; end if;
    -- Marking an unchanged selection stale only narrows its status. Do not
    -- re-admit a paused source for this conservative change. Clearing stale or
    -- changing the selected publication still takes the full admission checks.
    if tg_op='UPDATE' and new.domain=old.domain and new.publication_id=old.publication_id
      and new.is_stale then return new; end if;
  elsif not(new.row_counts ?| array['store_daily','acquisition_daily','customer_cohorts']) then return new;
  end if;
  select * into f from lean_private.full_builds where 'full:'||run_id=new.publication_id;
  if not found or not(f.policy ? 'customerGeneration') then return new; end if;
  -- A cached SQL023 export has no time-only authority fence. New bound customer
  -- domains use ONLY the canonical production reader, never this legacy cache.
  if tg_table_name='export_audit' then raise exception 'customer generation requires canonical delivery'; end if;
  perform lean_private.customer_generation_full_check(f.run_id,f.project_ref,true);
  return new;
end $$;
create trigger customer_generation_selection_guard before insert or update on lean_private.selected_publications
for each row execute function lean_private.customer_generation_serving_guard();
create trigger customer_generation_export_guard before insert on lean_private.export_audit
for each row execute function lean_private.customer_generation_serving_guard();

create function lean_private.customer_generation_authority_lock() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  -- BEFORE STATEMENT, before the authority row lock: consistent with selection.
  lock table lean_private.selected_publications in share row exclusive mode;
  return null;
end $$;
create trigger customer_generation_authority_lock before update or delete on lean_private.history_customer_authority
for each statement execute function lean_private.customer_generation_authority_lock();
create function lean_private.customer_generation_authority_invalidate() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare id text := old.authority_id; pubs text[]; t text; f lean_private.full_builds;
  invalid boolean; scope jsonb; now_at timestamptz;
begin
  -- A same-revision, still-valid independent reread need not discard selection.
  for f in select * from lean_private.full_builds where completed_at is not null and
    policy#>>'{customerGeneration,authorityId}'=id loop
    invalid:=tg_op='DELETE';
    if tg_op='UPDATE' then
      -- Scope is immutable. Do not take a source-run row lock while holding the
      -- updated authority row: source jobs lock their run before authority.
      select c.scope into scope from lean_private.history_customer_runs c
        where c.run_id=f.policy#>>'{customerGeneration,runId}';
      now_at:=clock_timestamp();
      invalid:=not found or not new.available or
        new.revision::text is distinct from f.policy#>>'{customerGeneration,authorityRevision}' or
        new.identity_permission_sha256 is distinct from f.policy#>>'{customerGeneration,authorityFingerprint}' or
        new.captured_at>now_at or new.captured_at<now_at-make_interval(secs=>new.max_age_seconds) or
        new.valid_until<=now_at or (scope->>'expiresAt')::timestamptz<=now_at or
        (scope->>'expiresAt')::timestamptz>new.valid_until;
    end if;
    if invalid then pubs:=array_append(pubs,'full:'||f.run_id); end if;
  end loop;
  delete from lean_private.selected_publications where publication_id=any(pubs) and
    domain in ('store_daily','acquisition_daily','customer_cohorts');
  foreach t in array array['store_daily','acquisition_daily','customer_cohorts'] loop
    execute format('delete from lean_export.%I where publication_id=any($1)',t) using pubs;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger customer_generation_authority_invalidate after update or delete on lean_private.history_customer_authority
for each row execute function lean_private.customer_generation_authority_invalidate();

alter function public.lean_production_workbook_reports_read(text)
  rename to lean_workbook_read_before_customer_generation;
revoke all on function public.lean_workbook_read_before_customer_generation(text)
  from public,anon,authenticated,service_role,lean_posthog_reader;
create function public.lean_production_workbook_reports_read(p_project_ref text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb; g lean_private.production_workbook_delivery; f lean_private.full_builds;
  valid boolean:=true; status jsonb; statuses jsonb:='[]'; readiness jsonb; t text;
begin
  lock table lean_private.selected_publications in share mode;
  select * into g from lean_private.production_workbook_delivery where singleton and enabled and project_ref=p_project_ref;
  if not found then return null; end if;
  select * into f from lean_private.full_builds where run_id=g.run_id and project_ref=p_project_ref;
  if found and f.policy ? 'customerGeneration' then
    begin
      perform lean_private.customer_generation_full_check(f.run_id,f.project_ref,false);
    exception when raise_exception then
      if sqlerrm<>'history customer current authority unavailable' then raise; end if;
      valid:=false;
    end;
  end if;
  result:=public.lean_workbook_read_before_customer_generation(p_project_ref);
  if result is null then return null; end if;
  if valid and f.policy ? 'customerGeneration' then
    begin
      perform lean_private.customer_generation_full_check(f.run_id,f.project_ref,false);
    exception when raise_exception then
      if sqlerrm<>'history customer current authority unavailable' then raise; end if;
      valid:=false;
    end;
  end if;
  if valid then return result; end if;
  for status in select value from jsonb_array_elements(result->'report_status') loop
    t:=status->>'resource_name';
    if t in ('store_daily','acquisition_daily','customer_cohorts') then
      result:=jsonb_set(result,array[t],'[]');
      select jsonb_object_agg(k,'unavailable'::text) into readiness from jsonb_object_keys(status->'readiness') k;
      status:=status||jsonb_build_object('state','not_selected','row_count',null,'is_stale',null,'readiness',readiness);
    end if;
    statuses:=statuses||jsonb_build_array(status);
  end loop;
  return jsonb_set(result,'{report_status}',statuses);
end $$;

-- No runtime registration, release, authority write or alias bypass.
do $acl$
declare fn regprocedure; runtime boolean;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='lean_private' and p.proname in ('customer_generation_policy',
      'customer_generation_registration_guard','customer_generation_full_check','customer_generation_serving_guard',
      'customer_generation_authority_lock','customer_generation_authority_invalidate')) or
      (n.nspname='public' and p.proname in ('lean_full_inputs','lean_full_finish','lean_scoped_release',
        'lean_full_release','lean_scoped_export','lean_full_export',
        'lean_scoped_export_before_customer_generation','lean_full_export_before_customer_generation',
        'lean_production_workbook_reports_read','lean_full_inputs_before_customer_generation',
        'lean_full_finish_before_customer_generation','lean_scoped_release_before_customer_generation',
        'lean_full_release_before_customer_generation','lean_workbook_read_before_customer_generation'))
  loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role,lean_posthog_reader',fn);
    if exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid=fn and a.grantee<>p.proowner) then raise exception 'unexpected customer integration grantee'; end if;
    select proname in ('lean_full_inputs','lean_full_finish','lean_production_workbook_reports_read')
      and pronamespace='public'::regnamespace into runtime from pg_proc where oid=fn;
    if runtime then execute format('grant execute on function %s to service_role',fn); end if;
    if exists(select 1 from unnest(array['anon','authenticated','service_role','lean_posthog_reader']) role_name
      where has_function_privilege(role_name,fn,'execute') is distinct from (runtime and role_name='service_role'))
      then raise exception 'unexpected customer integration effective execute'; end if;
  end loop;
end $acl$;
commit;
