-- REVIEW ONLY. Registers/enables nothing. Dependencies: 018..024.
-- Owner registers immutable fresh-evidence snapshots; runtime may only advance
-- explicitly enabled queued runs. No privilege to release, export or self-enable.
begin;
create table lean_private.refresh_limits (
  project_ref text primary key check(project_ref ~ '^[a-z]{20}$'),
  enabled boolean not null default false,
  max_daily_steps integer not null check(max_daily_steps between 1 and 256),
  approval_ref text not null check(length(trim(approval_ref))>0),
  actor_ref text not null check(length(trim(actor_ref))>0),
  counter_date date, used_steps integer not null default 0 check(used_steps>=0)
);
create table lean_private.refresh_queue (
  run_id text primary key references lean_private.full_builds,
  project_ref text not null check(project_ref ~ '^[a-z]{20}$'),
  bundle jsonb not null,
  bundle_hash text not null,
  enabled boolean not null default false,
  ready_at timestamptz not null, expires_at timestamptz not null,
  max_steps integer not null check(max_steps between 3 and 128),
  used_steps integer not null default 0 check(used_steps>=0),
  status text not null default 'queued' check(status in ('queued','complete','blocked')),
  lease_token uuid, lease_until timestamptz,
  last_state text, last_step_at timestamptz,
  check(isfinite(ready_at) and isfinite(expires_at) and ready_at<expires_at),
  check(expires_at-ready_at<=interval '24 hours'),
  check(octet_length(bundle::text)<=8000000)
);
alter table lean_private.refresh_limits enable row level security;
alter table lean_private.refresh_queue enable row level security;
revoke all on lean_private.refresh_limits,lean_private.refresh_queue from public,anon,authenticated,service_role,lean_posthog_reader;
create function lean_private.refresh_scope_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if (old.run_id,old.project_ref,old.bundle,old.bundle_hash,old.ready_at,old.expires_at,old.max_steps)
    is distinct from
     (new.run_id,new.project_ref,new.bundle,new.bundle_hash,new.ready_at,new.expires_at,new.max_steps)
    then raise exception 'refresh scope immutable'; end if;
  return new;
end $$;
create trigger immutable_refresh_scope before update on lean_private.refresh_queue
  for each row execute function lean_private.refresh_scope_immutable();

-- Operator-only transaction; registration is not activation. Repeating the
-- same payload is idempotent, conflicting payloads under the same ID are not.
create function public.lean_refresh_register(p_bundle jsonb)
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
      (run_id,project_ref,shop,from_time,until_time,page_size,max_pages,approval_ref,actor_ref)
      values(item->>'runId',project,b->>'shop',(item->>'from')::timestamptz,(item->>'until')::timestamptz,
        (item->>'pageSize')::integer,(item->>'maxPages')::integer,p_bundle->>'approvalRef',p_bundle->>'actorRef');
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

create function public.lean_refresh_claim(p_project_ref text,p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare limits lean_private.refresh_limits; r lean_private.refresh_queue; today date;
begin
  if p_token is null then raise exception 'missing refresh lease'; end if;
  select * into limits from lean_private.refresh_limits where project_ref=p_project_ref for update;
  if not found or not limits.enabled then return jsonb_build_object('state','disabled'); end if;
  today := (clock_timestamp() at time zone 'UTC')::date;
  if limits.counter_date is distinct from today then
    update lean_private.refresh_limits set counter_date=today,used_steps=0 where project_ref=p_project_ref;
    limits.used_steps := 0;
  end if;
  if limits.used_steps>=limits.max_daily_steps then return jsonb_build_object('state','budget_exhausted'); end if;
  -- One refresh per project at a time, including unfinished source checkpoints.
  select * into r from lean_private.refresh_queue where project_ref=p_project_ref and enabled
    and status='queued' and ready_at<=clock_timestamp()
    order by ready_at,run_id limit 1 for update;
  if not found then return jsonb_build_object('state','idle'); end if;
  if r.expires_at<=clock_timestamp()+interval '90 seconds' then
    update lean_private.refresh_queue set status='blocked',last_state='expired' where run_id=r.run_id;
    return jsonb_build_object('state','expired');
  end if;
  if r.lease_until>clock_timestamp() then return jsonb_build_object('state','busy'); end if;
  if r.lease_token is not null then
    -- A lost response/crash must be reconciled by an operator, not replayed
    -- automatically after the lease expires.
    update lean_private.refresh_queue set status='blocked',last_state='ambiguous'
      where run_id=r.run_id;
    return jsonb_build_object('state','ambiguous');
  end if;
  if r.used_steps>=r.max_steps then return jsonb_build_object('state','budget_exhausted'); end if;
  update lean_private.refresh_limits set used_steps=used_steps+1 where project_ref=p_project_ref;
  update lean_private.refresh_queue set used_steps=used_steps+1,lease_token=p_token,
    lease_until=least(expires_at,clock_timestamp()+interval '120 seconds'),last_step_at=clock_timestamp()
    where run_id=r.run_id;
  return jsonb_build_object('state','claimed','runId',r.run_id,
    'expiresAt',to_char(r.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end $$;
create function public.lean_refresh_finish(p_project_ref text,p_run text,p_token uuid,p_state text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.refresh_queue; limits lean_private.refresh_limits; completed boolean;
begin
  -- Same lock order as claim. Disabling the project fences acknowledgement.
  select * into limits from lean_private.refresh_limits where project_ref=p_project_ref for share;
  if not found or not limits.enabled then return false; end if;
  select * into r from lean_private.refresh_queue where run_id=p_run and project_ref=p_project_ref for update;
  if not found or not r.enabled or r.status<>'queued' or r.lease_token is distinct from p_token or
    r.lease_until is null or r.lease_until<=clock_timestamp() or r.expires_at<=clock_timestamp() then return false; end if;
  select completed_at is not null into completed from lean_private.full_builds where run_id=p_run;
  if p_state='complete' and not coalesce(completed,false) then raise exception 'uncompleted refresh'; end if;
  if p_state is null or p_state not in ('complete','partial','blocked','busy','failed','changed','disabled',
    'lost_lease','attempts_exhausted','budget_exhausted','unavailable','busy_or_exhausted') then raise exception 'invalid refresh state'; end if;
  update lean_private.refresh_queue set status=case when p_state='complete' then 'complete'
      when p_state='partial' then 'queued' else 'blocked' end,
    last_state=p_state,lease_token=null,lease_until=null where run_id=p_run;
  return true;
end $$;
-- Fence stale permissions/kill-switch changes even if a source read started
-- before expiry. No refreshed candidate can commit past its evidence deadline.
create function lean_private.refresh_publication_fence() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare q lean_private.refresh_queue; limits lean_private.refresh_limits;
begin
  if not starts_with(new.publication_id,'full:refresh:') then return new; end if;
  select * into q from lean_private.refresh_queue where run_id=substring(new.publication_id from 6);
  if not found then raise exception 'unregistered refresh publication'; end if;
  select * into limits from lean_private.refresh_limits where project_ref=q.project_ref for share;
  if not found or not limits.enabled then raise exception 'refresh disabled'; end if;
  select * into q from lean_private.refresh_queue where run_id=q.run_id for share;
  if not q.enabled or q.status<>'queued' or q.lease_until is null or
    q.lease_until<=clock_timestamp() or q.expires_at<=clock_timestamp()
    then raise exception 'refresh evidence expired or unleased'; end if;
  return new;
end $$;
create trigger fence_refresh_publication before insert on lean_private.publications
  for each row execute function lean_private.refresh_publication_fence();
revoke all on function public.lean_refresh_register(jsonb) from public,anon,authenticated,service_role,lean_posthog_reader;
revoke all on function public.lean_refresh_claim(text,uuid) from public,anon,authenticated,service_role,lean_posthog_reader;
revoke all on function public.lean_refresh_finish(text,text,uuid,text) from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_refresh_claim(text,uuid) to service_role;
grant execute on function public.lean_refresh_finish(text,text,uuid,text) to service_role;
commit;
