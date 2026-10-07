-- PRIVATE REVIEW ONLY. No source call, row registration or activation.
-- Requires the current full-input/finish chain including 053 and P3V2.
-- This component is UNBOUND unless an independently reviewed complete function
-- pin set is supplied in lean.marketing_install_contract. Not a hosted installer.
begin;
set local search_path=pg_catalog;
do $contract$
declare pins jsonb; pin jsonb; f record; actual_count integer;
begin
  pins:=nullif(current_setting('lean.marketing_install_contract',true),'')::jsonb;
  if jsonb_typeof(pins) is distinct from 'array' or jsonb_array_length(pins)<5 or
    exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('lean_full_inputs_before_marketing',
        'lean_marketing_spend_day_register','lean_marketing_spend_bind')) or
    to_regclass('lean_private.marketing_spend_days') is not null or
    to_regclass('lean_private.marketing_spend_bindings') is not null then
    raise exception 'UNBOUND or existing marketing component';
  end if;
  select count(*) into actual_count from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and
      (p.proname like 'lean_full_inputs%' or p.proname like 'lean_full_finish%' or
       p.proname='lean_google_delivery_finish');
  if actual_count<>jsonb_array_length(pins) or
    (select count(distinct x->>'signature') from jsonb_array_elements(pins) x)<>actual_count or
    not exists(select 1 from jsonb_array_elements(pins) x where x->>'signature'='public.lean_full_inputs(text,text)') or
    not exists(select 1 from jsonb_array_elements(pins) x where x->>'signature'='public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb)') or
    not exists(select 1 from jsonb_array_elements(pins) x where x->>'signature'='public.lean_full_finish_021(text,text,uuid,text,jsonb,jsonb,jsonb)') or
    not exists(select 1 from jsonb_array_elements(pins) x where x->>'signature'='public.lean_google_delivery_finish(text,text,uuid,text,jsonb,jsonb,jsonb,jsonb)')
    then raise exception 'incomplete current full call-chain pins'; end if;
  for pin in select value from jsonb_array_elements(pins) loop
    select p.*,n.nspname into f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where p.oid=to_regprocedure(pin->>'signature');
    if not found or f.nspname<>'public' or
      not(f.proname like 'lean_full_inputs%' or f.proname like 'lean_full_finish%' or f.proname='lean_google_delivery_finish') or
      f.oid::text is distinct from pin->>'oid' or f.proowner::text is distinct from pin->>'ownerOid' or
      f.proowner<>current_user::regrole::oid or not f.prosecdef or f.proconfig is distinct from array['search_path=pg_catalog'] or
      encode(sha256(convert_to(pg_get_functiondef(f.oid),'UTF8')),'hex') is distinct from pin->>'definitionSha256' or
      encode(sha256(convert_to(coalesce(f.proacl::text,'null'),'UTF8')),'hex') is distinct from pin->>'aclSha256'
      then raise exception 'current full call-chain pin mismatch'; end if;
  end loop;
  -- Capture only the original input grants for restoration after replacement.
  perform set_config('lean.marketing_input_acl',(
    select jsonb_agg(jsonb_build_object('grantee',a.grantee,'grantor',a.grantor,'grantable',a.is_grantable)
      order by a.grantee,a.grantor,a.is_grantable)::text
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid='public.lean_full_inputs(text,text)'::regprocedure and a.privilege_type='EXECUTE'),true);
end $contract$;

create table lean_private.marketing_spend_days (
  generation_id text primary key check(generation_id ~ '^[A-Za-z0-9:_-]{1,128}$'),
  project_ref text not null check(project_ref ~ '^[a-z]{20}$'),
  shop text not null,
  account_id text not null check(account_id ~ '^act_[1-9][0-9]*$'),
  report_date date not null,
  packet jsonb not null check(jsonb_typeof(packet)='object' and octet_length(packet::text)<=1000000),
  packet_hash text not null check(packet_hash=encode(sha256(convert_to(packet::text,'UTF8')),'hex')),
  enabled boolean not null default false
);
create table lean_private.marketing_spend_bindings (
  run_id text primary key references lean_private.full_builds,
  project_ref text not null,
  registrations jsonb not null check(jsonb_typeof(registrations)='array' and jsonb_array_length(registrations) between 1 and 49),
  inventory jsonb not null check(jsonb_typeof(inventory)='object' and octet_length(inventory::text)<=64000),
  approval_ref text not null check(length(trim(approval_ref))>0),
  actor_ref text not null check(length(trim(actor_ref))>0),
  enabled boolean not null default false
);
alter table lean_private.marketing_spend_days enable row level security;
alter table lean_private.marketing_spend_bindings enable row level security;
revoke all on lean_private.marketing_spend_days,lean_private.marketing_spend_bindings from public,anon,authenticated,service_role;
create function lean_private.marketing_spend_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' or (to_jsonb(old)-'enabled') is distinct from (to_jsonb(new)-'enabled')
    then raise exception 'marketing source/control/binding immutable'; end if;
  return new;
end $$;
create trigger marketing_day_immutable before update or delete on lean_private.marketing_spend_days
for each row execute function lean_private.marketing_spend_immutable();
create trigger marketing_binding_immutable before update or delete on lean_private.marketing_spend_bindings
for each row execute function lean_private.marketing_spend_immutable();

create function public.lean_marketing_spend_day_register(p_packet jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if jsonb_typeof(p_packet) is distinct from 'object' or
    not(p_packet ?& array['version','projectRef','shop','generationId','accountId','date','sourceCurrency',
      'sourceTimezone','approvalRef','actorRef','source','control']) or
    p_packet-array['version','projectRef','shop','generationId','accountId','date','sourceCurrency',
      'sourceTimezone','approvalRef','actorRef','source','control']<>'{}' or
    p_packet->'version' is distinct from '1'::jsonb or p_packet->>'sourceCurrency' is distinct from 'USD' or
    p_packet->>'sourceTimezone' is distinct from 'America/New_York' or
    coalesce(length(trim(p_packet->>'approvalRef')),0)=0 or coalesce(length(trim(p_packet->>'actorRef')),0)=0 or
    p_packet#>'{source,complete}' is distinct from 'true'::jsonb or
    p_packet#>'{source,paginationComplete}' is distinct from 'true'::jsonb or
    p_packet#>'{control,complete}' is distinct from 'true'::jsonb or
    p_packet#>'{control,independentlyExtracted}' is distinct from 'true'::jsonb or
    jsonb_typeof(p_packet#>'{source,rows}') is distinct from 'array' or
    jsonb_typeof(p_packet#>'{control,campaigns}') is distinct from 'array'
    then raise exception 'invalid Meta source/control registration'; end if;
  if jsonb_array_length(p_packet#>'{source,rows}')>1000 or
    jsonb_array_length(p_packet#>'{control,campaigns}')>1000 then raise exception 'Meta registration budget'; end if;
  insert into lean_private.marketing_spend_days(generation_id,project_ref,shop,account_id,report_date,packet,packet_hash)
    values(p_packet->>'generationId',p_packet->>'projectRef',p_packet->>'shop',p_packet->>'accountId',
      (p_packet->>'date')::date,p_packet,encode(sha256(convert_to(p_packet::text,'UTF8')),'hex'));
  return true;
end $$;
create function public.lean_marketing_spend_bind(p_run text,p_project_ref text,p_generations text[],
  p_inventory jsonb,p_approval_ref text,p_actor_ref text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare f lean_private.full_builds; b lean_private.report_builds; d record; registrations jsonb:='[]';
begin
  select * into f from lean_private.full_builds where run_id=p_run and project_ref=p_project_ref for update;
  if not found or f.enabled or f.attempts<>0 or f.completed_at is not null or
    not(f.policy ? 'freshGoogleSpend') then raise exception 'marketing requires disabled fresh Google full target'; end if;
  select * into strict b from lean_private.report_builds where run_id=f.base_run and project_ref=p_project_ref for share;
  if coalesce(cardinality(p_generations),0) not between 1 and 49 or
    (select count(distinct x) from unnest(p_generations) x)<>cardinality(p_generations) or
    coalesce(length(trim(p_approval_ref)),0)=0 or coalesce(length(trim(p_actor_ref)),0)=0 or
    jsonb_typeof(p_inventory) is distinct from 'object' then raise exception 'marketing binding contract'; end if;
  for d in select * from lean_private.marketing_spend_days where generation_id=any(p_generations)
    order by generation_id for share loop
    if d.project_ref<>p_project_ref or d.shop<>b.shop or d.report_date not between b.from_date and b.through_date
      then raise exception 'marketing registration target mismatch'; end if;
    registrations:=registrations||jsonb_build_array(jsonb_build_object('generationId',d.generation_id,'packetHash',d.packet_hash));
  end loop;
  if jsonb_array_length(registrations)<>cardinality(p_generations) or
    exists(select 1 from lean_private.marketing_spend_days where generation_id=any(p_generations)
      group by account_id,report_date having count(*)<>1) or
    exists(select 1 from lean_private.marketing_spend_days where generation_id=any(p_generations)
      group by account_id having count(distinct report_date)<>b.through_date-b.from_date+1)
    then raise exception 'missing/conflicting marketing account day'; end if;
  insert into lean_private.marketing_spend_bindings(run_id,project_ref,registrations,inventory,approval_ref,actor_ref)
    values(p_run,p_project_ref,registrations,p_inventory,p_approval_ref,p_actor_ref);
  return true;
end $$;
revoke all on function lean_private.marketing_spend_immutable() from public,anon,authenticated,service_role;
revoke all on function public.lean_marketing_spend_day_register(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.lean_marketing_spend_bind(text,text,text[],jsonb,text,text) from public,anon,authenticated,service_role;

alter function public.lean_full_inputs(text,text) rename to lean_full_inputs_before_marketing;
revoke all on function public.lean_full_inputs_before_marketing(text,text) from public,anon,authenticated,service_role;
create function public.lean_full_inputs(p_run text,p_project_ref text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare input jsonb; binding lean_private.marketing_spend_bindings; r jsonb; d lean_private.marketing_spend_days;
  days jsonb:='[]'; manifest jsonb;
begin
  -- Original privacy/customer/053 chain executes unchanged, including its locks.
  input:=public.lean_full_inputs_before_marketing(p_run,p_project_ref);
  select * into binding from lean_private.marketing_spend_bindings where run_id=p_run for share;
  if not found then return input; end if;
  if current_setting('transaction_isolation')<>'read committed' or
    not binding.enabled or binding.project_ref<>p_project_ref then return jsonb_build_object('state','blocked'); end if;
  if input->>'state' is distinct from 'ready' then return input; end if;
  manifest:=input#>'{freshGoogleSpend,manifest}';
  if jsonb_typeof(manifest) is distinct from 'object' or
    coalesce((manifest->>'expiresAt')::timestamptz<=clock_timestamp(),true)
    then return jsonb_build_object('state','blocked'); end if;
  for r in select value from jsonb_array_elements(binding.registrations) order by value->>'generationId' loop
    select * into d from lean_private.marketing_spend_days where generation_id=r->>'generationId' for share;
    if not found or not d.enabled or d.project_ref<>p_project_ref or d.shop is distinct from input->>'shop' or
      d.packet_hash is distinct from r->>'packetHash' or
      d.report_date not between (input->>'fromDate')::date and (input->>'throughDate')::date or
      coalesce((d.packet#>>'{source,capturedAt}')::timestamptz<(manifest->>'freshnessCutoffAt')::timestamptz,true) or
      coalesce((d.packet#>>'{control,capturedAt}')::timestamptz<(manifest->>'freshnessCutoffAt')::timestamptz,true) or
      coalesce((d.packet#>>'{source,capturedAt}')::timestamptz>(input#>>'{policy,asOf}')::timestamptz,true) or
      coalesce((d.packet#>>'{control,capturedAt}')::timestamptz>(input#>>'{policy,asOf}')::timestamptz,true)
      then return jsonb_build_object('state','blocked'); end if;
    days:=days||jsonb_build_array(d.packet);
  end loop;
  input:=(input-'inputHash')||jsonb_build_object('multiProviderSpend',jsonb_build_object(
    'version',1,'projectRef',p_project_ref,'shop',input->>'shop','runId',p_run,
    'inventory',binding.inventory,'metaDays',days));
  if octet_length(input::text)>8000000 then raise exception 'marketing full input budget'; end if;
  return input||jsonb_build_object('inputHash',md5(input::text));
end $$;
do $acl$
declare g record; expected jsonb:=current_setting('lean.marketing_input_acl')::jsonb; actual jsonb; name text;
begin
  -- New private tables must not inherit a site-specific default table grant.
  for g in select c.oid::regclass relation,a.grantee from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    where c.oid=any(array['lean_private.marketing_spend_days'::regclass::oid,
      'lean_private.marketing_spend_bindings'::regclass::oid]) and a.grantee<>c.relowner loop
    execute format('revoke all on table %s from %s',g.relation,
      case when g.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(g.grantee)) end);
  end loop;
  -- Remove every default grant on the new functions, including unexpected roles.
  for g in select p.oid::regprocedure signature,a.grantee from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=any(array['public.lean_full_inputs(text,text)'::regprocedure::oid,
      'public.lean_full_inputs_before_marketing(text,text)'::regprocedure::oid,
      'public.lean_marketing_spend_day_register(jsonb)'::regprocedure::oid,
      'public.lean_marketing_spend_bind(text,text,text[],jsonb,text,text)'::regprocedure::oid,
      'lean_private.marketing_spend_immutable()'::regprocedure::oid]) and a.grantee<>p.proowner loop
    execute format('revoke all on function %s from %s',g.signature,
      case when g.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(g.grantee)) end);
  end loop;
  for g in select * from jsonb_to_recordset(expected) as x(grantee oid,grantor oid,grantable boolean) loop
    if g.grantor<>current_user::regrole::oid then raise exception 'input ACL grantor differs'; end if;
    execute format('grant execute on function public.lean_full_inputs(text,text) to %s%s',
      case when g.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(g.grantee)) end,
      case when g.grantable then ' with grant option' else '' end);
  end loop;
  select jsonb_agg(jsonb_build_object('grantee',a.grantee,'grantor',a.grantor,'grantable',a.is_grantable)
    order by a.grantee,a.grantor,a.is_grantable) into actual from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid='public.lean_full_inputs(text,text)'::regprocedure;
  if actual is distinct from expected then raise exception 'input ACL preservation failure'; end if;
  foreach name in array array['anon','authenticated','service_role','lean_posthog_reader'] loop
    if exists(select 1 from pg_roles where rolname=name) and
      has_function_privilege(name,'public.lean_full_inputs_before_marketing(text,text)','EXECUTE')
      then raise exception 'old input alias accessible to runtime role'; end if;
  end loop;
end $acl$;
commit;
