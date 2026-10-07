-- PRIVATE REVIEW. Requires exact reviewed B6 V2 and P3. No grant or activation.
begin;
-- Metadata-only bootstrap needs no destination, recurring policy or LEAN copy.
create table lean_private.google_auto_setups (
  setup_id text primary key check(setup_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  revision bigint not null check(revision>0),
  account_id text not null check(account_id ~ '^[0-9]{10}$'),
  login_customer_id text not null check(login_customer_id ~ '^[0-9]{10}$'),
  not_before timestamptz not null, expires_at timestamptz not null,
  enabled boolean not null default false, revoked boolean not null default false,
  producer_sha256 text not null check(producer_sha256 ~ '^[a-f0-9]{64}$'),
  credential_binding_ref text not null, approval_ref text not null, actor_ref text not null,
  started_at timestamptz, receipt jsonb,
  check(isfinite(not_before) and isfinite(expires_at) and expires_at>not_before and
    expires_at-not_before<=interval '1 hour'),
  check(length(trim(credential_binding_ref)) between 1 and 256 and
    length(trim(approval_ref)) between 1 and 256 and length(trim(actor_ref)) between 1 and 256)
);
create table lean_private.google_auto_grants (
  grant_id text primary key check(grant_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  revision bigint not null check(revision>0),
  policy_id text not null unique references lean_private.google_standing_policy,
  policy_revision bigint not null,
  enabled boolean not null default false, revoked boolean not null default false,
  not_before timestamptz not null, expires_at timestamptz not null,
  capture_slots jsonb not null check(jsonb_typeof(capture_slots)='array' and jsonb_array_length(capture_slots) between 1 and 1000),
  slot_log jsonb not null default '[]' check(jsonb_typeof(slot_log)='array' and jsonb_array_length(slot_log)<=1000),
  cadence_seconds integer not null check(cadence_seconds between 1 and 86400),
  capture_seconds integer not null check(capture_seconds between 1 and 80),
  source_deadline_seconds integer not null check(source_deadline_seconds between 1 and 60),
  max_pages integer not null check(max_pages between 1 and 5),
  max_requests integer not null check(max_requests between 7 and 20),
  max_bytes integer not null check(max_bytes between 1 and 16777216),
  max_observations integer not null check(max_observations between 1 and 100),
  observation_seconds integer not null check(observation_seconds between 1 and 80),
  producer_sha256 text not null check(producer_sha256 ~ '^[a-f0-9]{64}$'),
  observer_sha256 text not null check(observer_sha256 ~ '^[a-f0-9]{64}$'),
  credential_binding_ref text not null, approval_ref text not null, actor_ref text not null,
  setup_id text not null references lean_private.google_auto_setups,
  registration_template jsonb not null check(jsonb_typeof(registration_template)='object'),
  history_bindings jsonb not null check(jsonb_typeof(history_bindings)='object'),
  destination jsonb not null check(jsonb_typeof(destination)='object'),
  meta_policy jsonb check(meta_policy is null or jsonb_typeof(meta_policy)='object'),
  setup_receipt jsonb,
  cycles integer not null default 0, last_claimed_at timestamptz,
  check(producer_sha256<>observer_sha256),
  check(isfinite(not_before) and isfinite(expires_at) and expires_at>not_before
    and expires_at-not_before<=interval '14 days'),
  check(max_requests>=5+2*max_pages),
  check(cycles between 0 and jsonb_array_length(capture_slots)),
  check(length(trim(credential_binding_ref)) between 1 and 256 and
    length(trim(approval_ref)) between 1 and 256 and length(trim(actor_ref)) between 1 and 256)
);
create table lean_private.google_auto_cycles (
  cycle_id uuid primary key, grant_id text not null references lean_private.google_auto_grants,
  grant_revision bigint not null, ordinal integer not null, report_date date not null,
  started_at timestamptz not null, deadline timestamptz not null,
  state text not null check(state in ('capture','registered','observing','accepted','held')),
  run_id text not null unique, base_run text not null unique,
  capture_sha256 text, capture_receipt jsonb, capture_packet jsonb, committed_at timestamptz,
  observations integer not null default 0, observation_token uuid,
  observation_deadline timestamptz, selection_revision bigint, canonical_sha256 text,
  observation_receipt jsonb, accepted_at timestamptz,
  observation_log jsonb not null default '[]' check(jsonb_typeof(observation_log)='array'),
  meta_token uuid, meta_binding jsonb, meta_packet jsonb, meta_packet_sha256 text, meta_receipts jsonb,
  unique(grant_id,ordinal)
);
alter table lean_private.google_auto_grants enable row level security;
alter table lean_private.google_auto_cycles enable row level security;
alter table lean_private.google_auto_setups enable row level security;
revoke all on lean_private.google_auto_grants,lean_private.google_auto_cycles,lean_private.google_auto_setups
  from public,anon,authenticated,service_role,lean_posthog_reader;

create function lean_private.google_auto_guard() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' then raise exception 'automatic audit immutable'; end if;
  if tg_table_name='google_auto_setups' then
    if (to_jsonb(old)-array['enabled','started_at','receipt']) is distinct from
      (to_jsonb(new)-array['enabled','started_at','receipt']) or
      old.revoked and new.enabled or
      old.started_at is not null and old.started_at is distinct from new.started_at or
      old.receipt is not null and old.receipt is distinct from new.receipt
      then raise exception 'setup scope or receipt immutable'; end if;
    new.revoked:=old.revoked or old.enabled and not new.enabled;
    return new;
  end if;
  if tg_table_name='google_auto_grants' then
    if (to_jsonb(old)-array['enabled','setup_receipt','cycles','last_claimed_at','slot_log']) is distinct from
      (to_jsonb(new)-array['enabled','setup_receipt','cycles','last_claimed_at','slot_log']) or
      old.revoked and new.enabled or old.setup_receipt is not null and old.setup_receipt is distinct from new.setup_receipt
      then raise exception 'automatic scope immutable'; end if;
    if jsonb_array_length(new.slot_log)<jsonb_array_length(old.slot_log) or
      exists(select 1 from jsonb_array_elements(old.slot_log) with ordinality x(value,n)
        where new.slot_log->(x.n::integer-1) is distinct from x.value)
      then raise exception 'automatic skipped slots immutable'; end if;
    new.revoked:=old.revoked or old.enabled and not new.enabled;
    if old.enabled and not new.enabled then
      update lean_private.google_standing_policy set enabled=false where policy_id=old.policy_id;
    end if;
  elsif old.state in ('accepted','held') or
    (to_jsonb(old)-array['state','capture_sha256','capture_receipt','capture_packet','committed_at','observations',
      'observation_token','observation_deadline','selection_revision','canonical_sha256','observation_receipt','accepted_at','observation_log',
      'meta_token','meta_binding','meta_packet','meta_packet_sha256','meta_receipts'])
    is distinct from
    (to_jsonb(new)-array['state','capture_sha256','capture_receipt','capture_packet','committed_at','observations',
      'observation_token','observation_deadline','selection_revision','canonical_sha256','observation_receipt','accepted_at','observation_log',
      'meta_token','meta_binding','meta_packet','meta_packet_sha256','meta_receipts'])
    then raise exception 'automatic cycle immutable'; end if;
  if tg_table_name='google_auto_cycles' then
    if old.capture_packet is not null and (new.capture_packet is distinct from old.capture_packet or
      new.capture_sha256 is distinct from old.capture_sha256 or new.capture_receipt is distinct from old.capture_receipt) or
    old.meta_binding is not null and (new.meta_binding is distinct from old.meta_binding or new.meta_token is distinct from old.meta_token) or
    old.meta_packet is not null and (new.meta_packet is distinct from old.meta_packet or
      new.meta_receipts is distinct from old.meta_receipts or new.meta_packet_sha256 is distinct from old.meta_packet_sha256) or
    new.observations<old.observations or new.observations>old.observations+1 or
    jsonb_array_length(new.observation_log)<jsonb_array_length(old.observation_log) or
    exists(select 1 from jsonb_array_elements(old.observation_log) with ordinality x(value,n)
      where new.observation_log->(x.n::integer-1) is distinct from x.value)
      then raise exception 'automatic evidence immutable'; end if;
  end if;
  return new;
end $$;
create trigger google_auto_grant_guard before update or delete on lean_private.google_auto_grants
  for each row execute function lean_private.google_auto_guard();
create trigger google_auto_cycle_guard before update or delete on lean_private.google_auto_cycles
  for each row execute function lean_private.google_auto_guard();
create trigger google_auto_setup_guard before update or delete on lean_private.google_auto_setups
  for each row execute function lean_private.google_auto_guard();

-- Capability is supplied only through the private authenticated runtime. The
-- service role does not receive owner registration or raw-table grants.
create function lean_private.google_auto_authorize(p_grant text,p_revision bigint,p_capability text,p_observer boolean)
returns lean_private.google_auto_grants language plpgsql set search_path=pg_catalog as $$
declare g lean_private.google_auto_grants;
begin
  if current_setting('transaction_isolation')<>'read committed' or
    p_capability is null or length(p_capability) not between 32 and 512 then raise exception 'automatic authority'; end if;
  select * into strict g from lean_private.google_auto_grants where grant_id=p_grant for update;
  if g.revision is distinct from p_revision or g.revoked or clock_timestamp()<g.not_before or clock_timestamp()>=g.expires_at or
    encode(sha256(convert_to(p_capability,'UTF8')),'hex') is distinct from
      (case when p_observer then g.observer_sha256 else g.producer_sha256 end)
    then raise exception 'automatic authority'; end if;
  return g;
end $$;

-- One-use setup authorizes metadata only, even while production operation is off.
create function public.lean_google_auto_setup(p_grant text,p_revision bigint,p_capability text,p_receipt jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s lean_private.google_auto_setups;
begin
  select * into strict s from lean_private.google_auto_setups where setup_id=p_grant for update;
  if current_setting('transaction_isolation')<>'read committed' or not s.enabled or s.revoked or
    s.revision is distinct from p_revision or clock_timestamp()<s.not_before or clock_timestamp()>=s.expires_at or
    p_capability is null or length(p_capability) not between 32 and 512 or
    encode(sha256(convert_to(p_capability,'UTF8')),'hex') is distinct from s.producer_sha256
    then raise exception 'setup authority'; end if;
  if p_receipt is null then
    if s.started_at is not null then raise exception 'setup consumed'; end if;
    update lean_private.google_auto_setups set started_at=date_trunc('milliseconds',clock_timestamp()) where setup_id=p_grant;
    return jsonb_build_object('accountId',s.account_id,'loginCustomerId',s.login_customer_id,
      'credentialBindingRef',s.credential_binding_ref,'deadline',to_char(least(s.expires_at,clock_timestamp()+interval '40 seconds')
        at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  end if;
  if s.started_at is null or s.receipt is not null or clock_timestamp()>s.started_at+interval '40 seconds' or
    jsonb_typeof(p_receipt) is distinct from 'object' or
    p_receipt-array['accountId','loginCustomerId','currency','timezone','credentialBindingRef','transport','capturedAt',
      'credentialSha256','identitySha256','authMode','credentialSource']<>'{}' or
    coalesce(p_receipt->>'credentialSha256','') !~ '^[a-f0-9]{64}$' or
    coalesce(p_receipt->>'identitySha256','') !~ '^[a-f0-9]{64}$' or
    p_receipt->>'authMode' is distinct from 'service_account' or
    p_receipt->>'credentialSource' is distinct from
      'GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64/GOOGLE_ADS_IMPERSONATE_EMAIL/GOOGLE_ADS_DEVELOPER_TOKEN' or
    p_receipt->>'accountId' is distinct from s.account_id or p_receipt->>'loginCustomerId' is distinct from s.login_customer_id or
    p_receipt->>'currency' is distinct from 'USD' or p_receipt->>'timezone' is distinct from 'America/New_York' or
    p_receipt->>'credentialBindingRef' is distinct from s.credential_binding_ref or
    p_receipt->>'transport' is distinct from 'native_google_ads' or
    (p_receipt->>'capturedAt')::timestamptz is null or
    (p_receipt->>'capturedAt')::timestamptz not between s.started_at and clock_timestamp()
    then raise exception 'setup proof unavailable'; end if;
  update lean_private.google_auto_setups set receipt=p_receipt where setup_id=p_grant;
  return jsonb_build_object('state','metadata_verified','aggregateReads',0);
end $$;

-- Same enclosing full-LA dates and DST refusal as the reviewed Meta hourly
-- adapter. A closed NY day is not sufficient until this provider window closes.
create function lean_private.google_auto_provider_close(p_day date) returns timestamptz
language plpgsql set search_path=pg_catalog as $$
declare from_at timestamptz; until_at timestamptz; query_since date; query_until date; closed_at timestamptz;
begin
  if p_day is null or not isfinite(p_day) then raise exception 'automatic slot day'; end if;
  from_at:=p_day::timestamp at time zone 'America/New_York';
  until_at:=(p_day+1)::timestamp at time zone 'America/New_York';
  query_since:=(from_at at time zone 'America/Los_Angeles')::date;
  query_until:=((until_at-interval '1 hour') at time zone 'America/Los_Angeles')::date;
  closed_at:=(query_until+1)::timestamp at time zone 'America/Los_Angeles';
  if until_at-from_at<>interval '24 hours' or
    closed_at-(query_since::timestamp at time zone 'America/Los_Angeles')<>(query_until-query_since+1)*interval '24 hours'
    then raise exception 'automatic slot DST unsupported'; end if;
  return closed_at;
end $$;

-- Only server clock selects the latest approved eligible wall-clock slot.
-- Missed earlier slots are append-only skipped/unprocessed audit, not captures.
create function lean_private.google_auto_slot(p_grant text) returns integer
language plpgsql set search_path=pg_catalog as $$
declare g lean_private.google_auto_grants; p lean_private.google_standing_policy;
  x record; day date; at_time timestamptz; previous_time timestamptz; previous_day date;
  selected integer:=0; now_at timestamptz:=clock_timestamp(); additions jsonb;
begin
  select * into strict g from lean_private.google_auto_grants where grant_id=p_grant for update;
  select * into strict p from lean_private.google_standing_policy where policy_id=g.policy_id for share;
  for x in select value,n::integer ordinal from jsonb_array_elements(g.capture_slots) with ordinality a(value,n) loop
    if jsonb_typeof(x.value) is distinct from 'object' or x.value-array['date','notBeforeUTC']<>'{}' or
      not(x.value ?& array['date','notBeforeUTC']) or
      coalesce(x.value->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or
      coalesce(x.value->>'notBeforeUTC','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
      then raise exception 'automatic slot fields'; end if;
    day:=(x.value->>'date')::date; at_time:=(x.value->>'notBeforeUTC')::timestamptz;
    if day::text<>x.value->>'date' or day not between p.from_date and p.through_date or
      to_char(at_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')<>left(x.value->>'notBeforeUTC',19) or
      at_time<g.not_before or at_time>=g.expires_at or
      at_time<lean_private.google_auto_provider_close(day) or
      previous_time is not null and (at_time<=previous_time or day<previous_day)
      then raise exception 'automatic slot scope or provider close'; end if;
    if at_time<=now_at then selected:=x.ordinal; end if;
    previous_time:=at_time; previous_day:=day;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('ordinal',n,'date',value->>'date',
    'notBeforeUTC',value->>'notBeforeUTC','state','skipped_unprocessed','recordedAt',now_at) order by n),'[]')
    into additions from jsonb_array_elements(g.capture_slots) with ordinality a(value,n)
    where n<selected and not exists(select 1 from lean_private.google_auto_cycles c where c.grant_id=p_grant and c.ordinal=n)
    and not exists(select 1 from jsonb_array_elements(g.slot_log) s where (s->>'ordinal')::integer=n);
  if additions<>'[]' then
    update lean_private.google_auto_grants set slot_log=slot_log||additions where grant_id=p_grant;
  end if;
  if selected=0 or exists(select 1 from lean_private.google_auto_cycles where grant_id=p_grant and ordinal=selected)
    then return 0; end if;
  return selected;
end $$;

create function public.lean_google_auto_claim(p_grant text,p_revision bigint,p_capability text,p_cycle uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare g lean_private.google_auto_grants; p lean_private.google_standing_policy; d date; started timestamptz; slot integer;
begin
  g:=lean_private.google_auto_authorize(p_grant,p_revision,p_capability,false);
  select * into strict p from lean_private.google_standing_policy where policy_id=g.policy_id for update;
  if not g.enabled or not p.enabled or p.revision<>g.policy_revision or g.setup_receipt is null or
    g.not_before<p.not_before or g.expires_at>p.expires_at or jsonb_array_length(g.capture_slots)>p.max_generations
    then return jsonb_build_object('state','disabled'); end if;
  if g.destination->>'projectId' is distinct from p.destination_project or
    g.destination->>'sourceId' is distinct from p.destination_source::text or
    g.destination->>'tableId' is distinct from p.destination_table::text or
    coalesce(g.destination->>'schemaId','') !~ '^[a-f0-9-]{36}$' or
    coalesce(g.destination->>'tableName','') !~ '^[A-Za-z_][A-Za-z0-9_]{0,199}$' or
    coalesce(g.destination->>'manifestSha256','') !~ '^[a-f0-9]{64}$' or
    coalesce(g.destination->>'contractSha256','') !~ '^[a-f0-9]{64}$' or
    coalesce((g.destination->>'maxAgeSeconds')::integer,0) not between 1 and p.max_import_age_seconds
    then raise exception 'automatic destination binding'; end if;
  if p_cycle is null or exists(select 1 from lean_private.google_auto_cycles where cycle_id=p_cycle)
    then raise exception 'duplicate automatic cycle'; end if;
  slot:=lean_private.google_auto_slot(p_grant);
  if exists(select 1 from lean_private.google_auto_cycles where grant_id=p_grant and state<>'accepted')
    then return jsonb_build_object('state','held'); end if;
  if g.cycles>=jsonb_array_length(g.capture_slots) then return jsonb_build_object('state','exhausted'); end if;
  if slot=0 then return jsonb_build_object('state',case
    when clock_timestamp()>=(g.capture_slots->-1->>'notBeforeUTC')::timestamptz then 'exhausted' else 'not_due' end); end if;
  if g.last_claimed_at+make_interval(secs=>g.cadence_seconds)>clock_timestamp()
    then return jsonb_build_object('state','not_due'); end if;
  d:=(g.capture_slots->(slot-1)->>'date')::date;
  if d is null or not isfinite(d) or d not between p.from_date and p.through_date or
    d>=(clock_timestamp() at time zone 'America/New_York')::date or
    exists(select 1 from lean_private.google_auto_cycles where grant_id=p_grant and report_date>d)
    then raise exception 'automatic day scope'; end if;
  if g.registration_template#>>'{fullPolicy,behaviorMode}' is distinct from 'excluded' or
    g.registration_template->'fullPolicy' ?| array['asOf','customerGeneration','freshGoogleSpend','googleDelivery'] or
    g.registration_template-array['historyRuns','reportPolicy','fullPolicy','evidence','behavior']<>'{}' or
    not(g.registration_template ?& array['historyRuns','reportPolicy','fullPolicy','evidence','behavior']) or
    exists(select 1 from jsonb_array_elements(g.registration_template#>'{evidence,dateCoverage}') x,
      jsonb_each(x->'gates') v where v.value is distinct from 'false'::jsonb)
    then raise exception 'non-Google template authority'; end if;
  started:=date_trunc('milliseconds',clock_timestamp());
  insert into lean_private.google_auto_cycles(cycle_id,grant_id,grant_revision,ordinal,report_date,
    started_at,deadline,state,run_id,base_run)
    values(p_cycle,p_grant,p_revision,slot,d,started,least(g.expires_at,started+make_interval(secs=>g.capture_seconds)),
      'capture','auto_'||p_cycle,'auto_base_'||p_cycle);
  update lean_private.google_auto_grants set cycles=cycles+1,last_claimed_at=started where grant_id=p_grant;
  return jsonb_build_object('state','capture','cycleId',p_cycle,'grantId',g.grant_id,'revision',g.revision::text,
    'slotOrdinal',slot,'slotNotBeforeUTC',g.capture_slots->(slot-1)->>'notBeforeUTC',
    'projectRef',p.project_ref,'shop',p.shop,'accountId',p.account_id,'loginCustomerId',p.login_customer_id,'date',d,
    'startedAt',to_char(started at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deadline',to_char(least(g.expires_at,started+make_interval(secs=>g.capture_seconds)) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt',to_char(g.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'maxPages',g.max_pages,'maxRequests',g.max_requests,'maxBytes',g.max_bytes,'sourceDeadlineSeconds',g.source_deadline_seconds,
    'approvalRef',g.approval_ref,'actorRef',g.actor_ref,'credentialBindingRef',g.credential_binding_ref,
    'credentialSha256',g.setup_receipt->>'credentialSha256');
end $$;

create function public.lean_google_auto_commit(p_grant text,p_revision bigint,p_capability text,p_cycle uuid,p_capture jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare g lean_private.google_auto_grants; p lean_private.google_standing_policy; c lean_private.google_auto_cycles;
  h lean_private.history_jobs; id text; m jsonb; b jsonb; r jsonb; t jsonb; registration jsonb; lease uuid;
begin
  g:=lean_private.google_auto_authorize(p_grant,p_revision,p_capability,false);
  select * into strict p from lean_private.google_standing_policy where policy_id=g.policy_id for update;
  select * into strict c from lean_private.google_auto_cycles where cycle_id=p_cycle and grant_id=p_grant for update;
  if not g.enabled or not p.enabled or p.revision<>g.policy_revision or c.grant_revision<>p_revision or c.state<>'capture'
    or clock_timestamp()>=c.deadline then raise exception 'automatic capture lease'; end if;
  if jsonb_typeof(p_capture) is distinct from 'object' or octet_length(p_capture::text)>8000000 or
    not(p_capture ?& array['manifest','spendRegistration','base','costControl','delivery','asOf','receipt']) or
    p_capture-array['manifest','spendRegistration','base','costControl','delivery','asOf','receipt']<>'{}'
    then raise exception 'automatic capture shape'; end if;
  m:=p_capture->'manifest'; b:=p_capture->'base'; r:=p_capture->'receipt'; t:=g.registration_template;
  if jsonb_typeof(m) is distinct from 'object' or jsonb_typeof(b) is distinct from 'object' or
    jsonb_typeof(r) is distinct from 'object' or not(r ?& array['transport','credentialBindingRef','controlHash','nativeHash',
      'requests','bytes','controlStartedAt','controlCompletedAt','nativeStartedAt','nativeCompletedAt','accountMetadata']) or
    exists(select 1 from jsonb_each(r) where value='null'::jsonb) or
    p_capture->'asOf'='null'::jsonb or
    jsonb_typeof(m->'days') is distinct from 'array' or jsonb_array_length(m->'days')<>1 or
    m#>>'{days,0,date}' is distinct from c.report_date::text
    then raise exception 'automatic capture fields'; end if;
  if jsonb_typeof(r->'accountMetadata') is distinct from 'array' or jsonb_array_length(r->'accountMetadata')<>2 or
    exists(select 1 from jsonb_array_elements(r->'accountMetadata') x where
      x->>'accountId' is distinct from p.account_id or x->>'currency' is distinct from 'USD' or
      x->>'timezone' is distinct from 'America/New_York' or coalesce(x->>'responseSha256','') !~ '^[a-f0-9]{64}$' or
      coalesce((x->>'startedAt')::timestamptz<c.started_at,true) or
      coalesce((x->>'finishedAt')::timestamptz<(x->>'startedAt')::timestamptz,true) or
      (x->>'finishedAt')::timestamptz>clock_timestamp())
    then raise exception 'automatic native identity'; end if;
  if m->>'projectRef' is distinct from p.project_ref or m->>'accountId' is distinct from p.account_id or
    m->>'loginCustomerId' is distinct from p.login_customer_id or m->>'revisionRef' is distinct from 'auto:'||p_cycle or
    m->>'credentialBindingRef' is distinct from g.credential_binding_ref or
    m->>'approvalRef' is distinct from g.approval_ref or m->>'actorRef' is distinct from g.actor_ref or
    (m->>'preparedAt')::timestamptz is distinct from c.started_at or
    (m->>'freshnessCutoffAt')::timestamptz is distinct from c.started_at or
    (m#>>'{days,0,dueAt}')::timestamptz is distinct from c.started_at or
    (m->>'expiresAt')::timestamptz is distinct from date_trunc('milliseconds',g.expires_at) or
    m->'maxPages' is distinct from to_jsonb(g.max_pages) or m->'maxRequestsPerDay' is distinct from to_jsonb(2+g.max_pages) or
    m->'deadlineSeconds' is distinct from to_jsonb(g.source_deadline_seconds) or
    r->>'transport' is distinct from 'native_google_ads' or r->>'credentialBindingRef' is distinct from g.credential_binding_ref or
    (r->>'requests')::integer not between 1 and g.max_requests or (r->>'bytes')::integer not between 1 and g.max_bytes or
    coalesce(r->>'controlHash','') !~ '^[a-f0-9]{64}$' or coalesce(r->>'nativeHash','') !~ '^[a-f0-9]{64}$' or
    (r->>'controlStartedAt')::timestamptz<c.started_at or
    (r->>'controlCompletedAt')::timestamptz<(r->>'controlStartedAt')::timestamptz or
    (r->>'nativeStartedAt')::timestamptz<(r->>'controlCompletedAt')::timestamptz or
    (r->>'nativeCompletedAt')::timestamptz is distinct from (p_capture->>'asOf')::timestamptz or
    (p_capture->>'asOf')::timestamptz not between (r->>'nativeStartedAt')::timestamptz and clock_timestamp() or
    b->>'baseReportId' is distinct from p_capture#>>'{spendRegistration,days,0,runId}' or
    b->>'evidenceRef' is distinct from 'lean_private.spend_jobs/'||(b->>'baseReportId') or
    (b->>'completedAt')::timestamptz is distinct from (p_capture->>'asOf')::timestamptz or
    b->>'sourceCurrency' is distinct from 'USD' or b->>'sourceTimezone' is distinct from 'America/New_York' or
    p_capture#>>'{costControl,evidenceRef}' is distinct from 'google-auto-control:'||(r->>'controlHash')||':cost' or
    p_capture#>>'{delivery,control,evidenceRef}' is distinct from 'google-auto-control:'||(r->>'controlHash')||':counts' or
    (p_capture#>>'{costControl,capturedAt}')::timestamptz is distinct from (r->>'controlCompletedAt')::timestamptz or
    (p_capture#>>'{delivery,control,capturedAt}')::timestamptz is distinct from (r->>'controlCompletedAt')::timestamptz
    then raise exception 'automatic capture binding'; end if;
  foreach id in array array(select jsonb_array_elements_text(t->'historyRuns')) loop
    select * into strict h from lean_private.history_jobs where run_id=id for share;
    if encode(sha256(convert_to(to_jsonb(h)::text,'UTF8')),'hex') is distinct from g.history_bindings#>>array[id,'row'] or
      (select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(hp) order by page_number),'[]')::text,'UTF8')),'hex')
       from lean_private.history_pages hp where run_id=id) is distinct from g.history_bindings#>>array[id,'pages']
      then raise exception 'retained history changed'; end if;
  end loop;
  registration:=jsonb_build_object('version',1,'projectRef',p.project_ref,'shop',p.shop,'runId',c.run_id,'baseRunId',c.base_run,
    'historyRuns',t->'historyRuns','reportPolicy',t->'reportPolicy','fromDate',c.report_date,'throughDate',c.report_date,
    'spendRegistration',p_capture->'spendRegistration','fullPolicy',(t->'fullPolicy')||jsonb_build_object(
      'asOf',p_capture->'asOf','googleDelivery',p_capture->'delivery','freshGoogleSpend',jsonb_build_object(
        'manifest',m,'controls',jsonb_build_array(p_capture->'costControl'),'marketingInventory',jsonb_build_object(
          'shop',p.shop,'dates',jsonb_build_array(c.report_date),'accounts',jsonb_build_array(jsonb_build_object('provider','google_ads','accountId',p.account_id)),
          'complete',false,'independentlyExtracted',false,'evidenceRef','google-auto:'||p_cycle,
          'approvalRef',g.approval_ref,'capturedAt',p_capture->'asOf','salesScope','unverified','salesCoverageRef',null,
          'customerScope','unverified','customerCoverageRef',null))),
    'evidence',t->'evidence','behavior',t->'behavior','approvalRef',g.approval_ref,'actorRef',g.actor_ref);
  perform public.lean_google_workbook_register(registration);
  update lean_private.spend_pilots set enabled=true where pilot_id=p_capture#>>'{spendRegistration,pilotId}';
  update lean_private.spend_jobs set enabled=true where run_id=b->>'baseReportId';
  lease:=p_cycle;
  if public.lean_spend_claim(b->>'baseReportId',p.project_ref,lease)->>'state'<>'claimed' or
    not public.lean_spend_finish(b->>'baseReportId',p.project_ref,lease,b) then raise exception 'automatic native save'; end if;
  update lean_private.report_builds set enabled=true where run_id=c.base_run;
  update lean_private.full_builds set enabled=true where run_id=c.run_id;
  perform public.lean_google_standing_enqueue(p.policy_id,p.revision,c.run_id,'google-auto-control:'||(r->>'controlHash'));
  update lean_private.google_auto_cycles set state='registered',committed_at=clock_timestamp(),capture_receipt=r,
    capture_packet=p_capture,capture_sha256=encode(sha256(convert_to(p_capture::text,'UTF8')),'hex') where cycle_id=p_cycle;
  if clock_timestamp()>=c.deadline then raise exception 'automatic commit deadline'; end if;
  return jsonb_build_object('state','registered','runId',c.run_id);
end $$;

-- Actual observer transport is outside this database. The independent observer
-- capability cannot register sources, run full work, or use producer commits.
create function public.lean_google_auto_observe_claim(p_grant text,p_revision bigint,p_capability text,p_cycle uuid,p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare g lean_private.google_auto_grants; p lean_private.google_standing_policy; c lean_private.google_auto_cycles; body jsonb;
begin
  g:=lean_private.google_auto_authorize(p_grant,p_revision,p_capability,true);
  select * into strict p from lean_private.google_standing_policy where policy_id=g.policy_id for share;
  select * into strict c from lean_private.google_auto_cycles where cycle_id=p_cycle and grant_id=p_grant for update;
  if not g.enabled or not(c.state='registered' or c.state='observing' and clock_timestamp()>=c.observation_deadline) or
    p_token is null or c.observations>=g.max_observations or
    p.last_run is distinct from c.run_id then return jsonb_build_object('state','held'); end if;
  body:=public.lean_google_standing_read(p.project_ref,p.policy_id,p.revision,p.account_id);
  if body is null then return jsonb_build_object('state','unavailable'); end if;
  update lean_private.google_auto_cycles set state='observing',observations=observations+1,observation_token=p_token,
    observation_log=observation_log||jsonb_build_array(jsonb_build_object('attempt',observations+1,'token',p_token,
      'startedAt',clock_timestamp(),'previousReadLeaseExpired',state='observing')),
    observation_deadline=least(g.expires_at,clock_timestamp()+make_interval(secs=>g.observation_seconds)),
    selection_revision=p.selection_revision,canonical_sha256=encode(sha256(convert_to(body::text,'UTF8')),'hex') where cycle_id=p_cycle;
  return jsonb_build_object('state','observe','cycleId',p_cycle,'selectionRevision',p.selection_revision::text,
    'body',body,'destination',g.destination,'deadline',to_char(least(g.expires_at,clock_timestamp()+make_interval(secs=>g.observation_seconds))
      at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

create function public.lean_google_auto_state(p_grant text,p_revision bigint,p_capability text,p_observer boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare g lean_private.google_auto_grants; p lean_private.google_standing_policy; c lean_private.google_auto_cycles; s text; slot integer:=0;
begin
  g:=lean_private.google_auto_authorize(p_grant,p_revision,p_capability,p_observer);
  select * into strict p from lean_private.google_standing_policy where policy_id=g.policy_id for share;
  select * into c from lean_private.google_auto_cycles where grant_id=p_grant order by ordinal desc limit 1;
  if g.enabled and p.enabled and p.revision=g.policy_revision then slot:=lean_private.google_auto_slot(p_grant); end if;
  s:=case when p.revision<>g.policy_revision then 'disabled'
    when g.setup_receipt is null then 'setup_unbound'
    when not g.enabled or not p.enabled then 'disabled'
    when c.state='capture' or c.state='held' then 'held'
    when c.state='registered' and g.meta_policy is not null and c.meta_binding is null then 'meta_required'
    when c.state='registered' and g.meta_policy is not null and c.meta_packet is null then 'held'
    when c.state='registered' and p.last_run is distinct from c.run_id then 'advance'
    when c.state in ('registered','observing') and c.observations>=g.max_observations then 'held'
    when c.state='registered' or c.state='observing' and clock_timestamp()>=c.observation_deadline then 'observe'
    when c.state='observing' then 'reading'
    when g.cycles>=jsonb_array_length(g.capture_slots) then 'exhausted'
    when g.last_claimed_at+make_interval(secs=>g.cadence_seconds)>clock_timestamp() then 'not_due'
    when slot=0 then case when clock_timestamp()>=(g.capture_slots->-1->>'notBeforeUTC')::timestamptz then 'exhausted' else 'not_due' end
    else 'ready' end;
  return jsonb_build_object('state',s,'cycleId',c.cycle_id,'runId',c.run_id,'grantId',g.grant_id,'grantRevision',g.revision::text,
    'standingPolicy',p.policy_id,'standingRevision',p.revision::text,'nextSlotOrdinal',slot);
end $$;

create function public.lean_google_auto_observe_commit(p_grant text,p_revision bigint,p_capability text,p_cycle uuid,
  p_token uuid,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare g lean_private.google_auto_grants; p lean_private.google_standing_policy; c lean_private.google_auto_cycles; body jsonb;
begin
  g:=lean_private.google_auto_authorize(p_grant,p_revision,p_capability,true);
  select * into strict p from lean_private.google_standing_policy where policy_id=g.policy_id for share;
  select * into strict c from lean_private.google_auto_cycles where cycle_id=p_cycle and grant_id=p_grant for update;
  if not g.enabled or c.state<>'observing' or p_token is null or c.observation_token is distinct from p_token or
    clock_timestamp()>=c.observation_deadline or p.last_run is distinct from c.run_id or p.selection_revision<>c.selection_revision
    then raise exception 'automatic observation lease'; end if;
  body:=public.lean_google_standing_read(p.project_ref,p.policy_id,p.revision,p.account_id);
  if body is null or encode(sha256(convert_to(body::text,'UTF8')),'hex') is distinct from c.canonical_sha256
    then raise exception 'automatic selection changed'; end if;
  -- Atomic whole-table content is the population proof. The newest matching
  -- job is bounded sync evidence, not exhaustive history or a native table FK.
  if p_evidence->>'contractSha256' is distinct from g.destination->>'contractSha256' or
    coalesce(p_evidence->>'beforeSha256','') !~ '^[a-f0-9]{64}$' or
    p_evidence->>'beforeSha256' is distinct from p_evidence->>'afterSha256' or
    coalesce(p_evidence->>'tableSha256','') !~ '^[a-f0-9]{64}$' or
    p_evidence-array['contractSha256','beforeSha256','afterSha256','tableSha256','import']<>'{}' or
    not(p_evidence ?& array['contractSha256','beforeSha256','afterSha256','tableSha256','import'])
    then raise exception 'automatic observation proof'; end if;
  perform public.lean_google_standing_accept_import(p.policy_id,p.revision,p_evidence->'import');
  update lean_private.google_auto_cycles set state='accepted',accepted_at=clock_timestamp(),observation_receipt=p_evidence,
    observation_token=null,observation_deadline=null where cycle_id=p_cycle;
  if clock_timestamp()>=c.observation_deadline then raise exception 'automatic observation deadline'; end if;
  return jsonb_build_object('state','accepted','liveProviderQueriedByDatabase',false);
end $$;

create function public.lean_google_auto_observation(p_grant text,p_revision bigint,p_capability text,p_cycle uuid,p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare g lean_private.google_auto_grants; p lean_private.google_standing_policy; c lean_private.google_auto_cycles; body jsonb;
begin
  g:=lean_private.google_auto_authorize(p_grant,p_revision,p_capability,true);
  select * into strict p from lean_private.google_standing_policy where policy_id=g.policy_id for share;
  select * into strict c from lean_private.google_auto_cycles where cycle_id=p_cycle and grant_id=p_grant for share;
  if not g.enabled or c.state<>'observing' or c.observation_token is distinct from p_token or p_token is null or
    clock_timestamp()>=c.observation_deadline or p.last_run is distinct from c.run_id or p.selection_revision<>c.selection_revision
    then raise exception 'automatic observation lease'; end if;
  body:=public.lean_google_standing_read(p.project_ref,p.policy_id,p.revision,p.account_id);
  if body is null or encode(sha256(convert_to(body::text,'UTF8')),'hex') is distinct from c.canonical_sha256
    then raise exception 'automatic selection changed'; end if;
  return jsonb_build_object('state','observe','cycleId',p_cycle,'selectionRevision',p.selection_revision::text,
    'body',body,'destination',g.destination,'deadline',to_char(c.observation_deadline
      at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

-- Owner-only bridge for a separately authorized B1/Meta disabled registration.
-- This accessor grants no authority to acquire or register other source packs.
create function public.lean_google_auto_cycle_binding(p_cycle uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare c lean_private.google_auto_cycles; g lean_private.google_auto_grants; p lean_private.google_standing_policy;
  valid_until timestamptz;
begin
  -- Same lock order as producer/observer avoids deadlocks.
  select a.* into strict g from lean_private.google_auto_grants a
    join lean_private.google_auto_cycles x on x.grant_id=a.grant_id where x.cycle_id=p_cycle for share of a;
  select * into strict p from lean_private.google_standing_policy where policy_id=g.policy_id for share;
  select * into strict c from lean_private.google_auto_cycles where cycle_id=p_cycle for share;
  if not g.enabled or g.revoked or not p.enabled or p.revision<>g.policy_revision or
    c.grant_revision<>g.revision or c.state not in ('registered','observing','accepted') or c.capture_packet is null or
    encode(sha256(convert_to(c.capture_packet::text,'UTF8')),'hex') is distinct from c.capture_sha256
    then raise exception 'automatic cycle unavailable'; end if;
  valid_until:=least(g.expires_at,p.expires_at,(c.capture_packet#>>'{manifest,expiresAt}')::timestamptz,
    (c.capture_packet#>>'{base,completedAt}')::timestamptz+make_interval(secs=>p.max_source_age_seconds),
    (c.capture_packet#>>'{costControl,capturedAt}')::timestamptz+make_interval(secs=>p.max_source_age_seconds),
    (c.capture_packet#>>'{delivery,control,capturedAt}')::timestamptz+make_interval(secs=>p.max_source_age_seconds));
  if clock_timestamp()<g.not_before or clock_timestamp()>=valid_until then raise exception 'automatic cycle expired'; end if;
  return jsonb_build_object('cycleId',c.cycle_id,'grantId',g.grant_id,'grantRevision',g.revision::text,
    'projectRef',p.project_ref,'shop',p.shop,'accountId',p.account_id,'loginCustomerId',p.login_customer_id,
    'date',c.report_date,'slotOrdinal',c.ordinal,'slotNotBeforeUTC',g.capture_slots->(c.ordinal-1)->>'notBeforeUTC',
    'startedAt',c.started_at,'nativeDeadline',c.deadline,'committedAt',c.committed_at,
    'validUntil',valid_until,'captureSha256',c.capture_sha256,'packet',c.capture_packet,
    'metaPacket',c.meta_packet,'metaPacketSha256',c.meta_packet_sha256,'metaBinding',c.meta_binding,
    'metaReceipts',c.meta_receipts);
end $$;

-- Optional fixed Meta reservation for the separate combined B1 cycle. Three
-- requests are consumed once at claim, even if the external transport fails.
create function public.lean_google_auto_meta(p_grant text,p_revision bigint,p_capability text,p_cycle uuid,
  p_token uuid,p_action text,p_packet jsonb default null,p_receipts jsonb default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare g lean_private.google_auto_grants; p lean_private.google_standing_policy; c lean_private.google_auto_cycles;
  b jsonb; claimed timestamptz; until_time timestamptz; v jsonb;
begin
  g:=lean_private.google_auto_authorize(p_grant,p_revision,p_capability,false);
  select * into strict p from lean_private.google_standing_policy where policy_id=g.policy_id for share;
  select * into strict c from lean_private.google_auto_cycles where cycle_id=p_cycle and grant_id=p_grant for update;
  if not g.enabled or not p.enabled or p.revision<>g.policy_revision or c.grant_revision<>p_revision or
    c.state<>'registered' or c.capture_packet is null or p_token is null or g.meta_policy is null or
    g.meta_policy-array['maxBytes','captureSeconds','controlApprovalRef']<>'{}' or
    not(g.meta_policy ?& array['maxBytes','captureSeconds','controlApprovalRef']) or
    coalesce((g.meta_policy->>'maxBytes')::integer,0) not between 1 and 8388608 or
    coalesce((g.meta_policy->>'captureSeconds')::integer,0) not between 1 and 55 or
    coalesce(length(trim(g.meta_policy->>'controlApprovalRef')),0) not between 1 and 256
    then raise exception 'automatic Meta scope'; end if;
  v:=public.lean_google_auto_cycle_binding(p_cycle);
  if p_action='claim' and p_packet is null and p_receipts is null then
    if c.meta_binding is not null then raise exception 'automatic Meta attempt consumed'; end if;
    claimed:=date_trunc('milliseconds',clock_timestamp());
    until_time:=least((v->>'validUntil')::timestamptz,
      claimed+make_interval(secs=>(g.meta_policy->>'captureSeconds')::integer));
    if until_time<=claimed then raise exception 'automatic Meta source expired'; end if;
    b:=jsonb_build_object('version',1,'cycleId',p_cycle,'grantId',g.grant_id,'grantRevision',g.revision::text,
      'projectRef',p.project_ref,'shop',p.shop,'provider','meta','accountId','2796962933960445',
      'currency','USD','timezone','America/Los_Angeles','apiVersion','v25.0','date',c.report_date,
      'notBefore',to_char(claimed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'deadline',to_char(until_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'freshnessCutoffAt',to_char(claimed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'maxRequests',3,'maxBytes',(g.meta_policy->>'maxBytes')::integer,'accountLimit',49,'campaignLimit',1001,
      'approvalRef',g.approval_ref,'actorRef',g.actor_ref,'controlApprovalRef',g.meta_policy->>'controlApprovalRef');
    update lean_private.google_auto_cycles set meta_token=p_token,meta_binding=b where cycle_id=p_cycle;
    return jsonb_build_object('state','meta_capture','binding',b);
  end if;
  b:=c.meta_binding;
  if b is null or c.meta_token is distinct from p_token or c.meta_packet is not null or
    clock_timestamp()>=(b->>'deadline')::timestamptz then raise exception 'automatic Meta lease'; end if;
  if p_action='read' and p_packet is null and p_receipts is null then return jsonb_build_object('state','meta_capture','binding',b); end if;
  if p_action is distinct from 'commit' or jsonb_typeof(p_packet) is distinct from 'object' or
    p_packet->>'generationId' is distinct from 'auto_meta_'||p_cycle or
    p_packet->>'projectRef' is distinct from p.project_ref or p_packet->>'shop' is distinct from p.shop or
    p_packet->>'date' is distinct from c.report_date::text or p_packet->>'accountId' is distinct from 'act_2796962933960445' or
    p_packet->>'approvalRef' is distinct from g.approval_ref or p_packet->>'actorRef' is distinct from g.actor_ref or
    p_packet#>>'{control,approvalRef}' is distinct from g.meta_policy->>'controlApprovalRef' or
    coalesce((p_packet#>>'{source,capturedAt}')::timestamptz<(b->>'notBefore')::timestamptz,true) or
    coalesce((p_packet#>>'{control,capturedAt}')::timestamptz<(b->>'notBefore')::timestamptz,true) or
    (p_packet#>>'{source,capturedAt}')::timestamptz>clock_timestamp() or
    (p_packet#>>'{control,capturedAt}')::timestamptz>clock_timestamp()
    then raise exception 'automatic Meta packet'; end if;
  if jsonb_typeof(p_receipts) is distinct from 'object' or
    p_receipts-array['metadata','accountHours','campaignHours']<>'{}' or
    not(p_receipts ?& array['metadata','accountHours','campaignHours']) or octet_length(p_receipts::text)>3500000 or
    exists(select 1 from jsonb_each(p_receipts) x where
      coalesce((x.value->>'startedAt')::timestamptz<(b->>'notBefore')::timestamptz,true) or
      coalesce((x.value->>'finishedAt')::timestamptz<(x.value->>'startedAt')::timestamptz,true) or
      (x.value->>'finishedAt')::timestamptz>clock_timestamp() or
      coalesce(x.value->>'bodySha256','') !~ '^[a-f0-9]{64}$')
    then raise exception 'automatic Meta receipts'; end if;
  perform public.lean_marketing_spend_hourly_register(p_packet);
  update lean_private.google_auto_cycles set meta_packet=p_packet,meta_receipts=p_receipts,
    meta_packet_sha256=encode(sha256(convert_to(p_packet::text,'UTF8')),'hex') where cycle_id=p_cycle;
  if clock_timestamp()>=(b->>'deadline')::timestamptz then raise exception 'automatic Meta commit expired'; end if;
  return jsonb_build_object('state','meta_registered_disabled','generationId',p_packet->>'generationId',
    'packetSha256',encode(sha256(convert_to(p_packet::text,'UTF8')),'hex'));
end $$;

revoke all on function lean_private.google_auto_guard(),lean_private.google_auto_authorize(text,bigint,text,boolean),
  lean_private.google_auto_provider_close(date),lean_private.google_auto_slot(text),
  public.lean_google_auto_setup(text,bigint,text,jsonb),public.lean_google_auto_claim(text,bigint,text,uuid),
  public.lean_google_auto_commit(text,bigint,text,uuid,jsonb),
  public.lean_google_auto_observe_claim(text,bigint,text,uuid,uuid),
  public.lean_google_auto_observe_commit(text,bigint,text,uuid,uuid,jsonb),
  public.lean_google_auto_observation(text,bigint,text,uuid,uuid),
  public.lean_google_auto_state(text,bigint,text,boolean),public.lean_google_auto_cycle_binding(uuid),
  public.lean_google_auto_meta(text,bigint,text,uuid,uuid,text,jsonb,jsonb)
  from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_google_auto_setup(text,bigint,text,jsonb),
  public.lean_google_auto_claim(text,bigint,text,uuid),public.lean_google_auto_commit(text,bigint,text,uuid,jsonb),
  public.lean_google_auto_observe_claim(text,bigint,text,uuid,uuid),
  public.lean_google_auto_observe_commit(text,bigint,text,uuid,uuid,jsonb),
  public.lean_google_auto_observation(text,bigint,text,uuid,uuid),
  public.lean_google_auto_state(text,bigint,text,boolean),
  public.lean_google_auto_meta(text,bigint,text,uuid,uuid,text,jsonb,jsonb) to service_role;
commit;
