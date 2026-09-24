-- Forward-only. Disabled owner registration/staging only; no source calls,
-- activation, schedules, certification or selection changes.
begin;
create function lean_private.partition_canonical(v jsonb) returns text
language plpgsql immutable strict set search_path=pg_catalog as $$
declare result text;
begin
  if jsonb_typeof(v)='object' then
    select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||lean_private.partition_canonical(value),
      ',' order by key collate "C"),'')||'}' into result from jsonb_each(v);
  elsif jsonb_typeof(v)='array' then
    select '['||coalesce(string_agg(lean_private.partition_canonical(value),',' order by n),'')||']'
      into result from jsonb_array_elements(v) with ordinality a(value,n);
  else result := v::text; end if;
  return result;
end $$;
create function lean_private.partition_digest(v jsonb) returns text
language sql immutable strict set search_path=pg_catalog as $$
  select encode(sha256(convert_to(lean_private.partition_canonical(v),'UTF8')),'hex')
$$;
create function lean_private.partition_validate(m jsonb, project text, shop text, as_of timestamptz,
  expiry timestamptz, evidence text) returns void
language plpgsql set search_path=pg_catalog as $$
declare c jsonb; p jsonb; o jsonb; w jsonb; n integer; total integer:=0; bytes bigint:=0;
begin
  if jsonb_typeof(m) is distinct from 'object' or m->'version' is distinct from '1'::jsonb or
    m->>'projectRef' is distinct from project or m->>'shop' is distinct from shop or
    coalesce(trim(m->>'approvalRef'),'')='' or
    m->>'digest' is distinct from lean_private.partition_digest(m-'digest') or
    m->>'evidenceDigest' is distinct from evidence or
    (m->>'capturedAt')::timestamptz>as_of or (m->>'expiresAt')::timestamptz is distinct from expiry or
    m->>'capturedAt' is null or m->>'maxBytes' is null or
    as_of is null or not isfinite(as_of) or not isfinite(expiry) or expiry is null or
    not isfinite((m->>'capturedAt')::timestamptz) or (m->>'capturedAt')::timestamptz>=expiry or
    (m->>'maxBytes')::bigint not between 1024 and 32000000 or
    jsonb_typeof(m->'children') is distinct from 'array' or jsonb_array_length(m->'children') not between 1 and 10 or
    jsonb_typeof(m->'owners') is distinct from 'object'
    then raise exception 'invalid partition manifest'; end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(m->'children') x)<>jsonb_array_length(m->'children')
    then raise exception 'duplicate partition child'; end if;
  for c in select value from jsonb_array_elements(m->'children') loop
    if coalesce(c->>'id','') !~ '^[a-zA-Z0-9_-]{1,32}$' or
      c#>'{inventory,version}' is distinct from '1'::jsonb or
      coalesce(trim(c#>>'{inventory,approvalRef}'),'')='' or c#>>'{inventory,capturedAt}' is null or
      not isfinite((c#>>'{inventory,capturedAt}')::timestamptz) or
      c#>>'{inventory,projectRef}' is distinct from project or c#>>'{inventory,shop}' is distinct from shop or
      c#>>'{inventory,digest}' is distinct from lean_private.partition_digest((c->'inventory')-'digest') or
      (c#>>'{inventory,capturedAt}')::timestamptz>(m->>'capturedAt')::timestamptz or
      jsonb_typeof(c#>'{inventory,orders}') is distinct from 'array' or jsonb_array_length(c#>'{inventory,orders}')>100 or
      jsonb_typeof(c#>'{inventory,windows}') is distinct from 'array' or
      jsonb_array_length(c#>'{inventory,windows}') not between 1 and 5 or
      jsonb_typeof(c->'pages') is distinct from 'array' or jsonb_array_length(c->'pages') not between 1 and 20
      then raise exception 'invalid partition child'; end if;
    if (select coalesce(sum((x->>'maxPages')::integer),0) from jsonb_array_elements(c#>'{inventory,windows}') x)>25 or
      (select coalesce(sum((x->>'maxPages')::integer*(x->>'pageSize')::integer),0)
        from jsonb_array_elements(c#>'{inventory,windows}') x)>100 then raise exception 'partition child budget'; end if;
    for w in select value from jsonb_array_elements(c#>'{inventory,windows}') loop
      if not(w ?& array['pageSize','maxPages','from','until']) or
        not isfinite((w->>'from')::timestamptz) or not isfinite((w->>'until')::timestamptz) or
        (w->>'pageSize')::integer not between 1 and 5 or (w->>'maxPages')::integer not between 1 and 25 or
        (w->>'from')::timestamptz >= (w->>'until')::timestamptz or
        (w->>'until')::timestamptz>(c#>>'{inventory,capturedAt}')::timestamptz or
        coalesce(w->>'scanBasis','created_at') not in ('created_at','updated_at')
        then raise exception 'partition window scope'; end if;
    end loop;
    n:=0;
    for p in select value from jsonb_array_elements(c->'pages') loop
      if p->>'rows' is null or p->>'bytes' is null or
        p->'number' is distinct from to_jsonb(n) or (p->>'rows')::integer not between 0 and 5 or
        (p->>'bytes')::bigint not between 2 and 4000000 or coalesce(p->>'digest','') !~ '^[a-f0-9]{64}$'
        then raise exception 'partition page budget'; end if;
      n:=n+1; total:=total+(p->>'rows')::integer; bytes:=bytes+(p->>'bytes')::bigint;
    end loop;
    if (select sum((x->>'rows')::integer) from jsonb_array_elements(c->'pages') x)
      <>jsonb_array_length(c#>'{inventory,orders}') or
      (select count(distinct x->>'id') from jsonb_array_elements(c#>'{inventory,orders}') x)
      <>jsonb_array_length(c#>'{inventory,orders}') then raise exception 'partition child count'; end if;
    for o in select value from jsonb_array_elements(c#>'{inventory,orders}') loop
      if coalesce(o->>'id','') !~ '^gid://shopify/Order/[1-9][0-9]*$' or
        o->>'createdAt' is null or o->>'updatedAt' is null or
        not isfinite((o->>'createdAt')::timestamptz) or not isfinite((o->>'updatedAt')::timestamptz) or
        (o->>'createdAt')::timestamptz>(o->>'updatedAt')::timestamptz or
        (o->>'updatedAt')::timestamptz>(c#>>'{inventory,capturedAt}')::timestamptz
        then raise exception 'partition order scope'; end if;
    end loop;
  end loop;
  if total>1000 or bytes>(m->>'maxBytes')::bigint then raise exception 'partition parent budget'; end if;
  if exists(select 1 from jsonb_array_elements(m->'children') ch,
    lateral jsonb_array_elements(ch#>'{inventory,orders}') ord group by ord->>'id'
    having count(distinct ord)>1) then raise exception 'partition revision conflict'; end if;
  if (select count(*) from jsonb_object_keys(m->'owners'))<>
    (select count(distinct ord->>'id') from jsonb_array_elements(m->'children') ch,
      lateral jsonb_array_elements(ch#>'{inventory,orders}') ord) or
    exists(select 1 from jsonb_each_text(m->'owners') own where not exists(
      select 1 from jsonb_array_elements(m->'children') ch,
        lateral jsonb_array_elements(ch#>'{inventory,orders}') ord where ch->>'id'=own.value and ord->>'id'=own.key))
    then raise exception 'partition ownership mismatch'; end if;
end $$;

alter table lean_private.report_builds drop constraint report_builds_history_runs_check;
alter table lean_private.report_builds add constraint report_builds_history_runs_check check(
  (not(policy ? 'partitionInventory') and cardinality(history_runs) between 1 and 5) or
  (policy ? 'partitionInventory' and cardinality(history_runs)=0));
create table lean_private.partition_pages (
  report_run text not null references lean_private.report_builds on delete cascade,
  child text not null, page_number integer not null check(page_number between 0 and 19),
  payload text not null check(octet_length(payload) between 2 and 4000000),
  primary key(report_run,child,page_number)
);
alter table lean_private.partition_pages enable row level security;
revoke all on lean_private.partition_pages from public,anon,authenticated,service_role,lean_posthog_reader;
create function lean_private.partition_page_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$ begin raise exception 'partition page immutable'; end $$;
create trigger partition_page_immutable before update or delete on lean_private.partition_pages
  for each row execute function lean_private.partition_page_immutable();

-- Existing immutable_report_scope, immutable_full_scope and
-- immutable_refresh_scope retain scope/evidence/bundle/absolute-expiry fences.

alter function public.lean_refresh_register(jsonb) rename to lean_refresh_register_ordinary;
revoke all on function public.lean_refresh_register_ordinary(jsonb) from public,anon,authenticated,service_role,lean_posthog_reader;
create function public.lean_refresh_register(p_bundle jsonb) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare id text; project text; b jsonb; f jsonb; q jsonb; m jsonb; s jsonb; old_hash text; spend text[]:='{}';
  packet jsonb; binding jsonb; scope jsonb; section text;
  sections text[]:=array['identity','currentlyPermitted','removedCustomers','customerHistory','orderIdentities',
    'checkout','campaigns','sessionCoverage','attributionCoverage','replacements','settlements','offers','proofs',
    'externalControls','dateCoverage','comparisons','cohortCoverage'];
begin
  if p_bundle->'version' is distinct from '2'::jsonb then return public.lean_refresh_register_ordinary(p_bundle); end if;
  id:=p_bundle->>'runId'; project:=p_bundle->>'projectRef'; b:=p_bundle->'base'; f:=p_bundle->'full'; q:=p_bundle->'queue';
  m:=b#>'{policy,partitionInventory}';
  if octet_length(p_bundle::text)>8000000 or coalesce(id,'') !~ '^refresh:[a-f0-9]{48}$' or
    coalesce(project,'') !~ '^[a-z]{20}$' or id is distinct from 'refresh:'||left(p_bundle->>'digest',48) or
    coalesce(p_bundle->>'digest','') !~ '^[a-f0-9]{64}$' or coalesce(p_bundle->>'evidenceDigest','') !~ '^[a-f0-9]{64}$' or
    coalesce(trim(p_bundle->>'approvalRef'),'')='' or coalesce(trim(p_bundle->>'actorRef'),'')='' or
    p_bundle->'history' is distinct from '[]'::jsonb or b->'historyRuns' is distinct from '[]'::jsonb or
    b->>'runId' is distinct from id||':base' or f->>'baseRun' is distinct from b->>'runId' or
    b->>'projectRef' is distinct from project or f->>'projectRef' is distinct from project or f->>'runId' is distinct from id or
    f#>>'{evidence,ref}' is distinct from 'intake:sha256:'||(p_bundle->>'evidenceDigest') or
    jsonb_typeof(p_bundle->'lineage') is distinct from 'array' or jsonb_array_length(p_bundle->'lineage')<>17 or
    coalesce(f#>>'{policy,behaviorMode}','required') not in ('required','excluded') or
    (f#>>'{policy,behaviorMode}'='excluded' and f->'behavior' is distinct from '{}'::jsonb) or
    (coalesce(f#>>'{policy,behaviorMode}','required')='required' and
      (f#>>'{policy,project}' is distinct from f#>>'{behavior,project}' or
       (f#>>'{behavior,until}')::timestamptz>(f#>>'{policy,asOf}')::timestamptz)) or
    (q->>'readyAt')::timestamptz<(f#>>'{policy,asOf}')::timestamptz or
    (q->>'expiresAt')::timestamptz>(f#>>'{policy,asOf}')::timestamptz+interval '24 hours' or
    (q->>'expiresAt')::timestamptz<=clock_timestamp() or
    jsonb_typeof(p_bundle->'spend') is distinct from 'array' or jsonb_array_length(p_bundle->'spend')>100 or
    (q->>'maxSteps')::integer<jsonb_array_length(p_bundle->'spend')+2 or
    b->'policy' ? 'sourceInventory'
    then raise exception 'invalid partition bundle'; end if;
  perform lean_private.partition_validate(m,project,b->>'shop',(f#>>'{policy,asOf}')::timestamptz,
    (q->>'expiresAt')::timestamptz,p_bundle->>'evidenceDigest');
  scope:=jsonb_build_object('projectRef',project,'shop',b->>'shop','fromDate',b->>'fromDate','throughDate',b->>'throughDate');
  if p_bundle->'evidenceScope' is distinct from scope or
    jsonb_typeof(p_bundle->'evidenceBindings') is distinct from 'array' or
    p_bundle->>'evidenceDigest' is distinct from lean_private.partition_digest(jsonb_build_object(
      'scope',scope,'bindings',p_bundle->'evidenceBindings','lineage',p_bundle->'lineage')) or
    (select count(distinct x->>'section') from jsonb_array_elements(p_bundle->'lineage') x)<>17 or
    (select count(distinct x->>'sourceId') from jsonb_array_elements(p_bundle->'evidenceBindings') x)<>
      jsonb_array_length(p_bundle->'evidenceBindings') then raise exception 'partition evidence seal'; end if;
  for packet in select value from jsonb_array_elements(p_bundle->'lineage') loop
    section:=packet->>'section';
    select x into binding from jsonb_array_elements(p_bundle->'evidenceBindings') x where x->>'sourceId'=packet->>'sourceId';
    if not found or not(section=any(sections)) or packet->'scope' is distinct from scope or
      coalesce(trim(packet->>'sourceRecordRef'),'')='' or coalesce(trim(binding->>'approvalRef'),'')='' or
      coalesce(trim(binding->>'sourceId'),'')='' or coalesce(trim(binding->>'schemaVersion'),'')='' or
      jsonb_typeof(binding->'sections') is distinct from 'array' or
      jsonb_typeof(binding->'independentControlSource') is distinct from 'boolean' or
      coalesce(packet->>'sha256','') !~ '^[a-f0-9]{64}$' or
      packet->>'schemaVersion' is distinct from binding->>'schemaVersion' or
      not(binding->'sections' ? section) or packet->>'capturedAt' is null or
      not isfinite((packet->>'capturedAt')::timestamptz) or
      (packet->>'capturedAt')::timestamptz>(f#>>'{policy,asOf}')::timestamptz or
      binding->>'maxAgeSeconds' is null or (binding->>'maxAgeSeconds')::integer not between 1 and 604800 or
      (packet->>'capturedAt')::timestamptz+make_interval(secs=>(binding->>'maxAgeSeconds')::integer)<
        (q->>'expiresAt')::timestamptz or
      packet->>'sha256' is distinct from lean_private.partition_digest(f->'evidence'->section) or
      (section in ('proofs','externalControls','dateCoverage','cohortCoverage') and
        binding->'independentControlSource' is distinct from 'true'::jsonb)
      then raise exception 'partition evidence payload or freshness'; end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended(project,0));
  select bundle_hash into old_hash from lean_private.refresh_queue where run_id=id;
  if found then
    if old_hash<>md5(p_bundle::text) then raise exception 'partition registration conflict'; end if;
    return id;
  end if;
  for s in select value from jsonb_array_elements(p_bundle->'spend') loop
    if s->>'projectRef' is distinct from project or not starts_with(s->>'runId',id||':s') or
      s->>'runId'=any(spend) or (s->>'date')::date not between (b->>'fromDate')::date and (b->>'throughDate')::date
      then raise exception 'invalid partition spend'; end if;
    spend:=array_append(spend,s->>'runId');
    insert into lean_private.spend_jobs(run_id,project_ref,account_id,login_customer_id,report_date,max_pages,approval_ref,actor_ref)
      values(s->>'runId',project,s->>'accountId',s->>'loginCustomerId',(s->>'date')::date,(s->>'maxPages')::integer,
        p_bundle->>'approvalRef',p_bundle->>'actorRef');
  end loop;
  if to_jsonb(spend) is distinct from b->'spendRuns' then raise exception 'partition spend mismatch'; end if;
  insert into lean_private.report_builds(run_id,project_ref,shop,history_runs,spend_runs,from_date,through_date,policy,approval_ref,actor_ref)
    values(b->>'runId',project,b->>'shop','{}',spend,(b->>'fromDate')::date,(b->>'throughDate')::date,b->'policy',
      p_bundle->>'approvalRef',p_bundle->>'actorRef');
  insert into lean_private.full_builds(run_id,project_ref,base_run,policy,evidence,behavior,approval_ref,actor_ref)
    values(id,project,b->>'runId',f->'policy',f->'evidence',f->'behavior',p_bundle->>'approvalRef',p_bundle->>'actorRef');
  insert into lean_private.refresh_queue(run_id,project_ref,bundle,bundle_hash,ready_at,expires_at,max_steps)
    values(id,project,p_bundle,md5(p_bundle::text),(q->>'readyAt')::timestamptz,(q->>'expiresAt')::timestamptz,(q->>'maxSteps')::integer);
  return id;
end $$;
revoke all on function public.lean_refresh_register(jsonb) from public,anon,authenticated,service_role,lean_posthog_reader;

create function public.lean_partition_stage_page(p_run text,p_project_ref text,p_child text,p_number integer,p_payload text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare b lean_private.report_builds; q lean_private.refresh_queue; c jsonb; p jsonb; rows jsonb; r jsonb; prior text;
begin
  select * into b from lean_private.report_builds where run_id=p_run and project_ref=p_project_ref for update;
  if not found or b.enabled or b.completed_at is not null then raise exception 'partition staging not disabled'; end if;
  select q0.* into q from lean_private.refresh_queue q0 join lean_private.full_builds f on f.run_id=q0.run_id
    where f.base_run=b.run_id and not f.enabled;
  if not found or q.enabled or q.expires_at<=clock_timestamp() then raise exception 'partition staging expired or enabled'; end if;
  select x into c from jsonb_array_elements(b.policy#>'{partitionInventory,children}') x where x->>'id'=p_child;
  select x into p from jsonb_array_elements(c->'pages') x where (x->>'number')::integer=p_number;
  if p is null or octet_length(p_payload) is distinct from (p->>'bytes')::integer or
    encode(sha256(convert_to(p_payload,'UTF8')),'hex') is distinct from p->>'digest'
    then raise exception 'partition page digest'; end if;
  rows:=p_payload::jsonb;
  if jsonb_typeof(rows) is distinct from 'array' or lean_private.partition_canonical(rows)<>p_payload or
    jsonb_array_length(rows) is distinct from (p->>'rows')::integer then raise exception 'partition page rows'; end if;
  for r in select value from jsonb_array_elements(rows) loop
    if r#>>'{source,commerce,shop}' is distinct from b.shop or
      r->>'evidenceRef' is distinct from 'partition-source:sha256:'||lean_private.partition_digest(r->'source') or
      r->>'capturedAt' is null or not isfinite((r->>'capturedAt')::timestamptz) or
      (r->>'capturedAt')::timestamptz<(c#>>'{inventory,capturedAt}')::timestamptz or
      (r->>'capturedAt')::timestamptz>(b.policy#>>'{partitionInventory,capturedAt}')::timestamptz or
      not exists(select 1 from jsonb_array_elements(c#>'{inventory,orders}') o
        where o->>'id'=r#>>'{source,commerce,order,id}' and
          (o->>'createdAt')::timestamptz=(r#>>'{source,commerce,order,createdAt}')::timestamptz and
          (o->>'updatedAt')::timestamptz=(r#>>'{source,commerce,order,updatedAt}')::timestamptz)
      then raise exception 'partition page source mismatch'; end if;
  end loop;
  select payload into prior from lean_private.partition_pages where report_run=p_run and child=p_child and page_number=p_number;
  if found then
    if prior is distinct from p_payload then raise exception 'partition page replay conflict'; end if;
    return true;
  end if;
  insert into lean_private.partition_pages values(p_run,p_child,p_number,p_payload);
  return true;
end $$;
revoke all on function public.lean_partition_stage_page(text,text,text,integer,text)
  from public,anon,authenticated,service_role,lean_posthog_reader;

-- Called on reads and again inside the final transaction. Never trust hashes
-- alone: recompute each payload, compare child counts/IDs/revisions and conflicts.
create function lean_private.partition_ready(p_run text,p_project_ref text,p_verify_pages boolean default true) returns boolean
language plpgsql set search_path=pg_catalog as $$
declare b lean_private.report_builds; q lean_private.refresh_queue; m jsonb; c jsonb; p jsonb; content text;
begin
  select * into b from lean_private.report_builds where run_id=p_run and project_ref=p_project_ref;
  if not found then raise exception 'partition parent missing'; end if;
  select q0.* into q from lean_private.refresh_queue q0 join lean_private.full_builds f on f.run_id=q0.run_id
    where f.base_run=b.run_id and f.enabled;
  if not found or not b.enabled or not q.enabled or q.status<>'queued' or q.expires_at<=clock_timestamp() or
    q.ready_at>clock_timestamp() or not exists(select 1 from lean_private.refresh_limits l
      where l.project_ref=p_project_ref and l.enabled) then return false; end if;
  m:=b.policy->'partitionInventory';
  if b.policy is distinct from q.bundle#>'{base,policy}' then raise exception 'partition binding changed'; end if;
  -- Paged reads use the immutable registered header and check their own page;
  -- do not rehash the complete 32MB parent once for every page. Initial input,
  -- stage routing and BOTH final commits still verify the complete parent.
  if not p_verify_pages then return true; end if;
  perform lean_private.partition_validate(m,p_project_ref,b.shop,(q.bundle#>>'{full,policy,asOf}')::timestamptz,
    q.expires_at,q.bundle->>'evidenceDigest');
  if (select count(*) from lean_private.partition_pages where report_run=p_run) <>
    (select sum(jsonb_array_length(x->'pages')) from jsonb_array_elements(m->'children') x) then return false; end if;
  for c in select value from jsonb_array_elements(m->'children') loop
    for p in select value from jsonb_array_elements(c->'pages') loop
      select payload into content from lean_private.partition_pages where report_run=p_run and child=c->>'id' and page_number=(p->>'number')::integer;
      if not found then return false; end if;
      if octet_length(content)<>(p->>'bytes')::integer or encode(sha256(convert_to(content,'UTF8')),'hex')<>p->>'digest'
        then raise exception 'partition payload changed'; end if;
    end loop;
    if exists(
      with actual as (select r#>>'{source,commerce,order,id}' id,
        (r#>>'{source,commerce,order,createdAt}')::timestamptz created,
        (r#>>'{source,commerce,order,updatedAt}')::timestamptz updated
        from lean_private.partition_pages pg,lateral jsonb_array_elements(pg.payload::jsonb) r
        where report_run=p_run and child=c->>'id'),
      expected as (select o->>'id' id,(o->>'createdAt')::timestamptz created,(o->>'updatedAt')::timestamptz updated
        from jsonb_array_elements(c#>'{inventory,orders}') o)
      (select * from actual except all select * from expected)
      union all (select * from expected except all select * from actual)
    ) then raise exception 'partition child inventory mismatch'; end if;
  end loop;
  if exists(select 1 from lean_private.partition_pages pg,lateral jsonb_array_elements(pg.payload::jsonb) r
    where report_run=p_run group by r#>>'{source,commerce,order,id}' having count(distinct r->'source')>1)
    then raise exception 'partition source conflict'; end if;
  return true;
end $$;

alter function public.lean_report_inputs(text,text) rename to lean_report_inputs_ordinary;
revoke all on function public.lean_report_inputs_ordinary(text,text) from public,anon,authenticated,service_role,lean_posthog_reader;
create function lean_private.partition_report_inputs(p_run text,p_project_ref text,p_verify_pages boolean) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare b lean_private.report_builds; id text; s lean_private.spend_jobs; spend jsonb:='[]'; result jsonb;
begin
  select * into b from lean_private.report_builds where run_id=p_run and project_ref=p_project_ref;
  if not found or not(b.policy ? 'partitionInventory') then return public.lean_report_inputs_ordinary(p_run,p_project_ref); end if;
  if not b.enabled then return jsonb_build_object('state','disabled'); end if;
  if b.completed_at is not null then return jsonb_build_object('state','complete'); end if;
  if not lean_private.partition_ready(p_run,p_project_ref,p_verify_pages) then return jsonb_build_object('state','blocked'); end if;
  foreach id in array b.spend_runs loop
    select * into s from lean_private.spend_jobs where run_id=id and project_ref=p_project_ref
      and report_date between b.from_date and b.through_date;
    if not found or not s.enabled or s.base is null then return jsonb_build_object('state','blocked'); end if;
    spend:=spend||jsonb_build_array(s.base);
  end loop;
  result:=jsonb_build_object('state','ready','shop',b.shop,'publication','observed:'||p_run,
    'fromDate',b.from_date,'throughDate',b.through_date,'policy',b.policy,'history','[]'::jsonb,'spend',spend);
  if octet_length(result::text)>5000000 or
    (select coalesce(sum(jsonb_array_length(x->'rows')),0) from jsonb_array_elements(spend) x)>10000
    then raise exception 'partition report input budget'; end if;
  return result||jsonb_build_object('inputHash',md5(result::text));
end $$;
create function public.lean_report_inputs(p_run text,p_project_ref text) returns jsonb
language sql security definer set search_path=pg_catalog as $$
  select lean_private.partition_report_inputs(p_run,p_project_ref,true)
$$;
create function public.lean_partition_page(p_run text,p_project_ref text,p_child text,p_number integer,p_input_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare input jsonb; content text; expected jsonb;
begin
  input:=lean_private.partition_report_inputs(p_run,p_project_ref,false);
  if input->>'state'<>'ready' or input->>'inputHash' is distinct from p_input_hash then raise exception 'partition input changed'; end if;
  select payload into content from lean_private.partition_pages where report_run=p_run and child=p_child and page_number=p_number;
  if not found then raise exception 'partition page missing'; end if;
  select p into expected from jsonb_array_elements(input#>'{policy,partitionInventory,children}') c,
    lateral jsonb_array_elements(c->'pages') p where c->>'id'=p_child and (p->>'number')::integer=p_number;
  if expected is null or octet_length(content) is distinct from (expected->>'bytes')::integer or
    encode(sha256(convert_to(content,'UTF8')),'hex') is distinct from expected->>'digest'
    then raise exception 'partition payload changed'; end if;
  return jsonb_build_object('child',p_child,'number',p_number,'payload',content,'inputHash',p_input_hash);
end $$;
revoke all on function public.lean_report_inputs(text,text),public.lean_partition_page(text,text,text,integer,text)
  from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_report_inputs(text,text),public.lean_partition_page(text,text,text,integer,text) to service_role;

alter function public.lean_report_finish(text,text,text,jsonb,jsonb) rename to lean_report_finish_ordinary;
revoke all on function public.lean_report_finish_ordinary(text,text,text,jsonb,jsonb)
  from public,anon,authenticated,service_role,lean_posthog_reader;
create function public.lean_report_finish(p_run text,p_project_ref text,p_input_hash text,p_facts jsonb,p_reports jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare b lean_private.report_builds; q lean_private.refresh_queue;
begin
  select * into b from lean_private.report_builds where run_id=p_run and project_ref=p_project_ref for update;
  if b.policy ? 'partitionInventory' then
    perform 1 from lean_private.refresh_limits where project_ref=p_project_ref for share;
    select q0.* into q from lean_private.refresh_queue q0 join lean_private.full_builds f on f.run_id=q0.run_id
      where f.base_run=p_run for share of q0;
    perform 1 from lean_private.partition_pages where report_run=p_run order by child,page_number for share;
    if b.completed_at is null and (not lean_private.partition_ready(p_run,p_project_ref) or
      q.lease_until is null or q.lease_until<=clock_timestamp()) then return false; end if;
    if exists(select 1 from jsonb_each(p_facts) x where jsonb_typeof(x.value)<>'array' or jsonb_array_length(x.value)>10000)
      then raise exception 'partition fact budget'; end if;
  end if;
  return public.lean_report_finish_ordinary(p_run,p_project_ref,p_input_hash,p_facts,p_reports);
end $$;
revoke all on function public.lean_report_finish(text,text,text,jsonb,jsonb) from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_report_finish(text,text,text,jsonb,jsonb) to service_role;

alter function public.lean_full_next(text,text) rename to lean_full_next_ordinary;
revoke all on function public.lean_full_next_ordinary(text,text) from public,anon,authenticated,service_role,lean_posthog_reader;
create function public.lean_full_next(p_run text,p_project_ref text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare f lean_private.full_builds; b lean_private.report_builds; id text; s lean_private.spend_jobs;
begin
  select * into f from lean_private.full_builds where run_id=p_run and project_ref=p_project_ref;
  select * into b from lean_private.report_builds where run_id=f.base_run;
  if not found or not(b.policy ? 'partitionInventory') then return public.lean_full_next_ordinary(p_run,p_project_ref); end if;
  if not f.enabled then return jsonb_build_object('state','disabled'); end if;
  if f.completed_at is not null then return jsonb_build_object('state','complete'); end if;
  if not lean_private.partition_ready(b.run_id,p_project_ref) then return jsonb_build_object('state','blocked'); end if;
  if b.completed_at is not null then return jsonb_build_object('state','ready','stage','full','runId',p_run); end if;
  foreach id in array b.spend_runs loop
    select * into s from lean_private.spend_jobs where run_id=id and project_ref=p_project_ref;
    if not found or not s.enabled then return jsonb_build_object('state','blocked'); end if;
    if s.base is null then return jsonb_build_object('state','ready','stage','spend','runId',id); end if;
  end loop;
  return jsonb_build_object('state','ready','stage','reports','runId',b.run_id);
end $$;
revoke all on function public.lean_full_next(text,text) from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_full_next(text,text) to service_role;

-- The final full candidate must still fence the whole pinned parent, not merely
-- rely on a previously committed observed candidate.
create function lean_private.partition_full_fence() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare f lean_private.full_builds; b lean_private.report_builds;
begin
  if not starts_with(new.publication_id,'full:refresh:') then return new; end if;
  select * into f from lean_private.full_builds where run_id=substring(new.publication_id from 6);
  select * into b from lean_private.report_builds where run_id=f.base_run for share;
  if b.policy ? 'partitionInventory' then
    perform 1 from lean_private.partition_pages where report_run=b.run_id order by child,page_number for share;
    if not lean_private.partition_ready(b.run_id,b.project_ref) then raise exception 'partition full fence'; end if;
  end if;
  return new;
end $$;
create trigger partition_full_fence before insert on lean_private.publications
  for each row execute function lean_private.partition_full_fence();

alter function public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb) rename to lean_full_finish_ordinary;
revoke all on function public.lean_full_finish_ordinary(text,text,uuid,text,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role,lean_posthog_reader;
create function public.lean_full_finish(p_run text,p_project_ref text,p_token uuid,p_input_hash text,
  p_facts jsonb,p_reports jsonb,p_manifest jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare f lean_private.full_builds; b lean_private.report_builds; q lean_private.refresh_queue;
begin
  select * into f from lean_private.full_builds where run_id=p_run and project_ref=p_project_ref for update;
  select * into b from lean_private.report_builds where run_id=f.base_run for share;
  if b.policy ? 'partitionInventory' then
    -- Equal completed replay is a no-op delegated to the existing result hash
    -- fence. It cannot revive an expired run or publish a changed result.
    if f.completed_at is not null then
      return public.lean_full_finish_ordinary(p_run,p_project_ref,p_token,p_input_hash,p_facts,p_reports,p_manifest);
    end if;
    perform 1 from lean_private.refresh_limits where project_ref=p_project_ref for share;
    select * into q from lean_private.refresh_queue where run_id=p_run for share;
    perform 1 from lean_private.partition_pages where report_run=b.run_id order by child,page_number for share;
    if not lean_private.partition_ready(b.run_id,p_project_ref) or q.lease_token is null or
      q.lease_until<=clock_timestamp() or f.lease_token is distinct from p_token or
      exists(select 1 from jsonb_each(p_facts) x where jsonb_typeof(x.value)<>'array' or jsonb_array_length(x.value)>10000)
      then raise exception 'partition full fence or fact budget'; end if;
  end if;
  return public.lean_full_finish_ordinary(p_run,p_project_ref,p_token,p_input_hash,p_facts,p_reports,p_manifest);
end $$;
revoke all on function public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb) to service_role;
revoke all on function lean_private.partition_canonical(jsonb),lean_private.partition_digest(jsonb),
  lean_private.partition_validate(jsonb,text,text,timestamptz,timestamptz,text),
  lean_private.partition_page_immutable(),lean_private.partition_ready(text,text,boolean),
  lean_private.partition_report_inputs(text,text,boolean),lean_private.partition_full_fence()
  from public,anon,authenticated,service_role,lean_posthog_reader;
commit;
