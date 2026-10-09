-- PRIVATE DEFAULT-OFF. Additive B5 registration. No grants, source reads or activation.
-- Requires the exact assembled 8caf/B6/v3 chain and owner-supplied function pins.
begin;
set local search_path=pg_catalog;
set local statement_timeout='15s';
set local lock_timeout='2s';
do $pins$
declare pins jsonb:=nullif(current_setting('lean.source_session_report_install_contract',true),'')::jsonb;
  pin jsonb; f record;
begin
  if jsonb_typeof(pins) is distinct from 'array' or jsonb_array_length(pins)<6 or
    to_regclass('lean_private.source_session_report_grants') is not null then raise exception 'UNBOUND source report'; end if;
  if (select count(distinct x->>'signature') from jsonb_array_elements(pins) x)<>jsonb_array_length(pins)
    or not exists(select 1 from jsonb_array_elements(pins) x where x->>'signature'='public.lean_full_inputs(text,text)')
    or not exists(select 1 from jsonb_array_elements(pins) x where x->>'signature'='public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb)')
    or not exists(select 1 from jsonb_array_elements(pins) x where x->>'signature'='public.lean_sales_event_cycle_stage(uuid,jsonb,jsonb)')
    or not exists(select 1 from jsonb_array_elements(pins) x where x->>'signature'='public.lean_sales_event_cycle_enable(uuid,text,text)')
    or not exists(select 1 from jsonb_array_elements(pins) x where x->>'signature'='lean_private.sales_event_cycle_current(uuid,boolean)')
    or not exists(select 1 from jsonb_array_elements(pins) x where x->>'signature'='lean_private.source_session_policy(text)')
    then raise exception 'incomplete source report pins'; end if;
  for pin in select value from jsonb_array_elements(pins) loop
    select * into f from pg_proc where oid=to_regprocedure(pin->>'signature');
    if not found or f.proowner<>current_user::regrole::oid or
      f.oid::text is distinct from pin->>'oid' or f.proowner::text is distinct from pin->>'ownerOid' or
      encode(sha256(convert_to(pg_get_functiondef(f.oid),'UTF8')),'hex') is distinct from pin->>'definitionSha256' or
      encode(sha256(convert_to(coalesce(f.proacl::text,'null'),'UTF8')),'hex') is distinct from pin->>'aclSha256'
      then raise exception 'source report function changed'; end if;
  end loop;
  perform set_config('lean.source_session_report_prior_acl',(
    select jsonb_object_agg(p.oid::regprocedure::text,(select jsonb_agg(jsonb_build_object('grantee',a.grantee,
      'grantor',a.grantor,'grantable',a.is_grantable) order by a.grantee,a.grantor,a.is_grantable)
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.privilege_type='EXECUTE'))
    from pg_proc p where p.oid=any(array['public.lean_full_inputs(text,text)'::regprocedure::oid,
      'public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb)'::regprocedure::oid]))::text,true);
end $pins$;

create table lean_private.source_session_report_grants (
  grant_id text primary key check(length(grant_id) between 1 and 128),
  revision bigint not null check(revision>0),
  project_ref text not null check(project_ref='xnfjdbpjuaezxjgargto'),
  shop text not null check(shop='mullybox-store.myshopify.com'),
  posthog_project text not null check(posthog_project='353503'),
  source_policy jsonb not null, entry_policy jsonb not null, full_policy jsonb not null,
  source_plan jsonb not null check(source_plan='{"version":"native-entry-day-v1","nativeQueries":1,"authorityReads":2,"maxNativeRows":1000,"maxGrantRows":1000,"maxReceiptRows":1000,"nativeBytes":1048576,"authorityBytes":2097152,"packetBytes":8388608,"requestMs":5000,"totalMs":15000,"filterSha256":"61504f7e32de2ff2d4197a26e25ba57f412891b9c03e6d27b3ef7568e3829819"}'::jsonb),
  slots jsonb not null check(jsonb_typeof(slots)='array' and jsonb_array_length(slots) between 1 and 1000),
  max_attempts integer not null check(max_attempts between 1 and 1000), attempts integer not null default 0,
  approval_ref text not null check(length(trim(approval_ref)) between 1 and 512),
  actor_ref text not null check(length(trim(actor_ref)) between 1 and 512),
  created_at timestamptz not null, authority_history_from timestamptz not null,
  not_before timestamptz not null, expires_at timestamptz not null,
  enabled boolean not null default false, revoked boolean not null default false,
  check(attempts between 0 and max_attempts and max_attempts<=jsonb_array_length(slots)),
  check(isfinite(not_before) and isfinite(expires_at) and not_before>=created_at and
    expires_at>not_before and expires_at<=not_before+interval '14 days'),
  check(authority_history_from=created_at),
  check(jsonb_typeof(entry_policy)='object' and entry_policy->>'filterSha256'='61504f7e32de2ff2d4197a26e25ba57f412891b9c03e6d27b3ef7568e3829819'
    and entry_policy->'filterCount'='6'::jsonb and (entry_policy->>'maxReadAgeSeconds')::integer between 1 and 3600),
  check(jsonb_typeof(full_policy)='object' and full_policy->>'behaviorMode'='excluded' and
    full_policy->'cohorts'='[]'::jsonb and not(full_policy ?| array['asOf','salesEventWindow','nativeSpendWindow',
      'freshGoogleSpend','googleDelivery','customerGeneration','sessionEntryPolicy','sourceSessionReport']))
);
create table lean_private.source_session_report_claims (
  claim_id uuid primary key, grant_id text not null references lean_private.source_session_report_grants,
  grant_revision bigint not null, slot_ordinal integer not null check(slot_ordinal between 1 and 1000),
  mode text not null check(mode in ('paired_financial','entry_cohort')), report_date date not null,
  cycle_id uuid unique, run_id text not null unique, base_run text not null,
  base_result_hash text, started_at timestamptz not null, deadline timestamptz not null, valid_until timestamptz not null,
  state text not null check(state in ('capture','registered','enabled')),
  authority_reads integer not null default 0 check(authority_reads between 0 and 2),
  authority_before jsonb, authority_after jsonb,
  packet jsonb, packet_digest text, binding jsonb, enabled boolean not null default false,
  unique(grant_id,slot_ordinal),
  check((mode='paired_financial')=(cycle_id is not null)),
  check((mode='entry_cohort')=(base_result_hash is not null)),
  check(deadline>started_at and deadline<=started_at+interval '60 seconds' and valid_until>=deadline),
  check((state='capture')=(packet is null)),
  check(authority_before is null or octet_length(authority_before::text)<=2097152),
  check(authority_after is null or octet_length(authority_after::text)<=2097152),
  check(packet is null or octet_length(packet::text)<=8388608)
);
alter table lean_private.source_session_report_grants enable row level security;
alter table lean_private.source_session_report_claims enable row level security;
revoke all on lean_private.source_session_report_grants,lean_private.source_session_report_claims
  from public,anon,authenticated,service_role,lean_posthog_reader;

create function lean_private.source_session_report_grant_insert() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare slot jsonb; prior timestamptz; now_at timestamptz;
begin
  -- Observe a real prospective authority epoch. Neither a supplied timestamp nor
  -- the old policy's missing creation time may backdate this observation.
  perform 1 from lean_private.journey_policies where project_ref=new.project_ref and shop=new.shop
    and posthog_project=new.posthog_project and policy_version='source-session-runtime-v3' for update;
  perform lean_private.source_session_policy(new.source_policy->>'configToken');
  if new.source_policy is distinct from public.lean_source_session_config() or new.enabled or new.revoked or new.attempts<>0
    then raise exception 'source report grant must start disabled'; end if;
  now_at:=clock_timestamp();
  new.created_at:=now_at; new.authority_history_from:=now_at;
  if new.expires_at>(new.source_policy->>'validUntil')::timestamptz then raise exception 'source report grant beyond policy'; end if;
  for slot in select value from jsonb_array_elements(new.slots) loop
    if (select count(*) from jsonb_object_keys(slot))<>3 or not(slot ?& array['mode','date','notBeforeUTC']) or
      slot->>'mode' not in ('paired_financial','entry_cohort') or slot->>'date' !~ '^\d{4}-\d{2}-\d{2}$' or
      (slot->>'notBeforeUTC')::timestamptz<new.not_before or (slot->>'notBeforeUTC')::timestamptz>=new.expires_at or
      (slot->>'notBeforeUTC')::timestamptz<(((slot->>'date')::date+1)::timestamp at time zone 'America/New_York') or
      prior is not null and prior>=(slot->>'notBeforeUTC')::timestamptz then raise exception 'source report slots'; end if;
    prior:=(slot->>'notBeforeUTC')::timestamptz;
  end loop;
  return new;
end $$;

create trigger source_report_grant_insert before insert on lean_private.source_session_report_grants
  for each row execute function lean_private.source_session_report_grant_insert();
create function lean_private.source_session_report_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' then raise exception 'source report immutable'; end if;
  if tg_table_name='source_session_report_grants' then
    if to_jsonb(old)-array['enabled','revoked','attempts'] is distinct from to_jsonb(new)-array['enabled','revoked','attempts'] or
      new.attempts<old.attempts or old.revoked and not new.revoked then raise exception 'source report grant immutable'; end if;
  elsif to_jsonb(old)-array['state','packet','packet_digest','binding','enabled','authority_reads','authority_before','authority_after'] is distinct from
      to_jsonb(new)-array['state','packet','packet_digest','binding','enabled','authority_reads','authority_before','authority_after'] or
    new.authority_reads<old.authority_reads or
    old.authority_before is not null and old.authority_before is distinct from new.authority_before or
    old.authority_after is not null and old.authority_after is distinct from new.authority_after or
    old.packet is not null and (old.packet,old.packet_digest,old.binding) is distinct from (new.packet,new.packet_digest,new.binding) or
    not(old.state=new.state or old.state='capture' and new.state='registered' or old.state='registered' and new.state='enabled')
    then raise exception 'source report claim immutable'; end if;
  return new;
end $$;
create trigger source_report_grant_immutable before update or delete on lean_private.source_session_report_grants
  for each row execute function lean_private.source_session_report_immutable();
create trigger source_report_claim_immutable before update or delete on lean_private.source_session_report_claims
  for each row execute function lean_private.source_session_report_immutable();

-- Published order for EVERY paired operation: Google/B1 grant/cycle, B5 grant,
-- B5 claim, source policy UPDATE, grant SHARE, native receipt SHARE, then target
-- base/full/publication. Policy UPDATE is the FIRST policy lock, not an upgrade.
-- Existing v3 creators take policy SHARE first, preventing population phantoms.
-- Withdrawal takes grant UPDATE first and can therefore serialize before any
-- reporting publication lock. No selected-publication/export writes occur here.
create function lean_private.source_session_report_current(p_claim uuid,p_enabled boolean)
returns lean_private.source_session_report_claims language plpgsql set search_path=pg_catalog as $$
declare c lean_private.source_session_report_claims; g lean_private.source_session_report_grants;
begin
  select * into strict c from lean_private.source_session_report_claims where claim_id=p_claim;
  if c.cycle_id is not null then perform lean_private.sales_event_cycle_current(c.cycle_id,p_enabled); end if;
  select * into strict g from lean_private.source_session_report_grants where grant_id=c.grant_id for share;
  select * into strict c from lean_private.source_session_report_claims where claim_id=p_claim for update;
  if current_setting('transaction_isolation')<>'read committed' or not g.enabled or g.revoked or
    g.revision<>c.grant_revision or clock_timestamp()<g.not_before or clock_timestamp()>=least(g.expires_at,c.valid_until) or
    p_enabled and (not c.enabled or c.state<>'enabled') then raise exception 'source report unavailable'; end if;
  perform 1 from lean_private.journey_policies where project_ref=g.project_ref and shop=g.shop
    and posthog_project=g.posthog_project and policy_version='source-session-runtime-v3' for update;
  perform lean_private.source_session_policy(g.source_policy->>'configToken');
  if public.lean_source_session_config() is distinct from g.source_policy then raise exception 'source report policy changed'; end if;
  if exists(select 1 from lean_private.journey_grants where project_ref=g.project_ref and shop=g.shop and posthog_project=g.posthog_project
    and permission_evidence_ref like 'explicit-browser-choice:source-session-runtime-v3:%'
    and valid_from<((c.report_date+1)::timestamp at time zone 'America/New_York')
    and expires_at>(c.report_date::timestamp at time zone 'America/New_York') offset 1000 limit 1)
    then raise exception 'source report grant population budget'; end if;
  perform 1 from lean_private.journey_grants where project_ref=g.project_ref and shop=g.shop and posthog_project=g.posthog_project
    and permission_evidence_ref like 'explicit-browser-choice:source-session-runtime-v3:%'
    and valid_from<((c.report_date+1)::timestamp at time zone 'America/New_York')
    and expires_at>(c.report_date::timestamp at time zone 'America/New_York') order by token_hash for share;
  perform 1 from lean_private.source_session_receipts r join lean_private.journey_grants a on a.token_hash=r.grant_hash
    where a.project_ref=g.project_ref and a.shop=g.shop and a.posthog_project=g.posthog_project
    and a.permission_evidence_ref like 'explicit-browser-choice:source-session-runtime-v3:%'
    and a.valid_from<((c.report_date+1)::timestamp at time zone 'America/New_York')
    and a.expires_at>(c.report_date::timestamp at time zone 'America/New_York') order by r.native_session_id for share of r;
  return c;
end $$;

create function public.lean_source_session_report_claim(p_grant text,p_slot integer,p_cycle uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare g lean_private.source_session_report_grants; bc lean_private.sales_event_cycles; b lean_private.report_builds;
  slot jsonb; c lean_private.source_session_report_claims; at_time timestamptz; policy jsonb; target jsonb;
begin
  if p_cycle is not null then perform lean_private.sales_event_cycle_current(p_cycle,false); end if;
  select * into strict g from lean_private.source_session_report_grants where grant_id=p_grant for update;
  at_time:=clock_timestamp(); slot:=g.slots->(p_slot-1);
  if not g.enabled or g.revoked or at_time<g.not_before or at_time>=g.expires_at or g.attempts>=g.max_attempts or
    p_slot is null or p_slot<1 or p_slot>jsonb_array_length(g.slots) or at_time<(slot->>'notBeforeUTC')::timestamptz or
    exists(select 1 from lean_private.source_session_report_claims x left join lean_private.full_builds f on f.run_id=x.run_id
      where x.grant_id=g.grant_id and (x.slot_ordinal>=p_slot or f.completed_at is null))
    then raise exception 'source report claim held'; end if;
  c.claim_id:=gen_random_uuid(); c.grant_id:=g.grant_id; c.grant_revision:=g.revision; c.slot_ordinal:=p_slot;
  c.mode:=slot->>'mode'; c.report_date:=(slot->>'date')::date; c.cycle_id:=p_cycle; c.started_at:=at_time;
  c.valid_until:=least(g.expires_at,(g.source_policy->>'validUntil')::timestamptz);
  c.valid_until:=least(c.valid_until,at_time+make_interval(secs=>(g.entry_policy->>'maxReadAgeSeconds')::integer));
  perform 1 from lean_private.journey_policies where project_ref=g.project_ref and shop=g.shop
    and posthog_project=g.posthog_project and policy_version='source-session-runtime-v3' for update;
  perform lean_private.source_session_policy(g.source_policy->>'configToken');
  if c.mode='paired_financial' then
    if p_cycle is null then raise exception 'source report needs financial cycle'; end if;
    select * into strict bc from lean_private.sales_event_cycles where cycle_id=p_cycle;
    if bc.state<>'capture' or bc.report_date<>c.report_date then raise exception 'source report financial cycle scope'; end if;
    c.run_id:=bc.run_id; c.base_run:=bc.base_run; c.valid_until:=least(c.valid_until,bc.valid_until);
    c.deadline:=least(at_time+interval '60 seconds',c.valid_until,bc.deadline);
  else
    if p_cycle is not null then raise exception 'cohort cannot inherit financial authority'; end if;
    -- A completed exact-day base is provenance only. No old operating authority
    -- is enabled or renewed, and no empty base is fabricated when one is absent.
    select * into b from lean_private.report_builds where project_ref=g.project_ref and shop=g.shop and
      from_date=c.report_date and through_date=c.report_date and completed_at is not null
      order by completed_at desc,run_id limit 1 for share;
    if not found or not exists(select 1 from lean_private.publications where publication_id='observed:'||b.run_id)
      then raise exception 'cohort authentic base unavailable'; end if;
    c.run_id:='b5_cohort_'||c.claim_id; c.base_run:=b.run_id; c.base_result_hash:=b.result_hash;
    c.deadline:=least(at_time+interval '60 seconds',c.valid_until);
  end if;
  c.state:='capture'; c.enabled:=false; c.authority_reads:=0;
  insert into lean_private.source_session_report_claims select c.*;
  update lean_private.source_session_report_grants set attempts=attempts+1 where grant_id=g.grant_id;
  perform lean_private.source_session_report_current(c.claim_id,false);
  policy:=g.full_policy;
  target:=jsonb_build_object('mode',c.mode,'projectRef',g.project_ref,'shop',g.shop,'posthogProject',g.posthog_project,
    'runId',c.run_id,'baseRunId',c.base_run,'fromDate',c.report_date,'throughDate',c.report_date,
    'definition',policy->>'definition','mappingVersion',policy->>'mappingVersion',
    'sessionVersion',policy->>'sessionVersion','funnelVersion',policy->>'funnelVersion');
  return jsonb_build_object('reportAuthority',jsonb_build_object('grantId',g.grant_id,'grantRevision',g.revision::text,'claimId',c.claim_id),
    'target',target,'financialBinding',null,'baseBinding',case when c.mode='entry_cohort' then jsonb_build_object(
      'baseRunId',c.base_run,'publicationId','observed:'||c.base_run,'resultHash',c.base_result_hash,
      'fromDate',c.report_date,'throughDate',c.report_date) else null end,
    'sourcePolicy',g.source_policy,'entryPolicy',g.entry_policy,'sourcePlan',g.source_plan,
    'authorityHistoryFrom',to_char(g.authority_history_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'startedAt',to_char(c.started_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'deadline',to_char(c.deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'validUntil',to_char(c.valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end $$;

create function lean_private.source_session_report_bound(p_claim uuid,p_enabled boolean)
returns lean_private.source_session_report_claims language plpgsql set search_path=pg_catalog as $$
declare c lean_private.source_session_report_claims; g lean_private.source_session_report_grants;
  a jsonb; f lean_private.full_builds; b lean_private.report_builds;
begin
  c:=lean_private.source_session_report_current(p_claim,p_enabled);
  select * into strict g from lean_private.source_session_report_grants where grant_id=c.grant_id;
  if c.packet is null then raise exception 'source report not registered'; end if;
  a:=lean_private.source_session_report_population(c.claim_id,c.report_date::timestamp at time zone 'America/New_York',
    (c.report_date+1)::timestamp at time zone 'America/New_York');
  if (a-'capturedAt') is distinct from ((c.packet#>'{entries,authorityAfter}')-array['capturedAt','digest']) or
    c.packet_digest is distinct from lean_private.partition_digest(c.packet-'digest')
    then raise exception 'source report authority changed'; end if;
  if c.mode='paired_financial' then
    perform 1 from lean_private.sales_event_window_inputs where run_id=c.run_id for update;
    select * into strict b from lean_private.report_builds where run_id=c.base_run for update;
  else select * into strict b from lean_private.report_builds where run_id=c.base_run for share; end if;
  select * into strict f from lean_private.full_builds where run_id=c.run_id for update;
  if f.project_ref<>g.project_ref or f.base_run<>c.base_run or b.project_ref<>g.project_ref or b.shop<>g.shop or
    b.from_date<>c.report_date or b.through_date<>c.report_date or
    f.policy->>'asOf' is distinct from c.packet#>>'{target,asOf}' or
    c.mode='entry_cohort' and (b.completed_at is null or b.result_hash is distinct from c.base_result_hash or
      f.policy is distinct from g.full_policy||jsonb_build_object('asOf',c.packet#>>'{target,asOf}') or
      f.policy ?| array['salesEventWindow','nativeSpendWindow','freshGoogleSpend','googleDelivery','customerGeneration'])
    then raise exception 'source report target changed'; end if;
  return c;
end $$;

create function public.lean_source_session_report_register(p_claim uuid,p_packet jsonb,p_scope jsonb,p_spend jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c lean_private.source_session_report_claims; g lean_private.source_session_report_grants;
  a jsonb; target jsonb; financial jsonb:='null'; base jsonb:='null'; v_binding jsonb; e jsonb; f lean_private.full_builds;
  at_time timestamptz; snapshot jsonb;
begin
  c:=lean_private.source_session_report_current(p_claim,false);
  select * into strict g from lean_private.source_session_report_grants where grant_id=c.grant_id;
  if c.state<>'capture' or c.authority_reads<>2 or clock_timestamp()>=c.deadline or jsonb_typeof(p_packet) is distinct from 'object' or
    octet_length(p_packet::text)>8388608 or p_packet->>'kind' is distinct from 'source-session-report-v1' or
    p_packet->'version' is distinct from '1'::jsonb or p_packet->>'digest' is distinct from lean_private.partition_digest(p_packet-'digest') or
    p_packet->'reportAuthority' is distinct from jsonb_build_object('grantId',g.grant_id,'grantRevision',g.revision::text,'claimId',c.claim_id) or
    p_packet->'sourcePolicy' is distinct from g.source_policy or p_packet->'entryPolicy' is distinct from g.entry_policy or
    p_packet->'sourcePlan' is distinct from g.source_plan or
    p_packet->'actions' is distinct from '{"state":"unavailable","reason":"no_admitted_action_namespace"}'::jsonb or
    p_packet->'paid' is distinct from '{"state":"unavailable","reason":"no_independent_paid_population"}'::jsonb
    then raise exception 'source report packet mismatch'; end if;
  at_time:=(p_packet#>>'{target,asOf}')::timestamptz;
  if at_time is null or at_time<c.started_at or at_time>=c.deadline or at_time>clock_timestamp() or
    (p_packet->>'capturedAt')::timestamptz>at_time then raise exception 'source report asof'; end if;
  target:=jsonb_build_object('mode',c.mode,'projectRef',g.project_ref,'shop',g.shop,'posthogProject',g.posthog_project,
    'runId',c.run_id,'baseRunId',c.base_run,'fromDate',c.report_date,'throughDate',c.report_date,
    'asOf',p_packet#>>'{target,asOf}','definition',g.full_policy->>'definition','mappingVersion',g.full_policy->>'mappingVersion',
    'sessionVersion',g.full_policy->>'sessionVersion','funnelVersion',g.full_policy->>'funnelVersion');
  if p_packet->'target' is distinct from target then raise exception 'source report exact target'; end if;
  a:=lean_private.source_session_report_population(c.claim_id,c.report_date::timestamp at time zone 'America/New_York',
    (c.report_date+1)::timestamp at time zone 'America/New_York');
  foreach snapshot in array array[p_packet#>'{entries,authorityBefore}',p_packet#>'{entries,authorityAfter}'] loop
    if snapshot is null or snapshot-array['capturedAt','digest'] is distinct from a-'capturedAt' or
      snapshot->>'digest' is distinct from lean_private.partition_digest(snapshot-'digest') or
      (snapshot->>'capturedAt')::timestamptz<c.started_at or (snapshot->>'capturedAt')::timestamptz>at_time
      then raise exception 'source report capture authority mismatch'; end if;
  end loop;
  if ((p_packet#>'{entries,authorityBefore}')-'digest') is distinct from c.authority_before or
    ((p_packet#>'{entries,authorityAfter}')-'digest') is distinct from c.authority_after or
    (c.authority_after->>'capturedAt')::timestamptz-(c.authority_before->>'capturedAt')::timestamptz>interval '15 seconds'
    then raise exception 'source report saved authority receipts'; end if;
  if c.mode='paired_financial' then
    financial:=jsonb_build_object('cycleId',c.cycle_id,'salesEventSourceDigest',p_scope->>'sourceDigest',
      'nativeSpendDigest',p_spend->>'digest','registrationScopeDigest',lean_private.partition_digest(p_scope));
    if p_scope#>>'{fullPolicy,asOf}' is distinct from target->>'asOf' or
      p_scope#>>'{fullPolicy,definition}' is distinct from target->>'definition' or
      p_scope#>>'{fullPolicy,mappingVersion}' is distinct from target->>'mappingVersion' or
      p_scope#>>'{fullPolicy,sessionVersion}' is distinct from target->>'sessionVersion' or
      p_scope#>>'{fullPolicy,funnelVersion}' is distinct from target->>'funnelVersion'
      then raise exception 'source report paired sealed policy'; end if;
    -- The unchanged financial registrar creates both disabled rows. A failure
    -- anywhere below rolls back that registration and its marketing binding.
    perform public.lean_sales_event_cycle_stage(c.cycle_id,p_scope,p_spend);
  else
    if p_scope is not null or p_spend is not null then raise exception 'cohort financial injection'; end if;
    base:=jsonb_build_object('baseRunId',c.base_run,'publicationId','observed:'||c.base_run,
      'resultHash',c.base_result_hash,'fromDate',c.report_date,'throughDate',c.report_date);
    e:=jsonb_build_object('ref','source-session-report:'||(p_packet->>'digest'),
      'identity','[]'::jsonb,'currentlyPermitted','[]'::jsonb,'removedCustomers','[]'::jsonb,'customerHistory','{}'::jsonb,
      'orderIdentities','[]'::jsonb,'checkout','[]'::jsonb,'campaigns','[]'::jsonb,
      'sessionCoverage',jsonb_build_object('behaviorComplete',false,'completeThrough',target->>'asOf',
        'graceSeconds',172800,'approvalRef',g.approval_ref),
      'attributionCoverage','[]'::jsonb,'replacements','[]'::jsonb,'settlements','[]'::jsonb,'offers','[]'::jsonb,
      'proofs','[]'::jsonb,'externalControls','{}'::jsonb,'comparisons','[]'::jsonb,'cohortCoverage','[]'::jsonb,
      'dateCoverage',jsonb_build_array(jsonb_build_object('date',c.report_date,'evidenceRef','source-session-report:'||(p_packet->>'digest'),
        'gates','{"ledger":false,"cash":false,"orders":false,"purchase":false,"customers":false,"spend":false,"attribution":false,"behavior":false,"productAllocation":false}'::jsonb)));
    insert into lean_private.full_builds(run_id,project_ref,base_run,policy,evidence,behavior,approval_ref,actor_ref)
      values(c.run_id,g.project_ref,c.base_run,g.full_policy||jsonb_build_object('asOf',target->>'asOf'),e,'{}',g.approval_ref,g.actor_ref);
  end if;
  if p_packet->'financialBinding' is distinct from financial or p_packet->'baseBinding' is distinct from base
    then raise exception 'source report provenance binding'; end if;
  select * into strict f from lean_private.full_builds where run_id=c.run_id for update;
  if f.enabled or f.attempts<>0 or f.completed_at is not null or f.lease_token is not null or f.project_ref<>g.project_ref or
    f.base_run<>c.base_run or f.policy ? 'sourceSessionReport' or f.evidence ? 'sourceSessionReport'
    then raise exception 'source report target already used'; end if;
  v_binding:=jsonb_build_object('version',1,'digest',p_packet->>'digest','mode',c.mode,
    'projectRef',g.project_ref,'shop',g.shop,'posthogProject',g.posthog_project,'runId',c.run_id,'baseRunId',c.base_run,
    'fromDate',c.report_date,'throughDate',c.report_date,'asOf',target->>'asOf','sourceConfigToken',g.source_policy->>'configToken',
    'reportAuthority',p_packet->'reportAuthority','financialBinding',financial,'baseBinding',base);
  update lean_private.source_session_report_claims set state='registered',packet=p_packet,packet_digest=p_packet->>'digest',
    binding=v_binding where claim_id=c.claim_id;
  perform lean_private.source_session_report_bound(c.claim_id,false);
  if clock_timestamp()>=c.deadline then raise exception 'source report registration expired'; end if;
  return jsonb_build_object('state','registered','runId',c.run_id,'digest',p_packet->>'digest','binding',v_binding,'enabled',false);
end $$;

create function public.lean_source_session_report_enable(p_claim uuid,p_digest text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare c lean_private.source_session_report_claims; f lean_private.full_builds;
begin
  c:=lean_private.source_session_report_bound(p_claim,false);
  select * into strict f from lean_private.full_builds where run_id=c.run_id;
  if c.state<>'registered' or c.packet_digest is distinct from p_digest or f.enabled or f.attempts<>0 or f.completed_at is not null
    then raise exception 'source report enable mismatch'; end if;
  if c.mode='paired_financial' then
    perform public.lean_sales_event_cycle_enable(c.cycle_id,c.packet#>>'{financialBinding,registrationScopeDigest}',
      c.packet#>>'{financialBinding,nativeSpendDigest}');
  else update lean_private.full_builds set enabled=true where run_id=c.run_id; end if;
  update lean_private.source_session_report_claims set state='enabled',enabled=true where claim_id=c.claim_id;
  perform lean_private.source_session_report_bound(c.claim_id,true);
  return true;
end $$;

-- Cohort input intentionally does not call the financial wrapper chain. The
-- completed base is immutable provenance, not a renewed financial operating grant.
create function lean_private.source_session_report_cohort_input(p_claim uuid) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare c lean_private.source_session_report_claims; f lean_private.full_builds; b lean_private.report_builds;
  t text; projection text; rows jsonb; facts jsonb:='{}'; input jsonb;
begin
  c:=lean_private.source_session_report_bound(p_claim,true);
  if c.mode<>'entry_cohort' then raise exception 'source cohort mode required'; end if;
  select * into strict f from lean_private.full_builds where run_id=c.run_id;
  select * into strict b from lean_private.report_builds where run_id=c.base_run;
  if not f.enabled then return jsonb_build_object('state','disabled'); end if;
  if f.completed_at is not null then return jsonb_build_object('state','complete'); end if;
  perform 1 from lean_private.publications where publication_id='observed:'||b.run_id for share;
  if not found then raise exception 'source cohort base publication absent'; end if;
  foreach t in array array['customers','identity_map','orders','order_items','sales_ledger','payments',
    'order_item_offers','sessions','marketing_spend_daily','order_attribution'] loop
    select string_agg(format('%L,%s',a.attname,case
      when a.atttypid='numeric'::regtype then format('x.%I::text',a.attname)
      when a.atttypid='timestamptz'::regtype then
        format('to_char(x.%I at time zone ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',a.attname)
      else format('x.%I',a.attname) end),',' order by a.attnum) into projection from pg_attribute a
      where a.attrelid=format('lean_private.%I',t)::regclass and a.attnum>0 and not a.attisdropped;
    execute format('select coalesce(jsonb_agg(jsonb_build_object(%s) order by to_jsonb(x)::text),''[]''::jsonb)
      from lean_private.%I x where publication_id=$1',projection,t) into rows using 'observed:'||b.run_id;
    if jsonb_array_length(rows)>10000 then raise exception 'source cohort base budget'; end if;
    facts:=facts||jsonb_build_object(t,rows);
  end loop;
  input:=jsonb_build_object('state','ready','publication','full:'||f.run_id,'shop',b.shop,'fromDate',b.from_date,
    'throughDate',b.through_date,'facts',facts,'policy',f.policy,'evidence',f.evidence,'behavior',f.behavior,'deferredOrders','[]'::jsonb);
  if octet_length(input::text)>8000000 then raise exception 'source cohort input budget'; end if;
  return input||jsonb_build_object('inputHash',md5(input::text));
end $$;

alter function public.lean_full_inputs(text,text) rename to lean_full_inputs_before_source_session_report;
create function public.lean_full_inputs(p_run text,p_project_ref text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare c lean_private.source_session_report_claims; input jsonb;
begin
  select * into c from lean_private.source_session_report_claims where run_id=p_run;
  if not found then return public.lean_full_inputs_before_source_session_report(p_run,p_project_ref); end if;
  if not exists(select 1 from lean_private.full_builds where run_id=p_run and project_ref=p_project_ref)
    then raise exception 'source report wrong project'; end if;
  if not c.enabled then return jsonb_build_object('state','disabled'); end if;
  c:=lean_private.source_session_report_bound(c.claim_id,true);
  if c.mode='entry_cohort' then input:=lean_private.source_session_report_cohort_input(c.claim_id);
  else input:=public.lean_full_inputs_before_source_session_report(p_run,p_project_ref); end if;
  if input->>'state'='ready' then
    input:=(input-'inputHash')||jsonb_build_object('sourceSessionReport',c.packet,'sourceSessionReportBinding',c.binding);
    if octet_length(input::text)>16777216 then raise exception 'source report combined input budget'; end if;
    input:=input||jsonb_build_object('inputHash',md5(input::text));
  end if;
  perform lean_private.source_session_report_bound(c.claim_id,true);
  return input;
end $$;

create function lean_private.source_session_report_population(p_claim uuid,p_from timestamptz,p_until timestamptz)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare c lean_private.source_session_report_claims; g lean_private.source_session_report_grants;
  grants jsonb; receipts jsonb; payload jsonb;
begin
  c:=lean_private.source_session_report_current(p_claim,false);
  select * into strict g from lean_private.source_session_report_grants where grant_id=c.grant_id;
  if p_from is distinct from (c.report_date::timestamp at time zone 'America/New_York') or
    p_until is distinct from ((c.report_date+1)::timestamp at time zone 'America/New_York') or
    p_until>clock_timestamp() then raise exception 'source report authority window'; end if;
  select coalesce(jsonb_agg(x.row order by x.subject_id),'[]'::jsonb) into grants from (
    select a.subject_id,jsonb_build_object('subjectId',a.subject_id,
      'validFrom',to_char(a.valid_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'expiresAt',to_char(a.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'revokedAt',to_char(a.revoked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'removed',exists(select 1 from lean_private.journey_removals m where m.token_hash=a.token_hash),
      'permissionEvidenceRef',a.permission_evidence_ref,'approvalRef',a.approval_ref) row
    from lean_private.journey_grants a where a.project_ref=g.project_ref and a.shop=g.shop and a.posthog_project=g.posthog_project
      and a.permission_evidence_ref like 'explicit-browser-choice:source-session-runtime-v3:%'
      and a.valid_from<p_until and a.expires_at>p_from order by a.subject_id limit 1001) x;
  receipts:=public.lean_source_session_receipts_read(p_from,p_until);
  -- Refuse the underlying sentinel before filtering a neighboring entry away.
  if jsonb_array_length(receipts)>=10001 then raise exception 'source report receipt source overflow'; end if;
  select coalesce(jsonb_agg(r order by r->>'nativeSessionId'),'[]'::jsonb) into receipts
    from jsonb_array_elements(receipts) r where (r->>'sourceStartedAt')::timestamptz>=p_from and
      (r->>'sourceStartedAt')::timestamptz<p_until;
  if jsonb_array_length(grants)>1000 or jsonb_array_length(receipts)>1000 then raise exception 'source report authority overflow'; end if;
  payload:=jsonb_build_object('from',to_char(p_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'until',to_char(p_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'authorityHistoryFrom',to_char(g.authority_history_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'configToken',g.source_policy->>'configToken','grants',grants,'receipts',receipts);
  return payload||jsonb_build_object('serverDigest',lean_private.partition_digest(payload),
    'capturedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end $$;

create function public.lean_source_session_report_authority(p_claim uuid,p_from timestamptz,p_until timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c lean_private.source_session_report_claims; a jsonb;
begin
  c:=lean_private.source_session_report_current(p_claim,false);
  if c.state<>'capture' or c.authority_reads>=2 or clock_timestamp()>=c.deadline
    then raise exception 'source report authority read consumed'; end if;
  a:=lean_private.source_session_report_population(p_claim,p_from,p_until);
  if octet_length(a::text)>2097152 then raise exception 'source report authority byte budget'; end if;
  update lean_private.source_session_report_claims set authority_reads=authority_reads+1,
    authority_before=case when c.authority_reads=0 then a else authority_before end,
    authority_after=case when c.authority_reads=1 then a else authority_after end where claim_id=c.claim_id;
  perform lean_private.source_session_report_current(c.claim_id,false);
  if clock_timestamp()>=c.deadline then raise exception 'source report authority read expired'; end if;
  return a;
end $$;

create function lean_private.source_session_report_cohort_finish(p_claim uuid,p_project text,p_token uuid,
  p_input_hash text,p_facts jsonb,p_reports jsonb,p_manifest jsonb) returns boolean
language plpgsql set search_path=pg_catalog as $$
declare c lean_private.source_session_report_claims; f lean_private.full_builds; input jsonb;
  hash text; pub text; t text; item jsonb; native jsonb; expected_count integer; stages text[]; columns text[];
  facts text[]:=array['customers','identity_map','orders','order_items','sales_ledger','payments','order_item_offers','sessions','marketing_spend_daily','order_attribution'];
  reports text[]:=array['store_daily','product_daily','acquisition_daily','customer_cohorts','funnel_daily'];
begin
  c:=lean_private.source_session_report_bound(p_claim,true);
  select * into strict f from lean_private.full_builds where run_id=c.run_id;
  if c.mode<>'entry_cohort' or f.project_ref<>p_project or not f.enabled then return false; end if;
  if jsonb_typeof(p_facts) is distinct from 'object' or jsonb_typeof(p_reports) is distinct from 'object' or
    jsonb_typeof(p_manifest) is distinct from 'object' or
    octet_length(p_facts::text)+octet_length(p_reports::text)+octet_length(p_manifest::text)>16000000 or
    not(p_facts ?& facts) or (select count(*) from jsonb_object_keys(p_facts))<>cardinality(facts) or
    not(p_reports ?& reports) or (select count(*) from jsonb_object_keys(p_reports))<>cardinality(reports)
    then raise exception 'source cohort output domains'; end if;
  foreach t in array facts loop
    if jsonb_typeof(p_facts->t) is distinct from 'array' or
      t<>'sessions' and p_facts->t<>'[]'::jsonb then raise exception 'cohort financial fact injection'; end if;
  end loop;
  foreach t in array reports loop
    if jsonb_typeof(p_reports->t) is distinct from 'array' or
      t<>'funnel_daily' and p_reports->t<>'[]'::jsonb then raise exception 'cohort financial report injection'; end if;
  end loop;
  hash:=md5(p_facts::text||p_reports::text||p_manifest::text);
  if f.completed_at is not null then
    if f.result_hash is distinct from hash then raise exception 'completed cohort immutable'; end if;
    return true;
  end if;
  if f.lease_token is distinct from p_token or f.lease_until is null or f.lease_until<=clock_timestamp() then return false; end if;
  -- Freeze the referenced immutable result while the final input token is checked.
  perform 1 from lean_private.publications where publication_id='observed:'||c.base_run for update;
  input:=public.lean_full_inputs(c.run_id,p_project);
  if input->>'state' is distinct from 'ready' or input->>'inputHash' is distinct from p_input_hash then return false; end if;
  pub:='full:'||c.run_id;
  if p_manifest->>'digest' !~ '^[a-f0-9]{64}$' or p_manifest->>'digest' is null or
    p_manifest->>'evidenceRef' is distinct from f.evidence->>'ref' or
    (select count(*) from jsonb_object_keys(p_manifest))<>5 or
    not(p_manifest ?& array['nativeEvents','logicalEvents','digest','evidenceRef','gates']) or
    p_manifest->'nativeEvents' is distinct from '0'::jsonb or p_manifest->'logicalEvents' is distinct from '0'::jsonb or
    p_manifest->'gates' is distinct from jsonb_build_array(jsonb_build_object('date',c.report_date,
      'gates','{"ledger":false,"cash":false,"orders":false,"purchase":false,"customers":false,"spend":false,"attribution":false,"behavior":false,"productAllocation":false}'::jsonb))
    then raise exception 'source cohort manifest scope'; end if;
  if jsonb_array_length(p_facts->'sessions')<>jsonb_array_length(c.packet#>'{derived,sessionEntries,entries}') or
    (select count(distinct x->>'source_session_id') from jsonb_array_elements(p_facts->'sessions') x)<>jsonb_array_length(p_facts->'sessions')
    then raise exception 'source cohort session membership'; end if;
  select array_agg(attname order by attname) into columns from pg_attribute
    where attrelid='lean_private.sessions'::regclass and attnum>0 and not attisdropped;
  for item in select value from jsonb_array_elements(p_facts->'sessions') loop
    select x into native from jsonb_array_elements(c.packet#>'{derived,sessionEntries,entries}') x
      where x->>'sourceSessionId'=item->>'source_session_id';
    if native is null or (select array_agg(k order by k) from jsonb_object_keys(item) k) is distinct from columns or
      item->>'publication_id' is distinct from pub or
      item->>'session_key' is distinct from lean_private.partition_digest(jsonb_build_array(f.policy->>'project',
        f.policy->>'sessionVersion',native->>'sourceSessionId')) or
      item->>'report_date' is distinct from c.report_date::text or
      (item->>'started_at')::timestamptz is distinct from (native->>'startedAt')::timestamptz or
      (item->>'ended_at')::timestamptz is distinct from (native->>'endedAt')::timestamptz or
      item->>'sessionization_version' is distinct from f.policy->>'sessionVersion' or
      item->>'funnel_version' is distinct from f.policy->>'funnelVersion' or
      item->'customer_id' is distinct from 'null'::jsonb or item->>'identity_status' is distinct from 'anonymous' or
      item->'analytics_eligible' is distinct from 'true'::jsonb or item->'behavior_complete' is distinct from 'false'::jsonb or
      item->'conversion_window_complete' is distinct from 'false'::jsonb or
      item->'converted_session' is distinct from 'null'::jsonb or item->'eligible_event_count' is distinct from 'null'::jsonb or
      item->'campaign_id' is distinct from 'null'::jsonb or item->'traffic_source' is distinct from 'null'::jsonb or
      exists(select 1 from unnest(array['entry_page','utm_source','utm_medium','utm_campaign','device_type','observed_geo']) k
        where item->k is distinct from 'null'::jsonb) or
      exists(select 1 from jsonb_each(item->'funnel_flags') v where v.value<>'null'::jsonb)
      then raise exception 'source cohort session scope'; end if;
  end loop;
  select array_prepend('all_sessions',coalesce(array_agg(k order by k),'{}')) into stages from jsonb_object_keys(f.policy->'stages') k;
  if jsonb_array_length(p_reports->'funnel_daily')<>cardinality(stages) or
    (select count(distinct x->>'stage_id') from jsonb_array_elements(p_reports->'funnel_daily') x)<>cardinality(stages)
    then raise exception 'source cohort funnel membership'; end if;
  expected_count:=case when c.packet#>'{derived,sessionEntries,complete}'='true'::jsonb
    then jsonb_array_length(c.packet#>'{derived,sessionEntries,entries}') else null end;
  select array_agg(attname order by attname) into columns from pg_attribute
    where attrelid='lean_private.report_funnel_daily'::regclass and attnum>0 and not attisdropped;
  for item in select value from jsonb_array_elements(p_reports->'funnel_daily') loop
    if (select array_agg(k order by k) from jsonb_object_keys(item) k) is distinct from columns or
      item->>'publication_id' is distinct from pub or item->>'shop_id' is distinct from input->>'shop' or
      item->>'definition_version' is distinct from f.policy->>'definition' or item->>'report_date' is distinct from c.report_date::text or
      item->>'funnel_version' is distinct from f.policy->>'funnelVersion' or not(item->>'stage_id'=any(stages)) or
      item->'is_stale' is distinct from 'true'::jsonb or jsonb_typeof(item->'readiness') is distinct from 'object' or
      exists(select 1 from jsonb_each_text(item->'readiness') v where v.value not in ('withheld','observed_unverified')) or
      item->'mature_sessions' is distinct from 'null'::jsonb or item->'converted_sessions' is distinct from 'null'::jsonb or
      item->'session_conversion_rate' is distinct from 'null'::jsonb or
      item->'measured_sessions' is distinct from coalesce(to_jsonb(case when item->>'stage_id'='all_sessions' then expected_count end),'null'::jsonb) or
      item->'stage_reached_sessions' is distinct from coalesce(to_jsonb(case when item->>'stage_id'='all_sessions' then expected_count end),'null'::jsonb)
      then raise exception 'source cohort funnel scope'; end if;
  end loop;
  insert into lean_private.publications(publication_id,contract_version) values(pub,'lean-v1-draft.1');
  insert into lean_private.sessions select * from jsonb_populate_recordset(null::lean_private.sessions,p_facts->'sessions');
  insert into lean_private.report_funnel_daily select * from jsonb_populate_recordset(null::lean_private.report_funnel_daily,p_reports->'funnel_daily');
  update lean_private.full_builds set completed_at=clock_timestamp(),result_hash=hash,manifest=p_manifest,
    lease_token=null,lease_until=null where run_id=c.run_id;
  perform lean_private.source_session_report_bound(c.claim_id,true);
  if f.lease_until<=clock_timestamp() then raise exception 'source cohort lease expired during write'; end if;
  return true;
end $$;

alter function public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb) rename to lean_full_finish_before_source_session_report;
create function public.lean_full_finish(p_run text,p_project_ref text,p_token uuid,p_input_hash text,
  p_facts jsonb,p_reports jsonb,p_manifest jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare c lean_private.source_session_report_claims; done boolean;
begin
  select * into c from lean_private.source_session_report_claims where run_id=p_run;
  if not found then return public.lean_full_finish_before_source_session_report(p_run,p_project_ref,p_token,p_input_hash,p_facts,p_reports,p_manifest); end if;
  if not exists(select 1 from lean_private.full_builds where run_id=p_run and project_ref=p_project_ref) then return false; end if;
  c:=lean_private.source_session_report_bound(c.claim_id,true);
  if c.mode='entry_cohort' then
    done:=lean_private.source_session_report_cohort_finish(c.claim_id,p_project_ref,p_token,p_input_hash,p_facts,p_reports,p_manifest);
  else
    done:=public.lean_full_finish_before_source_session_report(p_run,p_project_ref,p_token,p_input_hash,p_facts,p_reports,p_manifest);
  end if;
  if done then perform lean_private.source_session_report_bound(c.claim_id,true); end if;
  return done;
end $$;

-- Private aliases and helpers cannot bypass the new front-door fence. Restore
-- the two existing public ACLs exactly rather than broadening their callers.
do $acl$
declare x record; entry record; g record;
begin
  for x in select p.oid::regprocedure signature,a.grantee from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where
    ((n.nspname='public' and (p.proname like 'lean_source_session_report_%' or p.proname like '%before_source_session_report' or
      p.proname in ('lean_full_inputs','lean_full_finish'))) or
     (n.nspname='lean_private' and p.proname like 'source_session_report_%')) and a.grantee<>p.proowner loop
    execute format('revoke all on function %s from %s',x.signature,case when x.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(x.grantee)) end);
  end loop;
  for entry in select * from jsonb_each(current_setting('lean.source_session_report_prior_acl')::jsonb) loop
    for g in select * from jsonb_to_recordset(entry.value) as a(grantee oid,grantor oid,grantable boolean) loop
      if g.grantor<>current_user::regrole::oid then raise exception 'source report ACL grantor'; end if;
      execute format('grant execute on function %s to %s%s',entry.key,case when g.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(g.grantee)) end,
        case when g.grantable then ' with grant option' else '' end);
    end loop;
  end loop;
end $acl$;
grant execute on function public.lean_source_session_report_claim(text,integer,uuid),
  public.lean_source_session_report_authority(uuid,timestamptz,timestamptz),
  public.lean_source_session_report_register(uuid,jsonb,jsonb,jsonb),
  public.lean_source_session_report_enable(uuid,text) to service_role;
commit;
