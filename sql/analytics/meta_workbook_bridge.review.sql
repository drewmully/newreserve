-- PRIVATE DEFAULT-OFF owner bridge. No source call, grant row or activation.
-- Install after the reviewed source-session overlay, pinned to THEN-current code.
begin;
set local search_path=pg_catalog;
set local statement_timeout='20s';
set local lock_timeout='3s';
set local idle_in_transaction_session_timeout='30s';
do $pins$
declare pins jsonb:=nullif(current_setting('lean.meta_workbook_install_contract',true),'')::jsonb;
  pin jsonb; f record; expected integer;
begin
  if current_user<>'postgres' or session_user<>'postgres' or
    current_setting('transaction_isolation')<>'read committed' or current_setting('transaction_read_only')<>'off' or
    jsonb_typeof(pins) is distinct from 'array' or
    to_regclass('lean_private.meta_workbook_bridges') is not null or
    to_regprocedure('public.lean_full_inputs_before_meta_workbook(text,text)') is not null or
    to_regprocedure('public.lean_full_finish_before_meta_workbook(text,text,uuid,text,jsonb,jsonb,jsonb)') is not null or
    to_regprocedure('public.lean_full_inputs_before_source_session_report(text,text)') is null or
    to_regprocedure('public.lean_full_finish_before_source_session_report(text,text,uuid,text,jsonb,jsonb,jsonb)') is null
    then raise exception 'UNBOUND Meta workbook'; end if;
  if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc
      where oid='public.lean_full_inputs(text,text)'::regprocedure) is distinct from
      'd2ff2e56515ca8c5cc946fffd414333a5799a27d3fbf46d500b0b7df902abc71' or
    (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc
      where oid='public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb)'::regprocedure) is distinct from
      'ece2d7bdd9fcb0db287b879b77c41495e52e4305a1bfc312a0e8e1897d72a5d8'
    then raise exception 'Meta workbook requires exact B5 first'; end if;
  select count(*) into expected from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'lean_full_inputs%' or p.proname like 'lean_full_finish%' or
      p.proname in ('lean_google_auto_cycle_binding','lean_sales_event_window_register',
        'lean_marketing_spend_bind','lean_marketing_spend_hourly_register'));
  if expected<>jsonb_array_length(pins) or expected<6 or
    (select count(distinct x->>'signature') from jsonb_array_elements(pins) x)<>expected
    then raise exception 'Meta workbook incomplete current chain'; end if;
  for pin in select value from jsonb_array_elements(pins) loop
    select p.*,n.nspname into f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where p.oid=to_regprocedure(pin->>'signature');
    if not found or f.nspname<>'public' or
      not(f.proname like 'lean_full_inputs%' or f.proname like 'lean_full_finish%' or
        f.proname in ('lean_google_auto_cycle_binding','lean_sales_event_window_register',
          'lean_marketing_spend_bind','lean_marketing_spend_hourly_register')) or
      f.proowner<>current_user::regrole::oid or not f.prosecdef or
      f.proconfig is distinct from array['search_path=pg_catalog'] or
      f.oid::text is distinct from pin->>'oid' or f.proowner::text is distinct from pin->>'ownerOid' or
      encode(sha256(convert_to(pg_get_functiondef(f.oid),'UTF8')),'hex') is distinct from pin->>'definitionSha256' or
      encode(sha256(convert_to(coalesce(f.proacl::text,'null'),'UTF8')),'hex') is distinct from pin->>'aclSha256'
      then raise exception 'Meta workbook changed dependency'; end if;
  end loop;
  perform set_config('lean.meta_workbook_prior_acl',(
    select jsonb_object_agg(p.oid::regprocedure::text,(select jsonb_agg(jsonb_build_object(
      'grantee',a.grantee,'grantor',a.grantor,'grantable',a.is_grantable)
      order by a.grantee,a.grantor,a.is_grantable)
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.privilege_type='EXECUTE'))
    from pg_proc p where p.oid=any(array['public.lean_full_inputs(text,text)'::regprocedure::oid,
      'public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb)'::regprocedure::oid]))::text,true);
end $pins$;

create table lean_private.meta_workbook_bridges (
  run_id text primary key references lean_private.full_builds,
  base_run text not null unique references lean_private.report_builds,
  google_cycle uuid not null unique references lean_private.google_auto_cycles,
  meta_generation text not null unique references lean_private.marketing_spend_days,
  contract_id text not null unique, contract jsonb not null, contract_digest text not null,
  scope_digest text not null, spend_packet jsonb not null, spend_digest text not null,
  enabled boolean not null default false, revoked boolean not null default false,
  check(octet_length(contract::text)<=16384 and octet_length(spend_packet::text)<=5000000),
  check(contract_digest ~ '^[a-f0-9]{64}$' and scope_digest ~ '^[a-f0-9]{64}$' and spend_digest ~ '^[a-f0-9]{64}$')
);
alter table lean_private.meta_workbook_bridges enable row level security;
revoke all on lean_private.meta_workbook_bridges from public,anon,authenticated,service_role,lean_posthog_reader;
create function lean_private.meta_workbook_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' or
    (to_jsonb(old)-array['enabled','revoked']) is distinct from (to_jsonb(new)-array['enabled','revoked']) or
    old.revoked and not new.revoked then raise exception 'Meta workbook immutable'; end if;
  return new;
end $$;
create trigger meta_workbook_immutable before update or delete on lean_private.meta_workbook_bridges
for each row execute function lean_private.meta_workbook_immutable();

-- Owner-only compilation commit. P6 source registration is a preceding separate
-- create-only step with actual row readback; no receipt hash is invented here.
create function public.lean_meta_workbook_stage(p_contract jsonb,p_scope jsonb,p_spend jsonb) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare c jsonb:=p_contract; v jsonb; d lean_private.marketing_spend_days; b jsonb; r text;
  expiry timestamptz; began timestamptz; as_of timestamptz; inventory jsonb; source_time timestamptz;
begin
  if jsonb_typeof(c) is distinct from 'object' or
    not(c ?& array['version','contractId','revision','projectRef','shop','googleCycleId','googleCaptureSha256',
      'metaPacketSha256','runId','baseRunId','date','notBefore','expiresAt','maxAgeSeconds','approvalRef','actorRef','controlApprovalRef']) or
    c-array['version','contractId','revision','projectRef','shop','googleCycleId','googleCaptureSha256',
      'metaPacketSha256','runId','baseRunId','date','notBefore','expiresAt','maxAgeSeconds','approvalRef','actorRef','controlApprovalRef']<>'{}' or
    c->'version' is distinct from '1'::jsonb or c->>'revision' is distinct from '1' or
    coalesce(c->>'contractId','') !~ '^[A-Za-z0-9_-]{1,100}$' or
    c->>'projectRef' is distinct from 'xnfjdbpjuaezxjgargto' or c->>'shop' is distinct from 'mullybox-store.myshopify.com' or
    c->>'runId' is distinct from 'meta_workbook_'||(c->>'googleCycleId') or
    c->>'baseRunId' is distinct from 'meta_workbook_base_'||(c->>'googleCycleId') or
    exists(select 1 from unnest(array['approvalRef','actorRef','controlApprovalRef']) k
      where coalesce(length(trim(c->>k)),0) not between 1 and 512) or
    (c->>'maxAgeSeconds')::integer not between 1 and 3600
    then raise exception 'Meta workbook owner contract'; end if;
  v:=public.lean_google_auto_cycle_binding((c->>'googleCycleId')::uuid);
  began:=(c->>'notBefore')::timestamptz; expiry:=(c->>'expiresAt')::timestamptz;
  as_of:=(p_scope#>>'{fullPolicy,asOf}')::timestamptz;
  if not isfinite(began) or not isfinite(expiry) or not isfinite(as_of) or began is null or expiry is null or as_of is null or
    began<(v->>'startedAt')::timestamptz or as_of<began or as_of>clock_timestamp() or
    expiry<=as_of or expiry>began+interval '1 hour' or clock_timestamp()>=expiry or
    expiry>(v->>'validUntil')::timestamptz or as_of<(v#>>'{packet,asOf}')::timestamptz or
    v->>'projectRef' is distinct from c->>'projectRef' or v->>'shop' is distinct from c->>'shop' or
    v->>'date' is distinct from c->>'date' or v->>'accountId' is distinct from '4335795219' or
    v->>'loginCustomerId' is distinct from '9552995078' or v->>'captureSha256' is distinct from c->>'googleCaptureSha256' or
    exists(select 1 from lean_private.full_builds where run_id=c->>'runId') or
    exists(select 1 from lean_private.report_builds where run_id=c->>'baseRunId') or
    exists(select 1 from lean_private.sales_event_cycles where cycle_id=(c->>'googleCycleId')::uuid)
    then raise exception 'Meta workbook fresh separate target'; end if;
  select * into strict d from lean_private.marketing_spend_days
    where generation_id='meta_workbook_'||(c->>'googleCycleId') for share;
  if d.enabled or d.project_ref is distinct from c->>'projectRef' or d.shop is distinct from c->>'shop' or
    d.account_id<>'act_2796962933960445' or d.report_date::text is distinct from c->>'date' or
    d.packet_hash is distinct from c->>'metaPacketSha256' or d.packet is distinct from p_spend#>'{meta,packet}' or
    d.packet->'version' is distinct from '2'::jsonb or d.packet->>'approvalRef' is distinct from c->>'approvalRef' or
    d.packet->>'actorRef' is distinct from c->>'actorRef' or
    d.packet#>>'{control,approvalRef}' is distinct from c->>'controlApprovalRef' or
    coalesce((p_spend#>>'{meta,freshnessCutoffAt}')::timestamptz<began,true)
    then raise exception 'Meta workbook registered source'; end if;
  for source_time in select value::text::timestamptz from jsonb_array_elements_text(jsonb_build_array(
    v#>>'{packet,base,completedAt}',v#>>'{packet,costControl,capturedAt}',
    d.packet#>>'{source,capturedAt}',d.packet#>>'{control,capturedAt}')) loop
    if source_time is null or not isfinite(source_time) or source_time>as_of or
      expiry>source_time+make_interval(secs=>(c->>'maxAgeSeconds')::integer)
      then raise exception 'Meta workbook source expiry'; end if;
  end loop;
  if jsonb_typeof(p_spend#>'{meta,receipts}') is distinct from 'object' or
    not(p_spend#>'{meta,receipts}' ?& array['metadata','accountHours','campaignHours']) or
    (p_spend#>'{meta,receipts}')-array['metadata','accountHours','campaignHours']<>'{}' or
    exists(select 1 from jsonb_each(p_spend#>'{meta,receipts}') x where
      coalesce((x.value->>'startedAt')::timestamptz<began,true) or
      coalesce((x.value->>'finishedAt')::timestamptz<(x.value->>'startedAt')::timestamptz,true) or
      (x.value->>'finishedAt')::timestamptz>as_of or x.value->'status' is distinct from '200'::jsonb or
      coalesce(x.value->>'bodySha256','') !~ '^[a-f0-9]{64}$')
    then raise exception 'Meta workbook native receipts'; end if;
  b:=p_spend->'binding';
  if p_spend->'version' is distinct from '1'::jsonb or
    p_spend->>'digest' is distinct from lean_private.partition_digest(p_spend-'digest') or
    b is distinct from jsonb_build_object('version',1,'cycleId',c->>'googleCycleId','grantId',c->>'contractId',
      'grantRevision','1','projectRef',c->>'projectRef','shop',c->>'shop','runId',c->>'runId','date',c->>'date',
      'standingScopeDigest',lean_private.partition_digest(p_spend->'scopeDefinition'),
      'googleCaptureSha256',c->>'googleCaptureSha256','metaPacketSha256',c->>'metaPacketSha256') or
    (p_spend->>'cycleStartedAt')::timestamptz is distinct from (v->>'startedAt')::timestamptz or
    (p_spend->>'validUntil')::timestamptz is distinct from expiry or
    p_spend->'google' is distinct from jsonb_build_object('manifest',v#>'{packet,manifest}','base',v#>'{packet,base}',
      'control',v#>'{packet,costControl}','accountMetadata',v#>'{packet,receipt,accountMetadata}')
    then raise exception 'Meta workbook actual Google source binding'; end if;
  inventory:=p_scope#>'{fullPolicy,freshGoogleSpend,marketingInventory}';
  if p_scope->>'runId' is distinct from c->>'runId' or p_scope->>'baseRunId' is distinct from c->>'baseRunId' or
    p_scope->>'projectRef' is distinct from c->>'projectRef' or p_scope->>'shop' is distinct from c->>'shop' or
    p_scope->>'fromDate' is distinct from c->>'date' or p_scope->>'throughDate' is distinct from c->>'date' or
    (p_scope->>'oldestCaptureAt')::timestamptz<began or
    (p_scope->'fullPolicy') ?| array['nativeSpendWindow','sourceSessionReport','googleDelivery'] or
    (p_scope->'evidence') ?| array['nativeSpendWindow','sourceSessionReport'] or
    p_scope#>'{authority}' is distinct from jsonb_build_object('approvalRef',c->>'approvalRef','actorRef',c->>'actorRef',
      'readyAt',p_scope#>>'{fullPolicy,asOf}','expiresAt',c->>'expiresAt','maxAgeSeconds',c->'maxAgeSeconds') or
    p_scope#>'{fullPolicy,freshGoogleSpend,manifest}' is distinct from v#>'{packet,manifest}' or
    p_scope#>'{fullPolicy,freshGoogleSpend,controls}' is distinct from jsonb_build_array(v#>'{packet,costControl}') or
    inventory->'complete' is distinct from 'false'::jsonb or inventory->'independentlyExtracted' is distinct from 'false'::jsonb or
    inventory->>'capturedAt' is distinct from p_spend#>>'{scopeDefinition,declaredAt}' or
    inventory->>'approvalRef' is distinct from p_spend#>>'{scopeDefinition,approvalRef}'
    then raise exception 'Meta workbook B1 and declaration binding'; end if;
  r:=public.lean_sales_event_window_register(p_scope);
  if r is distinct from c->>'runId' then raise exception 'Meta workbook stage changed'; end if;
  perform public.lean_marketing_spend_bind(r,c->>'projectRef',array[d.generation_id],inventory,c->>'approvalRef',c->>'actorRef');
  insert into lean_private.meta_workbook_bridges(run_id,base_run,google_cycle,meta_generation,contract_id,
    contract,contract_digest,scope_digest,spend_packet,spend_digest)
    values(r,c->>'baseRunId',(c->>'googleCycleId')::uuid,d.generation_id,c->>'contractId',c,
      lean_private.partition_digest(c),lean_private.partition_digest(p_scope),p_spend,p_spend->>'digest');
  if clock_timestamp()>=expiry then raise exception 'Meta workbook stage expired'; end if;
  return r;
end $$;

-- Same owner-only evidence path, retained through input and finish. The source
-- getter rechecks the actual Google grant without modifying it or its cycle.
create function lean_private.meta_workbook_current(p_run text,p_project text,p_enabled boolean,p_write boolean default false)
returns lean_private.meta_workbook_bridges language plpgsql set search_path=pg_catalog as $$
declare r lean_private.meta_workbook_bridges; v jsonb; d lean_private.marketing_spend_days;
begin
  select * into strict r from lean_private.meta_workbook_bridges where run_id=p_run;
  v:=public.lean_google_auto_cycle_binding(r.google_cycle);
  if p_write then
    select * into strict r from lean_private.meta_workbook_bridges where run_id=p_run for update;
  else
    select * into strict r from lean_private.meta_workbook_bridges where run_id=p_run for share;
  end if;
  if r.revoked or p_enabled and not r.enabled or r.contract->>'projectRef' is distinct from p_project or
    r.contract_digest<>lean_private.partition_digest(r.contract) or r.spend_digest<>lean_private.partition_digest(r.spend_packet-'digest') or
    clock_timestamp()<(r.contract->>'notBefore')::timestamptz or
    clock_timestamp()>=(r.contract->>'expiresAt')::timestamptz or
    v->>'captureSha256' is distinct from r.contract->>'googleCaptureSha256' or
    (r.contract->>'expiresAt')::timestamptz>(v->>'validUntil')::timestamptz
    then raise exception 'Meta workbook unavailable'; end if;
  if p_write then
    select * into strict d from lean_private.marketing_spend_days where generation_id=r.meta_generation for update;
  else
    select * into strict d from lean_private.marketing_spend_days where generation_id=r.meta_generation for share;
  end if;
  if d.packet_hash is distinct from r.contract->>'metaPacketSha256' or d.packet is distinct from r.spend_packet#>'{meta,packet}' or
    p_enabled and not d.enabled then raise exception 'Meta workbook source changed'; end if;
  -- The delegated event-window guard takes UPDATE too, including read paths.
  -- Acquire it directly rather than introducing a SHARE -> UPDATE upgrade.
  perform 1 from lean_private.sales_event_window_inputs
    where run_id=r.run_id and base_run=r.base_run and payload_hash=r.scope_digest and (not p_enabled or enabled) for update;
  if not found then raise exception 'Meta workbook B1 binding changed'; end if;
  return r;
end $$;

-- Explicit later owner operation only. No service-role execution grant.
create function public.lean_meta_workbook_enable(p_run text,p_contract_digest text,p_scope_digest text,p_spend_digest text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.meta_workbook_bridges;
begin
  -- Write locks from the outset avoid a shared-to-exclusive upgrade between
  -- concurrent enables. Preserve event-input -> base -> full lock order.
  r:=lean_private.meta_workbook_current(p_run,'xnfjdbpjuaezxjgargto',false,true);
  if r.enabled or r.contract_digest is distinct from p_contract_digest or r.scope_digest is distinct from p_scope_digest or
    r.spend_digest is distinct from p_spend_digest then raise exception 'Meta workbook enable pins'; end if;
  perform 1 from lean_private.report_builds where run_id=r.base_run for update;
  perform 1 from lean_private.full_builds where run_id=p_run for update;
  if not exists(select 1 from lean_private.full_builds where run_id=p_run and not enabled and attempts=0 and completed_at is null) or
    not exists(select 1 from lean_private.report_builds where run_id=r.base_run and not enabled and completed_at is null) or
    not exists(select 1 from lean_private.marketing_spend_bindings where run_id=p_run and not enabled)
    then raise exception 'Meta workbook target changed'; end if;
  update lean_private.marketing_spend_days set enabled=true where generation_id=r.meta_generation;
  update lean_private.marketing_spend_bindings set enabled=true where run_id=p_run;
  update lean_private.sales_event_window_inputs set enabled=true where run_id=p_run;
  update lean_private.report_builds set enabled=true where run_id=r.base_run;
  update lean_private.full_builds set enabled=true where run_id=p_run;
  update lean_private.meta_workbook_bridges set enabled=true where run_id=p_run;
  perform lean_private.meta_workbook_current(p_run,'xnfjdbpjuaezxjgargto',true);
  return true;
end $$;

alter function public.lean_full_inputs(text,text) rename to lean_full_inputs_before_meta_workbook;
create function public.lean_full_inputs(p_run text,p_project_ref text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.meta_workbook_bridges; input jsonb;
begin
  if exists(select 1 from lean_private.meta_workbook_bridges where run_id=p_run) then
    r:=lean_private.meta_workbook_current(p_run,p_project_ref,true);
  end if;
  input:=public.lean_full_inputs_before_meta_workbook(p_run,p_project_ref);
  if r.run_id is not null and input->>'state'='ready' then
    if input ?| array['nativeSpendWindow','nativeSpendWindowBinding'] then raise exception 'Meta workbook duplicate domain'; end if;
    input:=(input-'inputHash')||jsonb_build_object('nativeSpendWindow',r.spend_packet,
      'nativeSpendWindowBinding',(r.spend_packet->'binding')||jsonb_build_object('digest',r.spend_digest));
    if octet_length(input::text)>16777216 then raise exception 'Meta workbook combined input budget'; end if;
    input:=input||jsonb_build_object('inputHash',md5(input::text));
  end if;
  if r.run_id is not null then perform lean_private.meta_workbook_current(p_run,p_project_ref,true); end if;
  return input;
end $$;
alter function public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb) rename to lean_full_finish_before_meta_workbook;
create function public.lean_full_finish(p_run text,p_project_ref text,p_token uuid,p_input_hash text,
  p_facts jsonb,p_reports jsonb,p_manifest jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare bound boolean; done boolean;
begin
  bound:=exists(select 1 from lean_private.meta_workbook_bridges where run_id=p_run);
  if bound then perform lean_private.meta_workbook_current(p_run,p_project_ref,true); end if;
  done:=public.lean_full_finish_before_meta_workbook(p_run,p_project_ref,p_token,p_input_hash,p_facts,p_reports,p_manifest);
  if bound and done then perform lean_private.meta_workbook_current(p_run,p_project_ref,true); end if;
  return done;
end $$;
do $acl$
declare x record; e record; g record;
begin
  for x in select a.grantee from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    where c.oid='lean_private.meta_workbook_bridges'::regclass and a.grantee<>c.relowner loop
    execute format('revoke all on table lean_private.meta_workbook_bridges from %s',
      case when x.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(x.grantee)) end);
  end loop;
  for x in select p.oid::regprocedure signature,a.grantee from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner and
    ((n.nspname='public' and (p.proname like 'lean_meta_workbook_%' or p.proname like '%before_meta_workbook' or
      p.proname in ('lean_full_inputs','lean_full_finish'))) or
     (n.nspname='lean_private' and p.proname like 'meta_workbook_%')) loop
    execute format('revoke all on function %s from %s',x.signature,
      case when x.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(x.grantee)) end);
  end loop;
  for e in select * from jsonb_each(current_setting('lean.meta_workbook_prior_acl')::jsonb) loop
    for g in select * from jsonb_to_recordset(e.value) as a(grantee oid,grantor oid,grantable boolean) loop
      if g.grantor<>current_user::regrole::oid then raise exception 'Meta workbook ACL grantor'; end if;
      execute format('grant execute on function %s to %s%s',e.key,
        case when g.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(g.grantee)) end,
        case when g.grantable then ' with grant option' else '' end);
    end loop;
  end loop;
end $acl$;
commit;
