-- PRIVATE PROPOSAL, unnumbered and NOT an installer.
-- Requires 001 + 040/041. Those history dependencies are NOT installed in the
-- parent's September 30 19:03 Pacific target check. Do not reuse an old installer.
-- No rows, sources, jobs, report selection, reader grants or schedule enabled.
begin;
-- Receipt of an independently reviewed authority, not a consent product.
-- Only its future approved producer/owner can write. Jobs cannot mint or renew it.
create table lean_private.history_customer_authority (
  authority_id text primary key check(length(authority_id) between 1 and 128),
  project_ref text not null check(project_ref ~ '^[a-z]{20}$'),
  shop text not null, scope_ref text not null, source_id text not null, schema_version text not null,
  revision bigint not null check(revision>0),
  identity_permission_sha256 text not null check(identity_permission_sha256 ~ '^[a-f0-9]{64}$'),
  captured_at timestamptz not null check(isfinite(captured_at)),
  valid_until timestamptz not null check(isfinite(valid_until) and valid_until>captured_at),
  max_age_seconds integer not null check(max_age_seconds between 1 and 300),
  evidence_ref text not null check(length(trim(evidence_ref))>0),
  available boolean not null default false,
  unique(project_ref,shop,scope_ref)
);
alter table lean_private.history_customer_authority enable row level security;
revoke all on lean_private.history_customer_authority from public,anon,authenticated,service_role;
create function lean_private.history_customer_authority_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if (new.authority_id,new.project_ref,new.shop,new.scope_ref,new.source_id,new.schema_version)
    is distinct from (old.authority_id,old.project_ref,old.shop,old.scope_ref,old.source_id,old.schema_version) or
    new.revision<old.revision or new.captured_at<old.captured_at or
    new.revision=old.revision and (
      new.identity_permission_sha256 is distinct from old.identity_permission_sha256 or
      new.available is distinct from old.available or new.valid_until>old.valid_until or
      new.max_age_seconds>old.max_age_seconds)
    then raise exception 'history customer authority revision required'; end if;
  return new;
end $$;
create trigger history_customer_authority_revision before update on lean_private.history_customer_authority
for each row execute function lean_private.history_customer_authority_immutable();
create table lean_private.history_customer_runs (
  run_id text primary key check(run_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  source_run text not null references lean_private.history_report_jobs,
  scope jsonb not null,
  enabled boolean not null default false,
  state text not null default 'staging' check(state in ('staging','sealed','complete')),
  generation_hash text, result_hash text,
  cursor_id text not null default '', processed integer not null default 0,
  token uuid, lease_until timestamptz, claimed_member text
);
create table lean_private.history_customer_members (
  run_id text not null references lean_private.history_customer_runs,
  member_id text not null check(length(member_id) between 1 and 128),
  customer_id text,
  evidence jsonb not null check(octet_length(evidence::text) <= 5000000),
  result_hash text, ledger_complete boolean, customer_complete boolean, components jsonb,
  primary key(run_id,member_id), unique(run_id,customer_id),
  check(customer_id is null or customer_id ~ '^[a-zA-Z0-9_:-]{8,128}$' and customer_id !~ '^[0-9]+$')
);
-- Independent ownership inventory, NOT manufactured from the candidate.
-- Owner-staged only. PK makes cross-shard duplicate order ownership impossible.
create table lean_private.history_customer_inventory (
  run_id text not null,
  member_id text not null,
  order_id text not null check(order_id ~ '^gid://shopify/Order/[1-9][0-9]*$'),
  updated_at text not null,
  source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
  decision jsonb not null,
  primary key(run_id,order_id),
  foreign key(run_id,member_id) references lean_private.history_customer_members
);
create index history_customer_member_orders on lean_private.history_customer_inventory(run_id,member_id,order_id);
alter table lean_private.history_customer_runs enable row level security;
alter table lean_private.history_customer_members enable row level security;
alter table lean_private.history_customer_inventory enable row level security;
revoke all on lean_private.history_customer_runs,lean_private.history_customer_members,
  lean_private.history_customer_inventory from public,anon,authenticated,service_role;

create function lean_private.history_customer_current_authority(p_run text) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare r lean_private.history_customer_runs; a lean_private.history_customer_authority; now_at timestamptz;
begin
  select * into strict r from lean_private.history_customer_runs where run_id=p_run;
  select * into a from lean_private.history_customer_authority
    where authority_id=r.scope->>'authorityId' for share;
  now_at:=clock_timestamp();
  if not found or not a.available or a.project_ref is distinct from r.scope->>'projectRef' or
    a.shop is distinct from r.scope->>'shop' or a.scope_ref is distinct from r.scope->>'authorityScopeRef' or
    a.revision::text is distinct from r.scope->>'authorityRevision' or
    a.identity_permission_sha256 is distinct from r.scope->>'authorityFingerprint' or
    a.captured_at>now_at or a.captured_at<now_at-make_interval(secs=>a.max_age_seconds) or
    a.valid_until<=now_at or (r.scope->>'expiresAt')::timestamptz<=now_at or
    (r.scope->>'expiresAt')::timestamptz>a.valid_until
    then raise exception 'history customer current authority unavailable'; end if;
  return jsonb_build_object('authorityId',a.authority_id,'revision',a.revision::text,
    'fingerprint',a.identity_permission_sha256,'sourceId',a.source_id,'schemaVersion',a.schema_version,
    'scopeRef',a.scope_ref,'evidenceRef',a.evidence_ref,
    'capturedAt',to_char(a.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'validUntil',to_char(a.valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'maxAgeSeconds',a.max_age_seconds);
end $$;

create function lean_private.history_customer_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare phase text;
begin
  if tg_table_name='history_customer_runs' then
    if (new.run_id,new.source_run,new.scope) is distinct from (old.run_id,old.source_run,old.scope) or
       old.generation_hash is not null and new.generation_hash is distinct from old.generation_hash or
       old.result_hash is not null and new.result_hash is distinct from old.result_hash
      then raise exception 'history customer immutable scope'; end if;
    if new.state is distinct from old.state and not (
      old.state='staging' and new.state='sealed' or old.state='sealed' and new.state='complete')
      then raise exception 'history customer invalid state transition'; end if;
    return new;
  end if;
  if tg_op='UPDATE' and new.run_id is distinct from old.run_id
    then raise exception 'history customer immutable run'; end if;
  select state into phase from lean_private.history_customer_runs
    where run_id=case when tg_op='DELETE' then old.run_id else new.run_id end for share;
  if phase<>'staging' then
    if tg_op<>'UPDATE' or tg_table_name<>'history_customer_members' then
      raise exception 'history customer inventory sealed'; end if;
    if (to_jsonb(new)-array['result_hash','ledger_complete','customer_complete','components'])
      is distinct from (to_jsonb(old)-array['result_hash','ledger_complete','customer_complete','components']) or
      old.result_hash is not null and to_jsonb(new) is distinct from to_jsonb(old)
      then raise exception 'history customer member immutable'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger history_customer_scope_immutable before update on lean_private.history_customer_runs
for each row execute function lean_private.history_customer_immutable();
create trigger history_customer_member_immutable before insert or update or delete on lean_private.history_customer_members
for each row execute function lean_private.history_customer_immutable();
create trigger history_customer_inventory_immutable before insert or update or delete on lean_private.history_customer_inventory
for each row execute function lean_private.history_customer_immutable();

-- Metadata hash stays small: each staged member/order contributes one SHA256.
-- Source values are checked against their expected hashes at seal/finalization
-- and again for the exact bounded shard at finish.
create function lean_private.history_customer_generation(p_run text,p_check_sources boolean)
returns text language plpgsql set search_path=pg_catalog as $$
declare r lean_private.history_customer_runs; h lean_private.history_report_jobs;
  j lean_private.history_import_jobs; n bigint; bytes bigint; members bigint; manifest text; identities bigint;
begin
  select * into strict r from lean_private.history_customer_runs where run_id=p_run;
  perform lean_private.history_customer_current_authority(p_run);
  select * into strict h from lean_private.history_report_jobs where run_id=r.source_run for share;
  select * into strict j from lean_private.history_import_jobs where job_id=h.source_job for share;
  if h.state<>'complete' or j.state<>'complete' or not j.enabled or
    h.scope->'includeCustomerId' is distinct from 'true'::jsonb or
    h.scope->>'projectRef' is distinct from r.scope->>'projectRef' or
    h.scope->>'shop' is distinct from r.scope->>'shop' or
    j.scope->>'projectRef' is distinct from r.scope->>'projectRef' or
    j.scope->>'shop' is distinct from r.scope->>'shop' or
    h.source_hash is distinct from encode(sha256(convert_to(j.completion::text,'UTF8')),'hex') or
    r.scope->>'sourceScopeHash' is distinct from encode(sha256(convert_to(h.scope::text,'UTF8')),'hex') or
    r.scope->>'sourceCompletionHash' is distinct from h.source_hash or
    j.scope->>'untilTime' is null or
    (r.scope->>'completeThrough')::timestamptz>(j.scope->>'untilTime')::timestamptz
    then raise exception 'history customer unavailable generation'; end if;
  -- Immutable staged rows need no whole-population rehash for every member.
  -- Recompute once at seal and once at finalization, not O(members * orders).
  if not p_check_sources then return r.generation_hash; end if;
  select count(*) into n from lean_private.history_customer_inventory where run_id=p_run;
  select count(*) into members from lean_private.history_customer_members where run_id=p_run;
  if n not between 1 and 70000 or n<>j.orders or members not between 1 and 70000 or
    n<>(select count(*) from lean_private.history_import_orders where job_id=h.source_job) or
    exists(select 1 from lean_private.history_customer_members m
      left join lean_private.history_customer_inventory i using(run_id,member_id)
      where m.run_id=p_run group by m.member_id,m.customer_id
      having count(i.order_id) not between 1 and 100 or m.customer_id is null and count(i.order_id)<>1) or
    exists(select 1 from lean_private.history_import_orders o
      left join lean_private.history_customer_inventory i on i.run_id=p_run and i.order_id=o.id
      where o.job_id=h.source_job and i.order_id is null)
    then raise exception 'history customer independent inventory mismatch or budget'; end if;
  select coalesce(sum(octet_length(evidence::text)),0),
    coalesce(sum(jsonb_array_length(evidence->'identity')),0) into bytes,identities
    from lean_private.history_customer_members where run_id=p_run;
  if bytes>268435456 or identities>100000 then raise exception 'history customer evidence budget'; end if;
  -- A local shard must not hide a conflicting interval in another customer's
  -- shard. Connected overlap groups detect cross-owner ambiguity without an
  -- O(identity_rows squared) all-pairs join. Touching half-open intervals are
  -- separate groups, exactly as resolveTemporalIdentity treats them.
  if exists(
    with mappings as (
      select m.customer_id,x->>'namespace' as ns,x->>'identifier' as id,x->>'mappingVersion' as version,
        (x->>'from')::timestamptz as starts,
        coalesce((x->>'to')::timestamptz,'infinity'::timestamptz) as ends
      from lean_private.history_customer_members m
      cross join lateral jsonb_array_elements(m.evidence->'identity') x where m.run_id=p_run
    ), edges as (
      select *,max(ends) over(partition by ns,id,version order by starts,ends,customer_id
        rows between unbounded preceding and 1 preceding) as previous_end from mappings
    ), groups as (
      select *,sum(case when previous_end is null or starts>=previous_end then 1 else 0 end)
        over(partition by ns,id,version order by starts,ends,customer_id rows unbounded preceding) as cluster from edges
    )
    select 1 from groups group by ns,id,version,cluster having count(distinct customer_id)>1
  ) then raise exception 'history customer cross-member identity conflict'; end if;
  if p_check_sources then
    perform 1 from lean_private.history_report_sources where run_id=r.source_run for share;
    select coalesce(sum(octet_length(s.source::text)),0) into bytes
      from lean_private.history_report_sources s where s.run_id=r.source_run;
    if bytes>268435456 then raise exception 'history customer generation source budget'; end if;
    if exists(select 1 from lean_private.history_customer_inventory i
      left join lean_private.history_report_sources s on s.run_id=r.source_run and s.order_id=i.order_id
      left join lean_private.history_import_orders o on o.job_id=h.source_job and o.id=i.order_id
      where i.run_id=p_run and (
        o.id is null or s.source is null or s.source_hash is distinct from i.source_hash or
        s.outcome is null or s.outcome in ('source_revision_changed','source_inventory_mismatch',
          'source_line_bound','interrupted_source_attempt','source_unavailable') or
        s.source_hash is distinct from encode(sha256(convert_to(s.source::text,'UTF8')),'hex') or
        s.source#>>'{commerce,projection}' is distinct from 'financial_customer_id' or
        not ((s.source#>'{commerce,order}') ? 'customer') or
        s.source#>>'{commerce,order,updatedAt}' is distinct from i.updated_at or
        o.source->>'updatedAt' is distinct from i.updated_at or
        s.captured_at is null or s.captured_at>(r.scope->>'asOf')::timestamptz or
        s.captured_at<(r.scope->>'expiresAt')::timestamptz-
          make_interval(secs=>(r.scope->>'maxSourceAgeSeconds')::integer) or
        (o.source->>'createdAt')::timestamptz<(r.scope->>'sourceOrigin')::timestamptz or
        (o.source->>'createdAt')::timestamptz>=(r.scope->>'completeThrough')::timestamptz))
      then raise exception 'history customer source revision or coverage mismatch'; end if;
  end if;
  select string_agg(digest,'' order by kind,id) into manifest from (
    select 'member' as kind, member_id as id,
      encode(sha256(convert_to(jsonb_build_array(member_id,customer_id,evidence)::text,'UTF8')),'hex') as digest
      from lean_private.history_customer_members where run_id=p_run
    union all
    select 'order',order_id,encode(sha256(convert_to(jsonb_build_array(member_id,order_id,updated_at,source_hash,decision)::text,'UTF8')),'hex')
      from lean_private.history_customer_inventory where run_id=p_run
  ) entries;
  if octet_length(manifest)>8960000 then raise exception 'history customer manifest budget'; end if;
  return encode(sha256(convert_to(r.scope::text||r.source_run||manifest,'UTF8')),'hex');
end $$;

-- Owner-only preparation. Explicit source/migration/permission approval and
-- independent-inventory references are required, not created by this function.
create function public.lean_history_customer_seal(p_run text) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.history_customer_runs; digest text; privacy text; field text; expiry timestamptz; asof timestamptz; cfg jsonb;
begin
  select * into strict r from lean_private.history_customer_runs where run_id=p_run for update;
  if r.state<>'staging' then raise exception 'history customer already sealed'; end if;
  if jsonb_typeof(r.scope) is distinct from 'object' or
    r.scope-array['projectRef','shop','asOf','expiresAt','sourceOrigin','completeThrough',
      'sourceScopeHash','sourceCompletionHash','mappingVersion','policy','approvalRef','inventoryRef',
      'migrationEvidenceRef','permissionEvidenceRef','permissionValidUntil','maxSourceAgeSeconds',
      'authorityId','authorityScopeRef','authorityRevision','authorityFingerprint','reporting']<>'{}'::jsonb
    then raise exception 'history customer scope shape'; end if;
  foreach field in array array['projectRef','shop','mappingVersion','approvalRef','inventoryRef',
    'migrationEvidenceRef','permissionEvidenceRef','authorityId','authorityScopeRef','authorityRevision','authorityFingerprint'] loop
    if coalesce(btrim(r.scope->>field),'')='' then raise exception 'history customer authority missing'; end if;
  end loop;
  asof:=(r.scope->>'asOf')::timestamptz; expiry:=(r.scope->>'expiresAt')::timestamptz;
  if r.scope->>'projectRef' !~ '^[a-z]{20}$' or asof is null or not isfinite(asof) or
    asof>clock_timestamp() or expiry is null or not isfinite(expiry) or expiry<=clock_timestamp() or
    expiry>(r.scope->>'permissionValidUntil')::timestamptz or
    (r.scope->>'permissionValidUntil') is null or
    not isfinite((r.scope->>'permissionValidUntil')::timestamptz) or
    coalesce(r.scope->>'maxSourceAgeSeconds','') !~ '^[0-9]{1,6}$' or
    (r.scope->>'maxSourceAgeSeconds')::integer not between 1 and 604800 or
    expiry-asof>make_interval(secs=>(r.scope->>'maxSourceAgeSeconds')::integer) or
    r.scope->>'sourceOrigin' is null or r.scope->>'completeThrough' is null or
    not isfinite((r.scope->>'sourceOrigin')::timestamptz) or
    not isfinite((r.scope->>'completeThrough')::timestamptz) or
    (r.scope->>'sourceOrigin')::timestamptz>=(r.scope->>'completeThrough')::timestamptz or
    (r.scope->>'completeThrough')::timestamptz>asof or
    jsonb_typeof(r.scope->'policy') is distinct from 'object' or
    jsonb_typeof(r.scope->'reporting') is distinct from 'object' or
    jsonb_typeof(r.scope#>'{reporting,cohorts}') is distinct from 'array' or
    jsonb_array_length(r.scope#>'{reporting,cohorts}')>100 or
    jsonb_typeof(r.scope#>'{reporting,cohortCoverage}') is distinct from 'array' or
    jsonb_array_length(r.scope#>'{reporting,cohortCoverage}')>100 or
    coalesce(r.scope#>>'{reporting,definition}','')='' or
    coalesce(r.scope#>>'{reporting,fromDate}','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or
    coalesce(r.scope#>>'{reporting,throughDate}','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or
    (r.scope#>>'{reporting,throughDate}')::date-(r.scope#>>'{reporting,fromDate}')::date not between 0 and 30 or
    exists(select 1 from lean_private.history_customer_members m where m.run_id=p_run and
      m.customer_id is not null and
      m.evidence#>>array['customerHistory',m.customer_id,'completeThrough'] is distinct from r.scope->>'completeThrough')
    then raise exception 'history customer invalid authority clock'; end if;
  if (r.scope->'reporting')-array['definition','fromDate','throughDate','cohorts','cohortCoverage']<>'{}'::jsonb or
    (select count(distinct jsonb_build_array(c->'month',c->'horizonDays'))
      from jsonb_array_elements(r.scope#>'{reporting,cohorts}') c)<>jsonb_array_length(r.scope#>'{reporting,cohorts}') or
    (select count(distinct jsonb_build_array(c->'month',c->'horizonDays'))
      from jsonb_array_elements(r.scope#>'{reporting,cohortCoverage}') c)<>jsonb_array_length(r.scope#>'{reporting,cohortCoverage}')
    then raise exception 'history customer reporting shape'; end if;
  for cfg in select value from jsonb_array_elements(r.scope#>'{reporting,cohorts}') loop
    if jsonb_typeof(cfg) is distinct from 'object' or
      cfg-array['month','horizonDays','graceSeconds','acquisitionDefinition']<>'{}'::jsonb or
      coalesce(cfg->>'month','') !~ '^[0-9]{4}-[0-9]{2}-01$' or
      jsonb_typeof(cfg->'horizonDays') is distinct from 'number' or
      jsonb_typeof(cfg->'graceSeconds') is distinct from 'number' or
      coalesce(cfg->>'horizonDays','') !~ '^[0-9]{1,16}$' or
      coalesce(cfg->>'graceSeconds','') !~ '^[0-9]{1,16}$' or
      (cfg->>'horizonDays')::numeric>9007199254740991 or
      (cfg->>'graceSeconds')::numeric>9007199254740991 or
      coalesce(btrim(cfg->>'acquisitionDefinition'),'')=''
      then raise exception 'history customer cohort policy'; end if;
    perform (cfg->>'month')::date;
  end loop;
  select encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(jsonb_build_array(
    customer_id,evidence->'identity',evidence->'currentlyPermitted',evidence->'removedCustomers')::text,'UTF8')),'hex'),
    '' order by customer_id),''),'UTF8')),'hex') into privacy
    from lean_private.history_customer_members where run_id=p_run and customer_id is not null;
  if privacy is distinct from r.scope->>'authorityFingerprint'
    then raise exception 'history customer privacy inventory mismatch'; end if;
  digest:=lean_private.history_customer_generation(p_run,true);
  insert into lean_private.publications(publication_id,contract_version)
    values('customer-history:'||p_run,'lean-v1-draft.1');
  update lean_private.history_customer_runs set state='sealed',generation_hash=digest where run_id=p_run;
  return digest;
end $$;

create function lean_private.history_customer_input(p_run text,p_member text) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare r lean_private.history_customer_runs; m lean_private.history_customer_members;
  orders jsonb; input jsonb; authority jsonb; bytes bigint; rows bigint;
begin
  select * into strict r from lean_private.history_customer_runs where run_id=p_run;
  select * into strict m from lean_private.history_customer_members where run_id=p_run and member_id=p_member;
  authority:=lean_private.history_customer_current_authority(p_run);
  perform 1 from lean_private.history_report_sources s
    join lean_private.history_customer_inventory i on i.run_id=p_run and i.member_id=p_member and i.order_id=s.order_id
    where s.run_id=r.source_run for share of s;
  select count(*),coalesce(sum(octet_length(s.source::text)),0) into rows,bytes
    from lean_private.history_customer_inventory i
    join lean_private.history_report_sources s on s.run_id=r.source_run and s.order_id=i.order_id
    where i.run_id=p_run and i.member_id=p_member;
  if rows not between 1 and 100 or bytes+octet_length(m.evidence::text)+octet_length(r.scope::text)>7900000
    then raise exception 'history customer shard byte or row budget'; end if;
  if exists(select 1 from lean_private.history_customer_inventory i
    left join lean_private.history_report_sources s on s.run_id=r.source_run and s.order_id=i.order_id
    where i.run_id=p_run and i.member_id=p_member and
      (s.source is null or s.source_hash is distinct from i.source_hash or
       s.source_hash is distinct from encode(sha256(convert_to(s.source::text,'UTF8')),'hex')))
    then raise exception 'history customer changed shard source'; end if;
  select jsonb_agg(jsonb_build_object('id',i.order_id,'updatedAt',i.updated_at,
    'sourceHash',i.source_hash,'decision',i.decision,'source',s.source) order by i.order_id) into orders
    from lean_private.history_customer_inventory i
    join lean_private.history_report_sources s on s.run_id=r.source_run and s.order_id=i.order_id
    where i.run_id=p_run and i.member_id=p_member;
  input:=jsonb_build_object('state','claimed','version',1,'runId',p_run,'memberId',p_member,
    'projectRef',r.scope->>'projectRef','shop',r.scope->>'shop','publication','customer-history:'||p_run,
    'generationHash',r.generation_hash,'asOf',r.scope->>'asOf','expiresAt',r.scope->>'expiresAt',
    'mappingVersion',r.scope->>'mappingVersion','customerId',m.customer_id,'authority',authority,
    'sourceOrigin',r.scope->>'sourceOrigin','completeThrough',r.scope->>'completeThrough','reporting',r.scope->'reporting',
    'policy',r.scope->'policy','evidence',m.evidence,'orders',orders);
  if octet_length(input::text)>8000000 then raise exception 'history customer shard byte budget'; end if;
  return input||jsonb_build_object('inputHash',encode(sha256(convert_to(input::text,'UTF8')),'hex'));
end $$;

create function public.lean_history_customer_claim(p_run text,p_project text,p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.history_customer_runs; member text;
begin
  select * into strict r from lean_private.history_customer_runs where run_id=p_run for update;
  if r.scope->>'projectRef' is distinct from p_project or p_token is null
    then raise exception 'history customer unapproved target'; end if;
  if not r.enabled then return jsonb_build_object('state','disabled'); end if;
  if (r.scope->>'expiresAt')::timestamptz<=clock_timestamp() then return jsonb_build_object('state','expired'); end if;
  if lean_private.history_customer_generation(p_run,false) is distinct from r.generation_hash
    then raise exception 'history customer generation changed'; end if;
  if r.state='complete' then return jsonb_build_object('state','complete'); end if;
  if r.state<>'sealed' then raise exception 'history customer unsealed input'; end if;
  if r.lease_until>clock_timestamp() then return jsonb_build_object('state','busy'); end if;
  select member_id into member from lean_private.history_customer_members
    where run_id=p_run and member_id>r.cursor_id order by member_id limit 1;
  if member is null then raise exception 'history customer inconsistent cursor'; end if;
  update lean_private.history_customer_runs set token=p_token,claimed_member=member,
    lease_until=least((scope->>'expiresAt')::timestamptz,clock_timestamp()+interval '90 seconds') where run_id=p_run;
  return lean_private.history_customer_input(p_run,member);
end $$;

create function public.lean_history_customer_finish(p_run text,p_project text,p_token uuid,
  p_member text,p_input_hash text,p_result jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.history_customer_runs; m lean_private.history_customer_members;
  input jsonb; facts jsonb; t text; item jsonb; digest text; n bigint; expected text[]; cfg jsonb;
  global_control jsonb; local_control jsonb;
  lease_deadline timestamptz;
begin
  select * into strict r from lean_private.history_customer_runs where run_id=p_run for update;
  select * into strict m from lean_private.history_customer_members where run_id=p_run and member_id=p_member for update;
  digest:=encode(sha256(convert_to(p_result::text,'UTF8')),'hex');
  if r.scope->>'projectRef' is distinct from p_project or not r.enabled or
    (r.scope->>'expiresAt')::timestamptz<=clock_timestamp() then return false; end if;
  if lean_private.history_customer_generation(p_run,false) is distinct from r.generation_hash
    then raise exception 'history customer generation changed'; end if;
  input:=lean_private.history_customer_input(p_run,p_member);
  if input->>'inputHash' is distinct from p_input_hash then return false; end if;
  if m.result_hash is not null then
    if m.result_hash is distinct from digest then raise exception 'history customer replay changed'; end if;
    perform lean_private.history_customer_current_authority(p_run);
    return true;
  end if;
  if r.state<>'sealed' or r.token is distinct from p_token or p_token is null or
    r.lease_until is null or r.lease_until<=clock_timestamp() or r.claimed_member is distinct from p_member
    then return false; end if;
  lease_deadline:=r.lease_until;
  if p_result-array['facts','ledgerComplete','customerComplete','evidenceRef','generationHash','digest','components']<>'{}'::jsonb or
    p_result->>'generationHash' is distinct from r.generation_hash or
    p_result->>'evidenceRef' is distinct from m.evidence->>'ref' or
    jsonb_typeof(p_result->'ledgerComplete') is distinct from 'boolean' or
    jsonb_typeof(p_result->'customerComplete') is distinct from 'boolean' or
    jsonb_typeof(p_result->'components') is distinct from 'array' or jsonb_array_length(p_result->'components')>100 or
    octet_length(p_result::text)>16000000 then raise exception 'history customer result shape'; end if;
  facts:=p_result->'facts';
  if jsonb_typeof(facts) is distinct from 'object' or
    not(facts ?& array['customers','identity_map','orders','order_items','sales_ledger','payments',
      'order_item_offers','sessions','marketing_spend_daily','order_attribution']) or
    (select count(*) from jsonb_object_keys(facts))<>10 or
    facts->'order_item_offers'<>'[]'::jsonb or facts->'sessions'<>'[]'::jsonb or
    facts->'marketing_spend_daily'<>'[]'::jsonb or facts->'order_attribution'<>'[]'::jsonb
    then raise exception 'history customer unexpected domains'; end if;
  select array_agg(encode(sha256(convert_to(replace(jsonb_build_array(r.scope->>'shop',
    substring(order_id from '[0-9]+$'))::text,', ',','),'UTF8')),'hex') order by order_id)
    into expected from lean_private.history_customer_inventory where run_id=p_run and member_id=p_member;
  if jsonb_array_length(facts->'orders')<>cardinality(expected) or
    (select count(distinct x->>'order_id') from jsonb_array_elements(facts->'orders') x)<>cardinality(expected) or
    exists(select 1 from jsonb_array_elements(facts->'orders') x
      where not(x->>'order_id'=any(expected)) or x->>'customer_id' is distinct from m.customer_id) or
    jsonb_array_length(facts->'customers')<>(case when m.customer_id is null then 0 else 1 end) or
    exists(select 1 from jsonb_array_elements(facts->'customers') x where x->>'customer_id' is distinct from m.customer_id)
    then raise exception 'history customer result ownership'; end if;
  if (p_result->>'customerComplete')::boolean is distinct from (
    m.customer_id is not null and facts#>'{customers,0,history_complete}'='true'::jsonb and
    facts#>'{customers,0,analytics_permitted}'='true'::jsonb and facts#>>'{customers,0,identity_status}'='resolved') or
    jsonb_array_length(p_result->'components')<>(select count(*) from jsonb_array_elements(r.scope#>'{reporting,cohorts}') c
      where left(c->>'month',7)=left(facts#>>'{customers,0,acquisition_date}',7)) or
    (select count(distinct jsonb_build_array(x->'cohortMonth',x->'horizonDays')) from jsonb_array_elements(p_result->'components') x)
      <>jsonb_array_length(p_result->'components')
    then raise exception 'history customer component membership'; end if;
  for item in select value from jsonb_array_elements(p_result->'components') loop
    select c into cfg from jsonb_array_elements(r.scope#>'{reporting,cohorts}') c
      where c->'month'=item->'cohortMonth' and c->'horizonDays'=item->'horizonDays' and
        c->'graceSeconds'=item->'graceSeconds' and c->'acquisitionDefinition'=item->'acquisitionDefinition';
    select c into global_control from jsonb_array_elements(r.scope#>'{reporting,cohortCoverage}') c
      where c->'month'=item->'cohortMonth' and c->'horizonDays'=item->'horizonDays';
    select c into local_control from jsonb_array_elements(m.evidence->'cohortCoverage') c
      where c->'month'=item->'cohortMonth' and c->'horizonDays'=item->'horizonDays';
    if cfg is null or item-array['cohortMonth','horizonDays','graceSeconds','acquisitionDefinition','asOf',
      'mature','cohortCustomers','repeatCustomers','revenueUsd']<>'{}'::jsonb or
      not(item ?& array['cohortMonth','horizonDays','graceSeconds','acquisitionDefinition','asOf',
        'mature','cohortCustomers','repeatCustomers','revenueUsd']) or
      item->>'asOf' is distinct from r.scope->>'asOf' or
      jsonb_typeof(item->'mature') is distinct from 'boolean' or
      left(item->>'cohortMonth',7) is distinct from left(facts#>>'{customers,0,acquisition_date}',7)
      then raise exception 'history customer component scope'; end if;
    if item->'mature'='true'::jsonb then
      if p_result->'customerComplete' is distinct from 'true'::jsonb or
        global_control->'fullMonthCovered' is distinct from 'true'::jsonb or
        coalesce(length(global_control->>'evidenceRef'),0)=0 or
        (r.scope->>'sourceOrigin')::timestamptz>
          ((cfg->>'month')::date::timestamp at time zone 'America/New_York') or
        (r.scope->>'completeThrough')::timestamptz<
          (((cfg->>'month')::date+interval '1 month')::timestamp at time zone 'America/New_York') or
        item->'cohortCustomers' is distinct from '1'::jsonb or item->'repeatCustomers' not in ('0'::jsonb,'1'::jsonb) or
        -- Match Date.parse milliseconds + H * 86400000 exactly. A PostgreSQL
        -- calendar-day interval changes elapsed duration across DST.
        floor(extract(epoch from (facts#>>'{customers,0,first_eligible_order_at}')::timestamptz)*1000)+
          (cfg->>'horizonDays')::numeric*86400000+(cfg->>'graceSeconds')::numeric*1000>
          least(floor(extract(epoch from (r.scope->>'asOf')::timestamptz)*1000),
            floor(extract(epoch from (r.scope->>'completeThrough')::timestamptz)*1000)) or
        item->'revenueUsd'<>'null'::jsonb and
          (jsonb_typeof(item->'revenueUsd')<>'string' or item->>'revenueUsd' !~ '^-?(0|[1-9][0-9]{0,13})[.][0-9]{6}$')
        then raise exception 'history customer component value'; end if;
      if item->'revenueUsd'<>'null'::jsonb and (
        p_result->'ledgerComplete' is distinct from 'true'::jsonb or
        global_control->'ledgerLineageComplete' is distinct from 'true'::jsonb or
        local_control->'ledgerLineageComplete' is distinct from 'true'::jsonb or
        coalesce(length(local_control->>'evidenceRef'),0)=0 or
        jsonb_typeof(local_control->'originalLedgerIds') is distinct from 'array')
        then raise exception 'history customer revenue admission'; end if;
    elsif item->'cohortCustomers' is distinct from 'null'::jsonb or
      item->'repeatCustomers' is distinct from 'null'::jsonb or item->'revenueUsd' is distinct from 'null'::jsonb then
      raise exception 'history customer immature component value';
    end if;
  end loop;
  foreach t in array array['customers','identity_map','orders','order_items','sales_ledger','payments'] loop
    if jsonb_typeof(facts->t) is distinct from 'array' or jsonb_array_length(facts->t)>10000
      then raise exception 'history customer result budget'; end if;
    for item in select value from jsonb_array_elements(facts->t) loop
      if item->>'publication_id' is distinct from 'customer-history:'||p_run or
        t in ('orders','order_items','sales_ledger','payments') and not(item->>'order_id'=any(expected)) or
        t='identity_map' and item->>'customer_id' is distinct from m.customer_id
        then raise exception 'history customer mixed result'; end if;
    end loop;
    execute format('insert into lean_private.%I select * from jsonb_populate_recordset(null::lean_private.%I,$1)',t,t)
      using facts->t;
  end loop;
  update lean_private.history_customer_members set result_hash=digest,
    ledger_complete=(p_result->>'ledgerComplete')::boolean,
    customer_complete=(p_result->>'customerComplete')::boolean,components=p_result->'components'
    where run_id=p_run and member_id=p_member;
  update lean_private.history_customer_runs set processed=processed+1,cursor_id=p_member,
    token=null,lease_until=null,claimed_member=null where run_id=p_run returning * into r;
  select count(*) into n from lean_private.history_customer_members where run_id=p_run;
  if r.processed=n then
    if exists(select 1 from lean_private.history_customer_members where run_id=p_run and result_hash is null) or
      lean_private.history_customer_generation(p_run,true) is distinct from r.generation_hash
      then raise exception 'history customer finalization incomplete'; end if;
    select encode(sha256(convert_to(string_agg(result_hash,'' order by member_id),'UTF8')),'hex') into digest
      from lean_private.history_customer_members where run_id=p_run;
    update lean_private.history_customer_runs set state='complete',result_hash=digest where run_id=p_run;
  end if;
  -- Recheck after all writes, not only before a potentially slow locked step.
  -- Raising rolls the whole transaction back; no success watermark advances.
  perform lean_private.history_customer_current_authority(p_run);
  if lease_deadline<=clock_timestamp() then
    raise exception 'history customer finish expired'; end if;
  -- No certification, selection, report write, freshness claim or export.
  return true;
end $$;

-- Source facts belong to one immutable completed input generation. This does
-- not certify them or change any other publication's existing write behavior.
create function lean_private.history_customer_fact_guard() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare pub text; r lean_private.history_customer_runs;
begin
  pub:=case when tg_op='DELETE' then old.publication_id else new.publication_id end;
  if tg_op='UPDATE' and starts_with(old.publication_id,'customer-history:') then
    raise exception 'history customer fact immutable'; end if;
  if starts_with(pub,'customer-history:') then
    select * into strict r from lean_private.history_customer_runs
      where run_id=substring(pub from length('customer-history:')+1) for share;
    if tg_op<>'INSERT' or r.state<>'sealed' or not r.enabled or r.claimed_member is null or
      r.lease_until is null or r.lease_until<=clock_timestamp() or
      exists(select 1 from lean_private.history_customer_members
        where run_id=r.run_id and member_id=r.claimed_member and result_hash is not null)
      then raise exception 'history customer fact immutable'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['customers','identity_map','orders','order_items','sales_ledger','payments'] loop
    execute format('create trigger history_customer_fact_guard before insert or update or delete on lean_private.%I
      for each row execute function lean_private.history_customer_fact_guard()',t);
  end loop;
end $$;

-- Private bounded adapter for the NEW full-input wrapper. All arguments must
-- come from its owner-registered full scope and actual bounded base/replacements.
-- No independent report rows or ratios are summed.
create function lean_private.history_customer_report_input(p_run text,p_project text,p_from date,p_through date,
  p_policy jsonb,p_order_keys text[]) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare r lean_private.history_customer_runs; ready boolean; dates jsonb:='[]'; cohorts jsonb:='[]';
  bindings jsonb; input jsonb; d date; cfg jsonb; claim jsonb; n bigint; found_n bigint; mature boolean;
  repeats bigint; revenue numeric; revenue_ready boolean; full_month boolean; count_new bigint;
  pub text; rows_bytes bigint; authority jsonb;
begin
  select * into strict r from lean_private.history_customer_runs where run_id=p_run for share;
  if not r.enabled or r.state<>'complete' or r.result_hash is null or
    r.scope->>'projectRef' is distinct from p_project or
    lean_private.history_customer_generation(p_run,false) is distinct from r.generation_hash
    then raise exception 'history customer completed input unavailable'; end if;
  authority:=lean_private.history_customer_current_authority(p_run);
  if p_from is null or p_through is null or not isfinite(p_from) or not isfinite(p_through) or
    p_through-p_from not between 0 and 30 or
    p_from::text is distinct from r.scope#>>'{reporting,fromDate}' or
    p_through::text is distinct from r.scope#>>'{reporting,throughDate}' or
    p_policy->>'definition' is distinct from r.scope#>>'{reporting,definition}' or
    p_policy->>'mappingVersion' is distinct from r.scope->>'mappingVersion' or
    p_policy->>'asOf' is distinct from r.scope->>'asOf' or
    p_policy->'cohorts' is distinct from r.scope#>'{reporting,cohorts}' or
    p_order_keys is null or cardinality(p_order_keys)>10100 or
    octet_length(p_order_keys::text)>1000000 or
    exists(select 1 from unnest(p_order_keys) k where k is null or k !~ '^[a-f0-9]{64}$') or
    (select count(distinct k) from unnest(p_order_keys) k)<>cardinality(p_order_keys)
    then raise exception 'history customer report scope'; end if;
  pub:='customer-history:'||p_run;
  ready:=not exists(select 1 from lean_private.history_customer_members
    where run_id=p_run and customer_id is not null and customer_complete is distinct from true)
    and not exists(select 1 from lean_private.orders
      where publication_id=pub and eligibility_status='eligible' and customer_id is null);
  for d in select generate_series(p_from,p_through,'1 day')::date loop
    count_new:=null;
    if ready and (r.scope->>'sourceOrigin')::timestamptz<=d::timestamp at time zone 'America/New_York' and
      (r.scope->>'completeThrough')::timestamptz>=(d+1)::timestamp at time zone 'America/New_York' then
      select count(*) into count_new from lean_private.customers where publication_id=pub and acquisition_date=d;
    end if;
    dates:=dates||jsonb_build_array(jsonb_build_object('date',d::text,'newCustomers',count_new));
  end loop;
  for cfg in select value from jsonb_array_elements(p_policy->'cohorts') loop
    if (select count(*) from jsonb_array_elements(r.scope#>'{reporting,cohortCoverage}') x
      where x->>'month'=cfg->>'month' and x->'horizonDays'=cfg->'horizonDays')>1
      then raise exception 'history customer duplicate cohort coverage'; end if;
    select x into claim from jsonb_array_elements(r.scope#>'{reporting,cohortCoverage}') x
      where x->>'month'=cfg->>'month' and x->'horizonDays'=cfg->'horizonDays';
    full_month:=coalesce(claim->'fullMonthCovered'='true'::jsonb and length(claim->>'evidenceRef')>0,false) and
      (r.scope->>'sourceOrigin')::timestamptz<=(cfg->>'month')::date::timestamp at time zone 'America/New_York' and
      (r.scope->>'completeThrough')::timestamptz>=
        (((cfg->>'month')::date+interval '1 month')::timestamp at time zone 'America/New_York');
    select count(*) into n from lean_private.customers where publication_id=pub and
      date_trunc('month',acquisition_date::timestamp)::date=(cfg->>'month')::date;
    select count(*),coalesce(bool_and(x->'mature'='true'::jsonb),true),
      coalesce(sum((x->>'repeatCustomers')::bigint),0),
      coalesce(bool_and(m.ledger_complete is true and
        x->'revenueUsd' is distinct from 'null'::jsonb and x ? 'revenueUsd'),true),
      coalesce(sum((x->>'revenueUsd')::numeric),0)
      into found_n,mature,repeats,revenue_ready,revenue
      from lean_private.history_customer_members m
      join lean_private.customers c on c.publication_id=pub and c.customer_id=m.customer_id
      cross join lateral jsonb_array_elements(m.components) x
      where m.run_id=p_run and date_trunc('month',c.acquisition_date::timestamp)::date=(cfg->>'month')::date and
        x->>'cohortMonth'=cfg->>'month' and x->'horizonDays'=cfg->'horizonDays' and
        x->'graceSeconds'=cfg->'graceSeconds' and x->>'acquisitionDefinition'=cfg->>'acquisitionDefinition' and
        x->>'asOf'=p_policy->>'asOf';
    if found_n<>n or n>70000 or repeats<0 or repeats>n
      then raise exception 'history customer incomplete cohort components'; end if;
    mature:=ready and full_month and mature;
    revenue_ready:=mature and revenue_ready and coalesce(claim->'ledgerLineageComplete'='true'::jsonb,false);
    cohorts:=cohorts||jsonb_build_array(jsonb_build_object(
      'cohortMonth',cfg->>'month','horizonDays',cfg->'horizonDays','graceSeconds',cfg->'graceSeconds',
      'acquisitionDefinition',cfg->>'acquisitionDefinition','asOf',p_policy->>'asOf','mature',mature,
      'cohortCustomers',case when mature then n else null end,'repeatCustomers',case when mature then repeats else null end,
      'revenueUsd',case when revenue_ready then revenue::numeric(20,6)::text else null end));
  end loop;
  -- Bound the exact report-window lookup before serializing it.
  select count(*),coalesce(sum(octet_length(to_jsonb(o)::text)),0) into n,rows_bytes
    from lean_private.orders o where publication_id=pub and order_id=any(p_order_keys);
  if n<>cardinality(p_order_keys) or rows_bytes>7900000
    then raise exception 'history customer report order inventory'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('orderId',o.order_id,'customerId',o.customer_id,
    'paidAt',to_char(o.paid_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'sourceUpdatedAt',to_char(o.source_updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'eligibility',o.eligibility_status,'firstEligibleOrder',coalesce(c.first_eligible_order_id=o.order_id,false))
    order by o.order_id),'[]') into bindings
    from lean_private.orders o left join lean_private.customers c using(publication_id,customer_id)
    where o.publication_id=pub and o.order_id=any(p_order_keys);
  input:=jsonb_build_object('version',1,'runId',p_run,'sourcePublication',pub,'sourceRun',r.source_run,
    'sourceCompletionHash',r.scope->>'sourceCompletionHash','generationHash',r.generation_hash,'resultHash',r.result_hash,
    'projectRef',p_project,'shop',r.scope->>'shop','fromDate',p_from::text,'throughDate',p_through::text,
    'definition',p_policy->>'definition','mappingVersion',p_policy->>'mappingVersion','asOf',p_policy->>'asOf',
    'sourceOrigin',r.scope->>'sourceOrigin','completeThrough',r.scope->>'completeThrough','authority',authority,
    'dates',dates,'cohorts',cohorts,'orderBindings',bindings);
  if octet_length(input::text)>4000000 then raise exception 'history customer report input budget'; end if;
  perform lean_private.history_customer_current_authority(p_run);
  return input;
end $$;

revoke all on function lean_private.history_customer_immutable(),
  lean_private.history_customer_authority_immutable(),lean_private.history_customer_current_authority(text),
  lean_private.history_customer_fact_guard(),
  lean_private.history_customer_report_input(text,text,date,date,jsonb,text[]),
  lean_private.history_customer_generation(text,boolean),lean_private.history_customer_input(text,text),
  public.lean_history_customer_seal(text),
  public.lean_history_customer_claim(text,text,uuid),
  public.lean_history_customer_finish(text,text,uuid,text,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.lean_history_customer_claim(text,text,uuid),
  public.lean_history_customer_finish(text,text,uuid,text,text,jsonb) to service_role;
commit;
