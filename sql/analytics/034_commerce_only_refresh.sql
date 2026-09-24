-- REVIEW ONLY. Forward upgrade after 027. Registers/enables no work.
-- Excluding behavior is an explicit immutable owner policy, never a fallback
-- for an errored PostHog read. Preserve all existing transaction/grant guards.
begin;
create or replace function public.lean_refresh_register(p_bundle jsonb)
returns text language plpgsql security definer set search_path=pg_catalog as $$
declare id text; project text; item jsonb; b jsonb; f jsonb; q jsonb;
  existing text; ids text[] := '{}'; spend_ids text[] := '{}';
  pages integer := 0; orders integer := 0; as_of timestamptz; behavior_mode text;
begin
  if p_bundle is null or jsonb_typeof(p_bundle)<>'object' or
    octet_length(p_bundle::text)>8000000 or p_bundle->'version' is distinct from '1'::jsonb
    then raise exception 'invalid refresh bundle'; end if;
  id := p_bundle->>'runId'; project := p_bundle->>'projectRef';
  if id is null or id !~ '^refresh:[a-f0-9]{48}$' or project is null or project !~ '^[a-z]{20}$' or
    coalesce(trim(p_bundle->>'approvalRef'),'')='' or coalesce(trim(p_bundle->>'actorRef'),'')='' or
    coalesce(p_bundle->>'digest','') !~ '^[a-f0-9]{64}$' or
    id is distinct from 'refresh:'||left(p_bundle->>'digest',48) or
    coalesce(p_bundle->>'evidenceDigest','') !~ '^[a-f0-9]{64}$'
    then raise exception 'invalid refresh identity'; end if;
  perform pg_advisory_xact_lock(hashtextextended(project,0));
  select bundle_hash into existing from lean_private.refresh_queue where run_id=id;
  if found then
    if existing is distinct from md5(p_bundle::text) then raise exception 'refresh registration conflict'; end if;
    return id;
  end if;
  b := p_bundle->'base'; f := p_bundle->'full'; q := p_bundle->'queue';
  behavior_mode := coalesce(f#>>'{policy,behaviorMode}','required');
  if behavior_mode not in ('required','excluded') or
    jsonb_typeof(f->'behavior') is distinct from 'object' or
    (behavior_mode='excluded' and f->'behavior' is distinct from '{}'::jsonb)
    then raise exception 'invalid refresh behavior mode'; end if;
  if jsonb_typeof(b) is distinct from 'object' or jsonb_typeof(f) is distinct from 'object' or
    jsonb_typeof(q) is distinct from 'object' or
    b->>'projectRef' is distinct from project or f->>'projectRef' is distinct from project or
    b->>'runId' is distinct from id||':base' or f->>'runId' is distinct from id or
    f->>'baseRun' is distinct from b->>'runId' or
    jsonb_typeof(p_bundle->'history') is distinct from 'array' or
    jsonb_typeof(p_bundle->'spend') is distinct from 'array' or
    jsonb_array_length(p_bundle->'history') not between 1 and 5 or
    jsonb_array_length(p_bundle->'spend')>100 or
    f#>>'{evidence,ref}' is distinct from 'intake:sha256:'||(p_bundle->>'evidenceDigest') or
    (behavior_mode='required' and f#>>'{policy,project}' is distinct from f#>>'{behavior,project}') or
    jsonb_typeof(p_bundle->'lineage') is distinct from 'array' or jsonb_array_length(p_bundle->'lineage')<>17
    then raise exception 'invalid refresh dependencies'; end if;
  as_of := (f#>>'{policy,asOf}')::timestamptz;
  if as_of is null or not isfinite(as_of) or (q->>'readyAt')::timestamptz<as_of or
    (q->>'expiresAt')::timestamptz>as_of+interval '24 hours' or
    (behavior_mode='required' and (f#>>'{behavior,until}')::timestamptz>as_of)
    then raise exception 'invalid refresh clock'; end if;
  for item in select value from jsonb_array_elements(p_bundle->'history') loop
    if item->>'projectRef' is distinct from project or item->>'shop' is distinct from b->>'shop' or
      item->>'runId' is null or not starts_with(item->>'runId',id||':h') or item->>'runId'=any(ids) or
      (item->>'until')::timestamptz>as_of
      then raise exception 'invalid refresh history'; end if;
    ids := array_append(ids,item->>'runId');
    pages := pages+(item->>'maxPages')::integer;
    orders := orders+(item->>'maxPages')::integer*(item->>'pageSize')::integer;
    insert into lean_private.history_jobs
      (run_id,project_ref,shop,from_time,until_time,page_size,max_pages,approval_ref,actor_ref,scan_basis)
      values(item->>'runId',project,b->>'shop',(item->>'from')::timestamptz,(item->>'until')::timestamptz,
        (item->>'pageSize')::integer,(item->>'maxPages')::integer,p_bundle->>'approvalRef',p_bundle->>'actorRef',
        coalesce(item->>'scanBasis','created_at'));
  end loop;
  if pages>25 or orders>100 then raise exception 'refresh history budget'; end if;
  for item in select value from jsonb_array_elements(p_bundle->'spend') loop
    if item->>'projectRef' is distinct from project or item->>'runId' is null or
      not starts_with(item->>'runId',id||':s') or item->>'runId'=any(spend_ids) or
      (item->>'date')::date not between (b->>'fromDate')::date and (b->>'throughDate')::date then
      raise exception 'invalid refresh spend'; end if;
    spend_ids := array_append(spend_ids,item->>'runId');
    insert into lean_private.spend_jobs
      (run_id,project_ref,account_id,login_customer_id,report_date,max_pages,approval_ref,actor_ref)
      values(item->>'runId',project,item->>'accountId',item->>'loginCustomerId',(item->>'date')::date,
        (item->>'maxPages')::integer,p_bundle->>'approvalRef',p_bundle->>'actorRef');
  end loop;
  if pages+cardinality(spend_ids)+2>(q->>'maxSteps')::integer or
    to_jsonb(ids) is distinct from b->'historyRuns' or to_jsonb(spend_ids) is distinct from b->'spendRuns'
    then raise exception 'refresh step or dependency budget'; end if;
  insert into lean_private.report_builds
    (run_id,project_ref,shop,history_runs,spend_runs,from_date,through_date,policy,approval_ref,actor_ref)
    values(b->>'runId',project,b->>'shop',ids,spend_ids,(b->>'fromDate')::date,(b->>'throughDate')::date,
      b->'policy',p_bundle->>'approvalRef',p_bundle->>'actorRef');
  insert into lean_private.full_builds
    (run_id,project_ref,base_run,policy,evidence,behavior,approval_ref,actor_ref)
    values(id,project,b->>'runId',f->'policy',f->'evidence',f->'behavior',p_bundle->>'approvalRef',p_bundle->>'actorRef');
  insert into lean_private.refresh_queue(run_id,project_ref,bundle,bundle_hash,ready_at,expires_at,max_steps)
    values(id,project,p_bundle,md5(p_bundle::text),(q->>'readyAt')::timestamptz,
      (q->>'expiresAt')::timestamptz,(q->>'maxSteps')::integer);
  return id;
end $$;
revoke all on function public.lean_refresh_register(jsonb) from public,anon,authenticated,service_role,lean_posthog_reader;
commit;
