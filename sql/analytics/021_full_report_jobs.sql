-- REVIEW ONLY. Requires 001,013,014,018,019,020. No source or schedule enabled.
begin;
create table lean_private.full_builds (
  run_id text primary key check(length(run_id) between 1 and 128),
  project_ref text not null check(project_ref ~ '^[a-z]{20}$'),
  base_run text not null references lean_private.report_builds,
  policy jsonb not null check(jsonb_typeof(policy)='object'),
  evidence jsonb not null check(jsonb_typeof(evidence)='object'),
  behavior jsonb not null check(jsonb_typeof(behavior)='object'),
  approval_ref text not null check(length(trim(approval_ref))>0),
  actor_ref text not null check(length(trim(actor_ref))>0),
  enabled boolean not null default false,
  lease_token uuid, lease_until timestamptz, attempts integer not null default 0 check(attempts between 0 and 3),
  completed_at timestamptz, result_hash text, manifest jsonb,
  check((completed_at is null)=(result_hash is null)),
  check(octet_length(policy::text)+octet_length(evidence::text)+octet_length(behavior::text)<=5000000)
);
alter table lean_private.full_builds enable row level security;
revoke all on lean_private.full_builds from public,anon,authenticated,service_role;
create function lean_private.full_scope_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if (to_jsonb(old)-array['enabled','completed_at','result_hash','manifest','lease_token','lease_until','attempts']) is distinct from
     (to_jsonb(new)-array['enabled','completed_at','result_hash','manifest','lease_token','lease_until','attempts']) or old.completed_at is not null and
     (old.result_hash,old.completed_at,old.manifest) is distinct from (new.result_hash,new.completed_at,new.manifest) then
    raise exception 'full scope/result immutable';
  end if;
  return new;
end $$;
create trigger immutable_full_scope before update on lean_private.full_builds
  for each row execute function lean_private.full_scope_immutable();
create function public.lean_full_claim(p_run text,p_project_ref text,p_token uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
  if p_token is null then raise exception 'missing full lease'; end if;
  update lean_private.full_builds set lease_token=p_token,lease_until=clock_timestamp()+interval '120 seconds',attempts=attempts+1
    where run_id=p_run and project_ref=p_project_ref and enabled and completed_at is null and attempts<3 and
      (lease_until is null or lease_until<=clock_timestamp());
  return found;
end $$;
create function public.lean_full_fail(p_run text,p_project_ref text,p_token uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
  update lean_private.full_builds set lease_token=null,lease_until=null
    where run_id=p_run and project_ref=p_project_ref and lease_token=p_token and
      lease_until>clock_timestamp() and completed_at is null;
  return found;
end $$;
create function public.lean_full_inputs(p_run text,p_project_ref text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.full_builds; b lean_private.report_builds; t text; rows jsonb; facts jsonb := '{}'; input jsonb; projection text;
begin
  select * into r from lean_private.full_builds where run_id=p_run and project_ref=p_project_ref;
  if not found then raise exception 'unapproved full target'; end if;
  if not r.enabled then return jsonb_build_object('state','disabled'); end if;
  if r.completed_at is not null then return jsonb_build_object('state','complete'); end if;
  select * into b from lean_private.report_builds where run_id=r.base_run and project_ref=r.project_ref;
  if not found or not b.enabled or b.completed_at is null then return jsonb_build_object('state','blocked'); end if;
  foreach t in array array['customers','identity_map','orders','order_items','sales_ledger','payments',
    'order_item_offers','sessions','marketing_spend_daily','order_attribution'] loop
    -- JSON numeric values would be rounded by JavaScript before reconciliation.
    -- Preserve fixed-precision decimals as strings and timestamps as UTC ISO.
    select string_agg(format('%L,%s',a.attname,case
      when a.atttypid='numeric'::regtype then format('x.%I::text',a.attname)
      when a.atttypid='timestamptz'::regtype then
        format('to_char(x.%I at time zone ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',a.attname)
      else format('x.%I',a.attname) end),',' order by a.attnum) into projection
      from pg_attribute a where a.attrelid=format('lean_private.%I',t)::regclass
        and a.attnum>0 and not a.attisdropped;
    execute format('select coalesce(jsonb_agg(jsonb_build_object(%s) order by to_jsonb(x)::text),''[]''::jsonb)
      from lean_private.%I x where publication_id=$1',projection,t) into rows using 'observed:'||b.run_id;
    if jsonb_array_length(rows)>10000 then raise exception 'full source row budget'; end if;
    facts := facts || jsonb_build_object(t,rows);
  end loop;
  input := jsonb_build_object('state','ready','publication','full:'||r.run_id,'shop',b.shop,
    'fromDate',b.from_date,'throughDate',b.through_date,'facts',facts,
    'policy',r.policy,'evidence',r.evidence,'behavior',r.behavior,
    'deferredOrders',coalesce(b.policy->'deferredOrders','[]'::jsonb));
  if octet_length(input::text)>8000000 then raise exception 'full input budget'; end if;
  return input || jsonb_build_object('inputHash',md5(input::text));
end $$;
create function public.lean_full_finish(p_run text,p_project_ref text,p_token uuid,p_input_hash text,
  p_facts jsonb,p_reports jsonb,p_manifest jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.full_builds; b lean_private.report_builds; input jsonb;
  pub text; hash text; t text; item jsonb; expected_days integer;
  fact_names text[] := array['customers','identity_map','orders','order_items','sales_ledger','payments',
    'order_item_offers','sessions','marketing_spend_daily','order_attribution'];
  report_names text[] := array['store_daily','product_daily','acquisition_daily','customer_cohorts','funnel_daily'];
begin
  select * into r from lean_private.full_builds where run_id=p_run and project_ref=p_project_ref for update;
  if not found or not r.enabled then return false; end if;
  if p_facts is null or jsonb_typeof(p_facts)<>'object' or p_reports is null or jsonb_typeof(p_reports)<>'object' or
    p_manifest is null or jsonb_typeof(p_manifest)<>'object' or
    octet_length(p_facts::text)+octet_length(p_reports::text)+octet_length(p_manifest::text)>16000000
    then raise exception 'invalid full batch'; end if;
  hash := md5(p_facts::text||p_reports::text||p_manifest::text);
  if r.completed_at is not null then
    if r.result_hash is distinct from hash then raise exception 'completed full build immutable'; end if;
    return true;
  end if;
  if r.lease_token is distinct from p_token or r.lease_until is null or r.lease_until<=clock_timestamp()
    then return false; end if;
  select * into b from lean_private.report_builds where run_id=r.base_run for share;
  -- Block concurrent base fact writes while re-hashing and committing.
  perform 1 from lean_private.publications where publication_id='observed:'||r.base_run for update;
  input := public.lean_full_inputs(p_run,p_project_ref);
  if input->>'state'<>'ready' or input->>'inputHash' is distinct from p_input_hash then return false; end if;
  expected_days := b.through_date-b.from_date+1;
  if (select count(*) from jsonb_object_keys(p_facts))<>10 or
    (select count(*) from jsonb_object_keys(p_reports))<>5 then raise exception 'invalid full domains'; end if;
  if p_manifest->>'digest' is null or p_manifest->>'digest' !~ '^[a-f0-9]{64}$' or
    p_manifest->>'evidenceRef' is distinct from r.evidence->>'ref' or
    (select count(*) from jsonb_object_keys(p_manifest))<>5 or
    not(p_manifest ?& array['nativeEvents','logicalEvents','digest','evidenceRef','gates'])
    then raise exception 'invalid event manifest'; end if;
  if jsonb_typeof(p_manifest->'gates') is distinct from 'array' or
    jsonb_array_length(p_manifest->'gates')<>expected_days or
    coalesce(p_manifest->>'nativeEvents','') !~ '^[0-9]+$' or coalesce(p_manifest->>'logicalEvents','') !~ '^[0-9]+$' or
    (p_manifest->>'nativeEvents')::bigint>10000 or
    (p_manifest->>'logicalEvents')::bigint>(p_manifest->>'nativeEvents')::bigint or
    (select count(distinct d->>'date') from jsonb_array_elements(p_manifest->'gates') d)<>expected_days or
    exists(select 1 from jsonb_array_elements(p_manifest->'gates') d where
      d->>'date' is null or (d->>'date')::date not between b.from_date and b.through_date or
      jsonb_typeof(d->'gates') is distinct from 'object' or
      not(d->'gates' ?& array['ledger','cash','orders','purchase','customers','spend','attribution','behavior','productAllocation']))
    then raise exception 'invalid full coverage manifest'; end if;
  if jsonb_array_length(p_reports->'store_daily')<>expected_days or
    (select count(distinct x->>'report_date') from jsonb_array_elements(p_reports->'store_daily') x)<>expected_days or
    jsonb_array_length(p_reports->'customer_cohorts')<>jsonb_array_length(r.policy->'cohorts') or
    (select count(distinct x->>'report_date') from jsonb_array_elements(p_reports->'funnel_daily') x
      where x->>'stage_id'='all_sessions')<>expected_days
    then raise exception 'incomplete full report domains'; end if;
  pub := 'full:'||p_run;
  insert into lean_private.publications(publication_id,contract_version) values(pub,'lean-v1-draft.1');
  foreach t in array fact_names loop
    if jsonb_typeof(p_facts->t) is distinct from 'array' or jsonb_array_length(p_facts->t)>100000
      then raise exception 'invalid full fact rows'; end if;
    for item in select value from jsonb_array_elements(p_facts->t) loop
      if item->>'publication_id' is distinct from pub then raise exception 'mixed full publication'; end if;
      if t='orders' and item->>'shop_id' is distinct from b.shop then raise exception 'mixed full shop'; end if;
      if t='order_attribution' and item->>'model_version' is distinct from r.policy->'attribution'->>'modelVersion'
        then raise exception 'mixed full model'; end if;
    end loop;
    execute format('insert into lean_private.%I select * from jsonb_populate_recordset(null::lean_private.%I,$1)',t,t)
      using p_facts->t;
  end loop;
  foreach t in array report_names loop
    if jsonb_typeof(p_reports->t) is distinct from 'array' or jsonb_array_length(p_reports->t)>20000
      then raise exception 'invalid full report rows'; end if;
    for item in select value from jsonb_array_elements(p_reports->t) loop
      if item->>'publication_id' is distinct from pub or item->>'shop_id' is distinct from b.shop or
        item->>'definition_version' is distinct from r.policy->>'definition' or
        item->'is_stale' is distinct from 'true'::jsonb or
        jsonb_typeof(item->'readiness') is distinct from 'object' then raise exception 'invalid full report scope'; end if;
      if t<>'customer_cohorts' and ((item->>'report_date')::date not between b.from_date and b.through_date or
        item->>'report_date' is null) then raise exception 'full report date scope'; end if;
      if exists(select 1 from jsonb_each_text(item->'readiness') v where v.value not in ('withheld','observed_unverified'))
        then raise exception 'uncertified full readiness'; end if;
    end loop;
    execute format('insert into lean_private.%I select * from jsonb_populate_recordset(null::lean_private.%I,$1)',
      'report_'||t,'report_'||t) using p_reports->t;
  end loop;
  update lean_private.full_builds set completed_at=clock_timestamp(),result_hash=hash,manifest=p_manifest,
    lease_token=null,lease_until=null where run_id=p_run;
  return true;
end $$;
revoke all on function public.lean_full_inputs(text,text) from public,anon,authenticated,service_role;
revoke all on function public.lean_full_claim(text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.lean_full_fail(text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.lean_full_inputs(text,text) to service_role;
grant execute on function public.lean_full_claim(text,text,uuid) to service_role;
grant execute on function public.lean_full_fail(text,text,uuid) to service_role;
grant execute on function public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb) to service_role;
commit;
