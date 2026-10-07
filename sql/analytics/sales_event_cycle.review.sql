-- PRIVATE DEFAULT-OFF successor. Requires reviewed event-window, marketing and
-- Google automatic components. No source, grant row, schedule or enable action.
begin;
set local search_path=pg_catalog;
do $pins$
declare pins jsonb:=nullif(current_setting('lean.sales_event_cycle_install_contract',true),'')::jsonb;
  pin jsonb; f record; n integer;
begin
  if jsonb_typeof(pins) is distinct from 'array' or jsonb_array_length(pins)<7 or
    to_regclass('lean_private.sales_event_cycles') is not null then raise exception 'UNBOUND event cycle'; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and
    (p.proname like 'lean_report_inputs%' or p.proname like 'lean_report_finish%' or
     p.proname like 'lean_full_inputs%' or p.proname like 'lean_full_finish%' or
     p.proname in ('lean_google_auto_cycle_binding','lean_sales_event_window_register','lean_marketing_spend_bind'));
  if n<>jsonb_array_length(pins) or (select count(distinct x->>'signature') from jsonb_array_elements(pins) x)<>n
    then raise exception 'event cycle incomplete function pins'; end if;
  for pin in select value from jsonb_array_elements(pins) loop
    select p.*,s.nspname into f from pg_proc p join pg_namespace s on s.oid=p.pronamespace where p.oid=to_regprocedure(pin->>'signature');
    if not found or f.nspname<>'public' or
      not(f.proname like 'lean_report_inputs%' or f.proname like 'lean_report_finish%' or
        f.proname like 'lean_full_inputs%' or f.proname like 'lean_full_finish%' or
        f.proname in ('lean_google_auto_cycle_binding','lean_sales_event_window_register','lean_marketing_spend_bind')) or
      f.proowner<>current_user::regrole::oid or not f.prosecdef or
      f.proconfig is distinct from array['search_path=pg_catalog'] or f.oid::text is distinct from pin->>'oid' or
      f.proowner::text is distinct from pin->>'ownerOid' or
      encode(sha256(convert_to(pg_get_functiondef(f.oid),'UTF8')),'hex') is distinct from pin->>'definitionSha256' or
      encode(sha256(convert_to(coalesce(f.proacl::text,'null'),'UTF8')),'hex') is distinct from pin->>'aclSha256'
      then raise exception 'event cycle current function mismatch'; end if;
  end loop;
  perform set_config('lean.sales_event_cycle_prior_acl',(
    select jsonb_object_agg(p.oid::regprocedure::text,(select jsonb_agg(jsonb_build_object('grantee',a.grantee,
      'grantor',a.grantor,'grantable',a.is_grantable) order by a.grantee,a.grantor,a.is_grantable)
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.privilege_type='EXECUTE'))
    from pg_proc p where p.oid=any(array['public.lean_report_inputs(text,text)'::regprocedure::oid,
      'public.lean_report_finish(text,text,text,jsonb,jsonb)'::regprocedure::oid,
      'public.lean_full_inputs(text,text)'::regprocedure::oid,
      'public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb)'::regprocedure::oid]))::text,true);
end $pins$;

create table lean_private.sales_event_cycle_grants (
  grant_id text primary key, revision bigint not null check(revision>0),
  project_ref text not null check(project_ref ~ '^[a-z]{20}$'), shop text not null,
  google_grant_id text not null, google_grant_revision bigint not null check(google_grant_revision>0),
  from_date date not null, through_date date not null check(through_date-from_date between 0 and 30),
  policy jsonb not null, business_policy jsonb not null, standing_scope jsonb not null,
  customer_cycle_pins jsonb not null,
  source_limits jsonb not null default '{"connectorRequests":2,"originalRequests":20,"customerRequests":65,"totalRequests":87,"connectorResponseBytes":2000000,"originalResponseBytes":8388608,"originalTotalBytes":67108864,"customerResponseBytes":1048576,"customerTotalBytes":16777216,"totalBytes":87886080,"acquisitionSeconds":300}'::jsonb,
  approval_ref text not null check(length(trim(approval_ref)) between 1 and 512),
  actor_ref text not null check(length(trim(actor_ref)) between 1 and 512),
  authorization_ref text not null check(length(trim(authorization_ref)) between 1 and 512),
  not_before timestamptz not null, expires_at timestamptz not null,
  max_age_seconds integer not null check(max_age_seconds between 1 and 86400),
  max_cycles integer not null check(max_cycles between 1 and 1000), attempts integer not null default 0,
  enabled boolean not null default false, revoked boolean not null default false,
  check(isfinite(not_before) and isfinite(expires_at) and expires_at>not_before and expires_at<=not_before+interval '14 days'),
  check(attempts between 0 and max_cycles),
  check(jsonb_typeof(policy)='object' and not(policy ?| array['asOf','salesEventWindow','nativeSpendWindow','freshGoogleSpend','customerGeneration','googleDelivery'])),
  check(jsonb_typeof(business_policy)='object' and jsonb_typeof(standing_scope)='object' and jsonb_typeof(customer_cycle_pins)='object')
  ,check(source_limits='{"connectorRequests":2,"originalRequests":20,"customerRequests":65,"totalRequests":87,"connectorResponseBytes":2000000,"originalResponseBytes":8388608,"originalTotalBytes":67108864,"customerResponseBytes":1048576,"customerTotalBytes":16777216,"totalBytes":87886080,"acquisitionSeconds":300}'::jsonb)
);
create table lean_private.sales_event_cycles (
  cycle_id uuid primary key, grant_id text not null references lean_private.sales_event_cycle_grants,
  grant_revision bigint not null, report_date date not null, started_at timestamptz not null,
  slot_ordinal integer not null check(slot_ordinal between 1 and 1000), slot_not_before timestamptz not null,
  deadline timestamptz not null, valid_until timestamptz not null,
  run_id text not null unique, base_run text not null unique,
  state text not null check(state in ('capture','staged','enabled')),
  google_capture_sha256 text not null, meta_packet_sha256 text not null,
  source_digest text, scope_hash text, spend_packet jsonb,
  enabled boolean not null default false,
  unique(grant_id,slot_ordinal),
  check(isfinite(slot_not_before) and slot_not_before<=started_at),
  check(deadline>started_at and deadline<=started_at+interval '5 minutes' and valid_until>=deadline),
  check((state='capture')=(spend_packet is null)),
  check(spend_packet is null or octet_length(spend_packet::text)<=5000000)
);
alter table lean_private.sales_event_cycle_grants enable row level security;
alter table lean_private.sales_event_cycles enable row level security;
revoke all on lean_private.sales_event_cycle_grants,lean_private.sales_event_cycles from public,anon,authenticated,service_role;
create function lean_private.sales_event_cycle_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' then raise exception 'event cycle immutable'; end if;
  if tg_table_name='sales_event_cycle_grants' then
    if (to_jsonb(old)-array['enabled','revoked','attempts']) is distinct from (to_jsonb(new)-array['enabled','revoked','attempts']) or
      new.attempts<old.attempts or old.revoked and not new.revoked then raise exception 'event grant immutable'; end if;
  elsif (to_jsonb(old)-array['state','source_digest','scope_hash','spend_packet','enabled']) is distinct from
        (to_jsonb(new)-array['state','source_digest','scope_hash','spend_packet','enabled']) or
    old.spend_packet is not null and (old.spend_packet is distinct from new.spend_packet or
      old.source_digest is distinct from new.source_digest or old.scope_hash is distinct from new.scope_hash) or
    not(old.state=new.state or old.state='capture' and new.state='staged' or old.state='staged' and new.state='enabled')
    then raise exception 'event cycle source immutable'; end if;
  return new;
end $$;
create trigger event_cycle_grant_immutable before update or delete on lean_private.sales_event_cycle_grants
for each row execute function lean_private.sales_event_cycle_immutable();
create trigger event_cycle_immutable before update or delete on lean_private.sales_event_cycles
for each row execute function lean_private.sales_event_cycle_immutable();

-- The owner selects a finite cap. It cannot exceed the real matching Google
-- slot inventory within this B1 grant's dates and before its expiry. An already
-- committed, still-fresh Google slot can precede the later B1 claim's not-before.
create function lean_private.sales_event_cycle_slot_count(p_grant text) returns integer
language sql stable set search_path=pg_catalog as $$
  select count(*)::integer from lean_private.sales_event_cycle_grants b
    join lean_private.google_auto_grants a on a.grant_id=b.google_grant_id and a.revision=b.google_grant_revision
    cross join lateral jsonb_array_elements(a.capture_slots) slot
  where b.grant_id=p_grant and (slot->>'date')::date between b.from_date and b.through_date
    and (slot->>'notBeforeUTC')::timestamptz<b.expires_at
$$;

-- Common ordering: Google grant/policy/cycle via accessor, B1 grant, B1 cycle,
-- then event input/base/full using the preceding event-window component.
create function lean_private.sales_event_cycle_current(p_cycle uuid,p_enabled boolean) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare c lean_private.sales_event_cycles; g lean_private.sales_event_cycle_grants; v jsonb;
begin
  v:=public.lean_google_auto_cycle_binding(p_cycle);
  select g0.* into strict g from lean_private.sales_event_cycle_grants g0
    join lean_private.sales_event_cycles c0 on c0.grant_id=g0.grant_id where c0.cycle_id=p_cycle for share of g0;
  select * into strict c from lean_private.sales_event_cycles where cycle_id=p_cycle for update;
  if not g.enabled or g.revoked or g.revision<>c.grant_revision or g.max_cycles>lean_private.sales_event_cycle_slot_count(g.grant_id) or
    clock_timestamp()<g.not_before or
    clock_timestamp()>=least(g.expires_at,c.valid_until,(v->>'validUntil')::timestamptz) or
    v->>'grantId' is distinct from g.google_grant_id or (v->>'grantRevision')::bigint<>g.google_grant_revision or
    v->>'captureSha256' is distinct from c.google_capture_sha256 or
    v->>'metaPacketSha256' is distinct from c.meta_packet_sha256 or
    v->>'projectRef' is distinct from g.project_ref or v->>'shop' is distinct from g.shop or
    (v->>'slotOrdinal')::integer is distinct from c.slot_ordinal or
    (v->>'slotNotBeforeUTC')::timestamptz is distinct from c.slot_not_before or
    (v->>'date')::date<>c.report_date or
    p_enabled and (not c.enabled or c.state<>'enabled') then raise exception 'event cycle unavailable'; end if;
  return v;
end $$;

create function public.lean_sales_event_cycle_claim(p_grant text,p_google_cycle uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare v jsonb; g lean_private.sales_event_cycle_grants; at timestamptz; until_time timestamptz; deadline timestamptz;
  id text:='event_auto_'||p_google_cycle; base text:='event_auto_base_'||p_google_cycle;
begin
  v:=public.lean_google_auto_cycle_binding(p_google_cycle);
  select * into strict g from lean_private.sales_event_cycle_grants where grant_id=p_grant for update;
  at:=date_trunc('milliseconds',clock_timestamp());
  if not g.enabled or g.revoked or at<g.not_before or at>=g.expires_at or g.attempts>=g.max_cycles or
    g.max_cycles>lean_private.sales_event_cycle_slot_count(g.grant_id) or
    v->>'grantId' is distinct from g.google_grant_id or (v->>'grantRevision')::bigint<>g.google_grant_revision or
    v->>'projectRef' is distinct from g.project_ref or v->>'shop' is distinct from g.shop or
    (v->>'date')::date not between g.from_date and g.through_date or
    (v->>'date')::date>=(at at time zone 'America/New_York')::date or
    coalesce((v->>'slotOrdinal')::integer not between 1 and 1000,true) or
    coalesce(not isfinite((v->>'slotNotBeforeUTC')::timestamptz) or (v->>'slotNotBeforeUTC')::timestamptz>at,true) or
    jsonb_typeof(v->'metaPacket') is distinct from 'object' or jsonb_typeof(v->'metaReceipts') is distinct from 'object' or
    exists(select 1 from lean_private.sales_event_cycles where cycle_id=p_google_cycle)
    then raise exception 'event cycle claim refused'; end if;
  if exists(select 1 from lean_private.sales_event_cycles x left join lean_private.full_builds f on f.run_id=x.run_id
    where x.grant_id=g.grant_id and (x.state<>'enabled' or not x.enabled or f.completed_at is null))
    then return jsonb_build_object('state','held'); end if;
  if exists(select 1 from lean_private.sales_event_cycles where grant_id=g.grant_id and
    (slot_ordinal>=(v->>'slotOrdinal')::integer or slot_not_before>=(v->>'slotNotBeforeUTC')::timestamptz or report_date>(v->>'date')::date))
    then raise exception 'event cycle slot must advance without backward date'; end if;
  until_time:=least(g.expires_at,(v->>'validUntil')::timestamptz,at+make_interval(secs=>g.max_age_seconds));
  deadline:=least(until_time,at+interval '5 minutes');
  insert into lean_private.sales_event_cycles(cycle_id,grant_id,grant_revision,report_date,started_at,deadline,valid_until,
    run_id,base_run,state,google_capture_sha256,meta_packet_sha256,slot_ordinal,slot_not_before)
    values(p_google_cycle,g.grant_id,g.revision,(v->>'date')::date,at,deadline,until_time,id,base,'capture',
      v->>'captureSha256',v->>'metaPacketSha256',(v->>'slotOrdinal')::integer,(v->>'slotNotBeforeUTC')::timestamptz);
  update lean_private.sales_event_cycle_grants set attempts=attempts+1 where grant_id=g.grant_id;
  return jsonb_build_object('state','capture','cycleId',p_google_cycle,'grantId',g.grant_id,'grantRevision',g.revision::text,
    'projectRef',g.project_ref,'shop',g.shop,'reportDate',v->>'date','runId',id,'baseRunId',base,
    'slotOrdinal',(v->>'slotOrdinal')::integer,'slotNotBeforeUTC',v->>'slotNotBeforeUTC',
    'startedAt',to_char(at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'deadline',to_char(deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'validUntil',to_char(until_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'authorizationRef',g.authorization_ref,'approvalRef',g.approval_ref,'actorRef',g.actor_ref,
    'maxAgeSeconds',g.max_age_seconds,'policy',g.policy,'businessPolicy',g.business_policy,
    'standingScope',g.standing_scope,'customerCyclePins',g.customer_cycle_pins,'sourceLimits',g.source_limits,'google',v);
end $$;

create function public.lean_sales_event_cycle_stage(p_cycle uuid,p_scope jsonb,p_spend jsonb) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare v jsonb; c lean_private.sales_event_cycles; g lean_private.sales_event_cycle_grants; b jsonb; result text;
  fresh jsonb; inventory jsonb; customer jsonb;
begin
  v:=lean_private.sales_event_cycle_current(p_cycle,false);
  select * into strict c from lean_private.sales_event_cycles where cycle_id=p_cycle;
  select * into strict g from lean_private.sales_event_cycle_grants where grant_id=c.grant_id;
  if c.state<>'capture' or clock_timestamp()>=c.deadline or
    p_scope->>'runId' is distinct from c.run_id or p_scope->>'baseRunId' is distinct from c.base_run or
    p_scope->>'projectRef' is distinct from g.project_ref or p_scope->>'shop' is distinct from g.shop or
    p_scope->>'fromDate' is distinct from c.report_date::text or p_scope->>'throughDate' is distinct from c.report_date::text or
    p_scope#>'{source,businessPolicy}' is distinct from g.business_policy or
    (p_scope->'fullPolicy')-array['asOf','salesEventWindow','freshGoogleSpend'] is distinct from g.policy or
    p_scope#>'{authority}' is distinct from jsonb_build_object('approvalRef',g.approval_ref,'actorRef',g.actor_ref,
      'readyAt',p_scope#>>'{fullPolicy,asOf}','expiresAt',to_char(c.valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'maxAgeSeconds',g.max_age_seconds) or
    (p_scope->>'oldestCaptureAt')::timestamptz<c.started_at or
    (p_scope->>'latestCaptureAt')::timestamptz>c.deadline or
    (p_scope#>>'{fullPolicy,asOf}')::timestamptz<(v#>>'{packet,asOf}')::timestamptz or
    (p_scope#>>'{fullPolicy,asOf}')::timestamptz>clock_timestamp() or
    (p_scope#>>'{fullPolicy,asOf}')::timestamptz>=c.deadline then raise exception 'event cycle stage scope'; end if;
  b:=p_spend->'binding';
  if p_spend->>'digest' is distinct from lean_private.partition_digest(p_spend-'digest') or
    b is distinct from jsonb_build_object('version',1,'cycleId',p_cycle,'grantId',g.grant_id,'grantRevision',g.revision::text,
      'projectRef',g.project_ref,'shop',g.shop,'runId',c.run_id,'date',c.report_date,
      'standingScopeDigest',lean_private.partition_digest(g.standing_scope),
      'googleCaptureSha256',c.google_capture_sha256,'metaPacketSha256',c.meta_packet_sha256) or
    p_spend->'scopeDefinition' is distinct from g.standing_scope or
    (p_spend->>'cycleStartedAt')::timestamptz is distinct from (v->>'startedAt')::timestamptz or
    (p_spend->>'validUntil')::timestamptz is distinct from c.valid_until or
    p_spend->'google' is distinct from jsonb_build_object('manifest',v#>'{packet,manifest}','base',v#>'{packet,base}',
      'control',v#>'{packet,costControl}','accountMetadata',v#>'{packet,receipt,accountMetadata}') or
    p_spend->'meta' is distinct from jsonb_build_object('packet',v->'metaPacket','receipts',v->'metaReceipts',
      'freshnessCutoffAt',v#>>'{metaBinding,freshnessCutoffAt}')
    then raise exception 'event cycle server source mismatch'; end if;
  customer:=p_scope#>'{source,customers,binding,cycle}';
  if p_scope#>'{source,customers}' is not null then
    if customer is null or customer->>'cycleId' is distinct from p_cycle::text or
      customer->>'grantId' is distinct from g.grant_id or customer->>'grantRevision' is distinct from g.revision::text or
      customer->>'projectRef' is distinct from g.project_ref or customer->>'shop' is distinct from g.shop or
      customer->>'reportDate' is distinct from c.report_date::text or
      customer->>'authorizationRef' is distinct from g.authorization_ref or
      (customer->>'startedAt')::timestamptz is distinct from c.started_at or
      (customer->>'deadline')::timestamptz is distinct from c.deadline or
      customer-array['cycleId','grantId','grantRevision','projectRef','shop','reportDate','startedAt','deadline','authorizationRef']
        is distinct from g.customer_cycle_pins then raise exception 'event cycle customer pins'; end if;
  end if;
  fresh:=p_scope#>'{fullPolicy,freshGoogleSpend}'; inventory:=fresh->'marketingInventory';
  if fresh->'manifest' is distinct from v#>'{packet,manifest}' or
    fresh->'controls' is distinct from jsonb_build_array(v#>'{packet,costControl}') or
    inventory->'complete' is distinct from 'false'::jsonb or inventory->'independentlyExtracted' is distinct from 'false'::jsonb or
    inventory->>'capturedAt' is distinct from g.standing_scope->>'declaredAt' or
    inventory->>'approvalRef' is distinct from g.standing_scope->>'approvalRef'
    then raise exception 'event cycle legacy inventory must not be restamped'; end if;
  result:=public.lean_sales_event_window_register(p_scope);
  perform public.lean_marketing_spend_bind(c.run_id,g.project_ref,array[v#>>'{metaPacket,generationId}'],
    inventory,g.approval_ref,g.actor_ref);
  update lean_private.sales_event_cycles set state='staged',source_digest=p_scope->>'sourceDigest',
    scope_hash=lean_private.partition_digest(p_scope),spend_packet=p_spend where cycle_id=p_cycle;
  perform lean_private.sales_event_cycle_current(p_cycle,false);
  if clock_timestamp()>=c.deadline then raise exception 'event cycle stage capture expired'; end if;
  return result;
end $$;

create function public.lean_sales_event_cycle_enable(p_cycle uuid,p_scope_hash text,p_spend_digest text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare v jsonb; c lean_private.sales_event_cycles; g lean_private.sales_event_cycle_grants;
begin
  v:=lean_private.sales_event_cycle_current(p_cycle,false);
  select * into strict c from lean_private.sales_event_cycles where cycle_id=p_cycle;
  select * into strict g from lean_private.sales_event_cycle_grants where grant_id=c.grant_id;
  if c.state<>'staged' or c.scope_hash is distinct from p_scope_hash or c.spend_packet->>'digest' is distinct from p_spend_digest
    then raise exception 'event cycle enable mismatch'; end if;
  perform 1 from lean_private.sales_event_window_inputs where run_id=c.run_id for update;
  perform 1 from lean_private.report_builds where run_id=c.base_run for update;
  perform 1 from lean_private.full_builds where run_id=c.run_id for update;
  if not exists(select 1 from lean_private.sales_event_window_inputs where run_id=c.run_id and payload_hash=c.scope_hash and not enabled) or
    not exists(select 1 from lean_private.full_builds where run_id=c.run_id and not enabled and attempts=0 and completed_at is null) or
    not exists(select 1 from lean_private.marketing_spend_bindings where run_id=c.run_id and not enabled) then raise exception 'event cycle changed before enable'; end if;
  update lean_private.marketing_spend_days set enabled=true where generation_id=v#>>'{metaPacket,generationId}' and packet_hash=c.meta_packet_sha256;
  if not found then raise exception 'event cycle Meta generation changed'; end if;
  update lean_private.marketing_spend_bindings set enabled=true where run_id=c.run_id;
  update lean_private.sales_event_window_inputs set enabled=true where run_id=c.run_id;
  update lean_private.report_builds set enabled=true where run_id=c.base_run;
  update lean_private.full_builds set enabled=true where run_id=c.run_id;
  update lean_private.sales_event_cycles set state='enabled',enabled=true where cycle_id=p_cycle;
  perform lean_private.sales_event_cycle_current(p_cycle,true);
  return true;
end $$;

-- Both old authorities and this new finite cycle stay locked through writes.
alter function public.lean_report_inputs(text,text) rename to lean_report_inputs_before_event_cycle;
create function public.lean_report_inputs(p_run text,p_project_ref text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare c lean_private.sales_event_cycles;
begin
  select * into c from lean_private.sales_event_cycles where base_run=p_run;
  if found then
    perform lean_private.sales_event_cycle_current(c.cycle_id,true);
    select * into strict c from lean_private.sales_event_cycles where base_run=p_run;
  end if;
  return public.lean_report_inputs_before_event_cycle(p_run,p_project_ref);
end $$;
alter function public.lean_full_inputs(text,text) rename to lean_full_inputs_before_event_cycle;
create function public.lean_full_inputs(p_run text,p_project_ref text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare c lean_private.sales_event_cycles; input jsonb;
begin
  select * into c from lean_private.sales_event_cycles where run_id=p_run;
  if found then
    perform lean_private.sales_event_cycle_current(c.cycle_id,true);
    select * into strict c from lean_private.sales_event_cycles where run_id=p_run;
  end if;
  input:=public.lean_full_inputs_before_event_cycle(p_run,p_project_ref);
  if c.cycle_id is not null and input->>'state'='ready' then
    input:=(input-'inputHash')||jsonb_build_object('nativeSpendWindow',c.spend_packet,
      'nativeSpendWindowBinding',(c.spend_packet->'binding')||jsonb_build_object('digest',c.spend_packet->>'digest'));
    input:=input||jsonb_build_object('inputHash',md5(input::text));
  end if;
  return input;
end $$;
alter function public.lean_report_finish(text,text,text,jsonb,jsonb) rename to lean_report_finish_before_event_cycle;
create function public.lean_report_finish(p_run text,p_project_ref text,p_input_hash text,p_facts jsonb,p_reports jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare c lean_private.sales_event_cycles; done boolean;
begin
  select * into c from lean_private.sales_event_cycles where base_run=p_run;
  if found then perform lean_private.sales_event_cycle_current(c.cycle_id,true); end if;
  done:=public.lean_report_finish_before_event_cycle(p_run,p_project_ref,p_input_hash,p_facts,p_reports);
  if done and c.cycle_id is not null then perform lean_private.sales_event_cycle_current(c.cycle_id,true); end if;
  return done;
end $$;
alter function public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb) rename to lean_full_finish_before_event_cycle;
create function public.lean_full_finish(p_run text,p_project_ref text,p_token uuid,p_input_hash text,p_facts jsonb,p_reports jsonb,p_manifest jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare c lean_private.sales_event_cycles; done boolean;
begin
  select * into c from lean_private.sales_event_cycles where run_id=p_run;
  if found then perform lean_private.sales_event_cycle_current(c.cycle_id,true); end if;
  done:=public.lean_full_finish_before_event_cycle(p_run,p_project_ref,p_token,p_input_hash,p_facts,p_reports,p_manifest);
  if done and c.cycle_id is not null then perform lean_private.sales_event_cycle_current(c.cycle_id,true); end if;
  return done;
end $$;

-- Safe operator status never returns raw source, credentials or enable authority.
create function public.lean_sales_event_cycle_state(p_grant text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare g lean_private.sales_event_cycle_grants; rows jsonb;
begin
  select * into strict g from lean_private.sales_event_cycle_grants where grant_id=p_grant;
  select coalesce(jsonb_agg(jsonb_build_object('cycleId',c.cycle_id,'date',c.report_date,
    'runId',c.run_id,'slotOrdinal',c.slot_ordinal,'slotNotBeforeUTC',c.slot_not_before,
    'state',case when f.completed_at is not null then 'completed'
      when not g.enabled or g.revoked or clock_timestamp()>=least(g.expires_at,c.valid_until) then 'held_unavailable'
      when c.state='capture' and clock_timestamp()>=c.deadline then 'held_capture_expired'
      else c.state end,'accepted',false,'captureDeadline',c.deadline,'validUntil',c.valid_until)
    order by c.report_date),'[]'::jsonb) into rows
  from lean_private.sales_event_cycles c left join lean_private.full_builds f on f.run_id=c.run_id where c.grant_id=p_grant;
  return jsonb_build_object('grantId',p_grant,'attempts',g.attempts,'maxCycles',g.max_cycles,'cycles',rows,
    'automaticRetryAllowed',false,'wholeStoreLifetimeClaimed',false);
end $$;

-- Existing front doors retain exactly their prior ACL. The four restricted
-- operations below cannot create, extend, change or enable their grant. A grant
-- is owner-created, immutable and disabled by default. No generic registrar ACL.
do $acl$
declare x record; entry record; g record;
begin
  for x in select p.oid::regprocedure signature,a.grantee from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where
    ((n.nspname='public' and (p.proname like 'lean_sales_event_cycle_%' or p.proname like '%before_event_cycle' or
      p.proname in ('lean_report_inputs','lean_full_inputs','lean_report_finish','lean_full_finish'))) or
     (n.nspname='lean_private' and p.proname in ('sales_event_cycle_current','sales_event_cycle_immutable','sales_event_cycle_slot_count'))) and a.grantee<>p.proowner loop
    execute format('revoke all on function %s from %s',x.signature,case when x.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(x.grantee)) end);
  end loop;
  for entry in select * from jsonb_each(current_setting('lean.sales_event_cycle_prior_acl')::jsonb) loop
    for g in select * from jsonb_to_recordset(entry.value) as a(grantee oid,grantor oid,grantable boolean) loop
      if g.grantor<>current_user::regrole::oid then raise exception 'event cycle ACL grantor'; end if;
      execute format('grant execute on function %s to %s%s',entry.key,case when g.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(g.grantee)) end,
        case when g.grantable then ' with grant option' else '' end);
    end loop;
    if entry.value is distinct from (select jsonb_agg(jsonb_build_object('grantee',a.grantee,
      'grantor',a.grantor,'grantable',a.is_grantable) order by a.grantee,a.grantor,a.is_grantable)
      from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=to_regprocedure(entry.key) and a.privilege_type='EXECUTE')
      then raise exception 'event cycle ACL restoration mismatch'; end if;
  end loop;
  for x in select c.oid::regclass name,a.grantee from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    where c.oid=any(array['lean_private.sales_event_cycle_grants'::regclass::oid,
      'lean_private.sales_event_cycles'::regclass::oid]) and a.grantee<>c.relowner loop
    execute format('revoke all on %s from %s',x.name,case when x.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(x.grantee)) end);
  end loop;
end $acl$;
grant execute on function public.lean_sales_event_cycle_claim(text,uuid),
  public.lean_sales_event_cycle_stage(uuid,jsonb,jsonb),public.lean_sales_event_cycle_enable(uuid,text,text),
  public.lean_sales_event_cycle_state(text) to service_role;
commit;
