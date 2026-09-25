-- REVIEW ONLY. Apply after 025; no sources, schedules or jobs are enabled.
-- Forward-upgrade the registration function as well as the reader/commit path.
-- Existing jobs retain creation-time basis; a new basis needs a new job.
begin;
alter table lean_private.history_jobs add column if not exists scan_basis text not null default 'created_at'
  check(scan_basis in ('created_at','updated_at'));

create or replace function public.lean_refresh_register(p_bundle jsonb)
returns text language plpgsql security definer set search_path=pg_catalog as $$
declare id text; project text; item jsonb; b jsonb; f jsonb; q jsonb;
  existing text; ids text[] := '{}'; spend_ids text[] := '{}';
  pages integer := 0; orders integer := 0; as_of timestamptz;
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
  -- Locks are shared with activation/claim via the project limits row.
  -- Advisory transaction lock also protects first registration before limits exist.
  perform pg_advisory_xact_lock(hashtextextended(project,0));
  select bundle_hash into existing from lean_private.refresh_queue where run_id=id;
  if found then
    if existing is distinct from md5(p_bundle::text) then raise exception 'refresh registration conflict'; end if;
    return id;
  end if;
  b := p_bundle->'base'; f := p_bundle->'full'; q := p_bundle->'queue';
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
    f#>>'{policy,project}' is distinct from f#>>'{behavior,project}' or
    jsonb_typeof(p_bundle->'lineage') is distinct from 'array' or jsonb_array_length(p_bundle->'lineage')<>17
    then raise exception 'invalid refresh dependencies'; end if;
  as_of := (f#>>'{policy,asOf}')::timestamptz;
  if as_of is null or not isfinite(as_of) or (q->>'readyAt')::timestamptz<as_of or
    (q->>'expiresAt')::timestamptz>as_of+interval '24 hours' or
    (f#>>'{behavior,until}')::timestamptz>as_of then raise exception 'invalid refresh clock'; end if;
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

create or replace function public.lean_history_read(p_run text,p_project_ref text,p_shop text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.history_jobs;
begin
  select * into r from lean_private.history_jobs
    where run_id=p_run and project_ref=p_project_ref and shop=p_shop;
  if not found then raise exception 'unapproved history target'; end if;
  return jsonb_build_object('state',case when not r.enabled then 'disabled' when r.complete then 'complete'
    when r.page_count>=r.max_pages then 'budget_exhausted' else 'ready' end,
    'shop',r.shop,'scanBasis',r.scan_basis,
    'fromTime',to_char(r.from_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'untilTime',to_char(r.until_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'approvalRef',r.approval_ref,'pageSize',r.page_size,'cursor',r.cursor,
    'pageCount',r.page_count,'rowCount',r.row_count);
end $$;

create or replace function public.lean_history_commit(p_run text,p_project_ref text,p_shop text,p_expected_page integer,
  p_expected_cursor text,p_next_cursor text,p_complete boolean,p_rows jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.history_jobs; item jsonb; gid text; created timestamptz; revision timestamptz;
  selected_time timestamptz; previous_time timestamptz; seen text[] := '{}';
begin
  select * into r from lean_private.history_jobs
    where run_id=p_run and project_ref=p_project_ref and shop=p_shop for update;
  if not found then raise exception 'unapproved history target'; end if;
  if not r.enabled or r.complete or r.page_count>=r.max_pages or
    r.page_count is distinct from p_expected_page or r.cursor is distinct from p_expected_cursor then return false; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or p_complete is null then raise exception 'invalid history page'; end if;
  if octet_length(p_rows::text)>8000000 or
    jsonb_array_length(p_rows)>r.page_size or r.row_count+jsonb_array_length(p_rows)>10000 or
    p_complete is distinct from (p_next_cursor is null) or
    (not p_complete and (jsonb_array_length(p_rows)=0 or length(p_next_cursor) not between 1 and 4096 or
      p_next_cursor is not distinct from p_expected_cursor or exists(
        select 1 from lean_private.history_pages where run_id=p_run and next_cursor=p_next_cursor)))
    then raise exception 'invalid history page bounds'; end if;
  -- Enforce sort order across durable page boundaries as well as within a page.
  select max((case when r.scan_basis='updated_at' then x#>>'{source,commerce,order,updatedAt}'
    else x#>>'{source,commerce,order,createdAt}' end)::timestamptz) into previous_time
    from lean_private.history_pages h cross join lateral jsonb_array_elements(h.rows) x where h.run_id=p_run;
  for item in select value from jsonb_array_elements(p_rows) loop
    gid := item#>>'{source,commerce,order,id}';
    created := (item#>>'{source,commerce,order,createdAt}')::timestamptz;
    revision := (item#>>'{source,commerce,order,updatedAt}')::timestamptz;
    selected_time := case when r.scan_basis='updated_at' then revision else created end;
    if item#>>'{source,commerce,shop}' is distinct from r.shop or
      item#>>'{source,commerce,apiVersion}' is distinct from '2026-07' or
      gid is null or gid !~ '^gid://shopify/Order/[1-9][0-9]*$' or
      created is null or not isfinite(created) or
      revision is null or not isfinite(revision) or revision<created or revision>clock_timestamp() or
      selected_time<r.from_time or selected_time>=r.until_time or
      selected_time<previous_time or gid=any(seen) or
      exists(select 1 from lean_private.history_pages h cross join lateral jsonb_array_elements(h.rows) x
        where h.run_id=p_run and x#>>'{source,commerce,order,id}'=gid)
      then raise exception 'history source scope mismatch'; end if;
    previous_time := selected_time; seen := array_append(seen,gid);
  end loop;
  insert into lean_private.history_pages(run_id,page_number,expected_cursor,next_cursor,complete,rows)
    values(p_run,r.page_count+1,p_expected_cursor,p_next_cursor,p_complete,p_rows);
  update lean_private.history_jobs set cursor=p_next_cursor,page_count=page_count+1,
    row_count=row_count+jsonb_array_length(p_rows),complete=p_complete where run_id=p_run;
  return true;
end $$;
revoke all on function public.lean_history_read(text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.lean_history_commit(text,text,text,integer,text,text,boolean,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.lean_history_read(text,text,text) to service_role;
grant execute on function public.lean_history_commit(text,text,text,integer,text,text,boolean,jsonb) to service_role;
commit;
