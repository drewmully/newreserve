-- PRIVATE REVIEW ONLY. Existing 018/020/021/038/053 and current wrappers required.
-- Owner-only registration. No scope, approval, credential, schedule or activation seeded.
begin;
create function public.lean_google_workbook_register(p_scope jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare h lean_private.history_jobs; id text; ids text[]; s jsonb; m jsonb; d jsonb;
  p text; v_shop text; day date; pages integer:=0; rows integer:=0;
begin
  if jsonb_typeof(p_scope) is distinct from 'object' or octet_length(p_scope::text)>5000000 or
    not(p_scope ?& array['version','projectRef','shop','runId','baseRunId','historyRuns','reportPolicy',
      'fromDate','throughDate','spendRegistration','fullPolicy','evidence','behavior','approvalRef','actorRef']) or
    p_scope-array['version','projectRef','shop','runId','baseRunId','historyRuns','reportPolicy',
      'fromDate','throughDate','spendRegistration','fullPolicy','evidence','behavior','approvalRef','actorRef']<>'{}' or
    p_scope->'version' is distinct from '1'::jsonb or
    jsonb_typeof(p_scope->'historyRuns') is distinct from 'array' or
    jsonb_array_length(p_scope->'historyRuns') not between 1 and 5 or
    p_scope->>'runId' !~ '^[A-Za-z0-9_-]{1,100}$' or
    p_scope->>'baseRunId' !~ '^[A-Za-z0-9_-]{1,100}$' or p_scope->>'runId'=p_scope->>'baseRunId' or
    exists(select 1 from unnest(array['reportPolicy','fullPolicy','evidence','behavior']) k
      where jsonb_typeof(p_scope->k) is distinct from 'object') or
    p_scope->'evidence' ? 'customerGeneration'
    then raise exception 'invalid Google workbook registration'; end if;
  p:=p_scope->>'projectRef'; v_shop:=p_scope->>'shop';
  if p !~ '^[a-z]{20}$' or v_shop !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' or
    coalesce(length(trim(p_scope->>'approvalRef')),0) not between 1 and 512 or
    coalesce(length(trim(p_scope->>'actorRef')),0) not between 1 and 512 or
    p_scope->>'fromDate' is distinct from p_scope->>'throughDate' or
    coalesce(p_scope->>'fromDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    then raise exception 'invalid Google workbook scope'; end if;
  day:=(p_scope->>'fromDate')::date;
  if day::text<>p_scope->>'fromDate' then raise exception 'invalid Google day'; end if;
  s:=p_scope->'spendRegistration'; m:=p_scope#>'{fullPolicy,freshGoogleSpend,manifest}';
  d:=p_scope#>'{fullPolicy,googleDelivery}';
  if jsonb_typeof(s) is distinct from 'object' or jsonb_typeof(m) is distinct from 'object' or
    jsonb_typeof(d) is distinct from 'object' or s->>'projectRef' is distinct from p or
    m->>'projectRef' is distinct from p or s->>'pilotId' !~ '^fresh-google:[a-f0-9]{64}$' or
    m->>'sourceCurrency' is distinct from 'USD' or m->>'sourceTimezone' is distinct from 'America/New_York' or
    jsonb_typeof(m->'days') is distinct from 'array' or jsonb_array_length(m->'days')<>1 or
    jsonb_typeof(s->'days') is distinct from 'array' or jsonb_array_length(s->'days')<>1 or
    s#>>'{days,0,runId}' is distinct from s->>'pilotId'||':'||day::text or
    s#>>'{days,0,date}' is distinct from day::text or m#>>'{days,0,date}' is distinct from day::text or
    s#>>'{days,0,dueAt}' is distinct from m#>>'{days,0,dueAt}' or
    s->>'accountId' is distinct from m->>'accountId' or
    s->>'loginCustomerId' is distinct from m->>'loginCustomerId' or
    s->'maxPages' is distinct from m->'maxPages' or s->>'expiresAt' is distinct from m->>'expiresAt' or
    s->>'approvalRef' is distinct from m->>'approvalRef' or s->>'actorRef' is distinct from m->>'actorRef' or
    d->'version' is distinct from '1'::jsonb or d->>'definitionVersion' is distinct from 'google-account-daily-v1' or
    d->>'accountId' is distinct from m->>'accountId' or d->>'date' is distinct from day::text or
    coalesce(length(trim(d->>'approvalRef')),0)=0
    then raise exception 'Google registration binding mismatch'; end if;
  if (p_scope#>>'{fullPolicy,asOf}')::timestamptz<(m#>>'{days,0,dueAt}')::timestamptz or
    (p_scope#>>'{fullPolicy,asOf}')::timestamptz>=(m->>'expiresAt')::timestamptz
    then raise exception 'Google registration as-of mismatch'; end if;
  select array_agg(value order by value) into ids from jsonb_array_elements_text(p_scope->'historyRuns');
  if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'duplicate history run'; end if;
  -- Registration needs genuine retained commerce, not an invented empty base.
  -- This does not certify complete-store history or any customer denominator.
  foreach id in array ids loop
    select hj.* into h from lean_private.history_jobs hj where hj.run_id=id and hj.project_ref=p and hj.shop=v_shop for share;
    if not found or not h.enabled or not h.complete or
      h.page_count<>(select count(*) from lean_private.history_pages hp where hp.run_id=id) or
      h.row_count<>(select coalesce(sum(jsonb_array_length(hp.rows)),0) from lean_private.history_pages hp where hp.run_id=id) or
      not exists(select 1 from lean_private.history_pages hp where hp.run_id=id and hp.complete)
      then raise exception 'retained commerce history required'; end if;
    pages:=pages+h.max_pages; rows:=rows+h.max_pages*h.page_size;
    if pages>25 or rows>100 then raise exception 'history dependency budget'; end if;
  end loop;
  -- Existing owner registrar inserts the pilot/jobs disabled. Unique IDs reject
  -- replay or conflicting attempts atomically; do not catch and silently reuse.
  perform public.lean_spend_pilot_register(s);
  insert into lean_private.report_builds(run_id,project_ref,shop,history_runs,spend_runs,
    from_date,through_date,policy,approval_ref,actor_ref,enabled)
    values(p_scope->>'baseRunId',p,v_shop,ids,array[s#>>'{days,0,runId}'],day,day,
      p_scope->'reportPolicy',p_scope->>'approvalRef',p_scope->>'actorRef',false);
  insert into lean_private.full_builds(run_id,project_ref,base_run,policy,evidence,behavior,approval_ref,actor_ref,enabled)
    values(p_scope->>'runId',p,p_scope->>'baseRunId',p_scope->'fullPolicy',p_scope->'evidence',
      p_scope->'behavior',p_scope->>'approvalRef',p_scope->>'actorRef',false);
  return true;
end $$;
revoke all on function public.lean_google_workbook_register(jsonb)
  from public,anon,authenticated,service_role,lean_posthog_reader;
commit;
