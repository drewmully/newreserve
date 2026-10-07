-- PRIVATE successor to installed P6. Adds one owner-only, default-off registrar.
-- No current input/finish replacement, old registrar edit, activation or grants.
-- Execution requires fresh exact dependency pins; no real pins are provided here.
begin;
set local search_path=pg_catalog;
set local lock_timeout='3s';
set local statement_timeout='20s';
set local idle_in_transaction_session_timeout='30s';
do $contract$
declare pins jsonb; pin jsonb; f record; actual_count integer;
begin
  pins:=nullif(current_setting('lean.meta_hourly_install_contract',true),'')::jsonb;
  if current_user<>'postgres' or session_user<>'postgres' or
    current_setting('transaction_isolation')<>'read committed' or
    current_setting('transaction_read_only')<>'off' or
    jsonb_typeof(pins) is distinct from 'array' or jsonb_array_length(pins)<8 or
    to_regprocedure('public.lean_marketing_spend_hourly_register(jsonb)') is not null or
    to_regclass('lean_private.marketing_spend_days') is null or
    to_regclass('lean_private.marketing_spend_bindings') is null
    then raise exception 'UNBOUND hourly marketing dependency'; end if;
  select count(*) into actual_count from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and (p.proname like 'lean_full_inputs%' or
      p.proname like 'lean_full_finish%' or p.proname in ('lean_google_delivery_finish',
      'lean_marketing_spend_day_register','lean_marketing_spend_bind'))) or
      (n.nspname='lean_private' and p.proname='marketing_spend_immutable');
  if actual_count<>jsonb_array_length(pins) or
    (select count(distinct x->>'signature') from jsonb_array_elements(pins) x)<>actual_count or
    not exists(select 1 from jsonb_array_elements(pins) x
      where x->>'signature'='public.lean_full_inputs_before_marketing(text,text)') or
    not exists(select 1 from jsonb_array_elements(pins) x
      where x->>'signature'='public.lean_marketing_spend_day_register(jsonb)') or
    not exists(select 1 from jsonb_array_elements(pins) x
      where x->>'signature'='lean_private.marketing_spend_immutable()')
    then raise exception 'incomplete hourly dependency pins'; end if;
  for pin in select value from jsonb_array_elements(pins) loop
    select p.*,n.nspname into f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where p.oid=to_regprocedure(pin->>'signature');
    if not found or not((f.nspname='public' and (f.proname like 'lean_full_inputs%' or
      f.proname like 'lean_full_finish%' or f.proname in ('lean_google_delivery_finish',
      'lean_marketing_spend_day_register','lean_marketing_spend_bind'))) or
      (f.nspname='lean_private' and f.proname='marketing_spend_immutable')) or
      f.oid::text is distinct from pin->>'oid' or f.proowner::text is distinct from pin->>'ownerOid' or
      f.proowner<>current_user::regrole::oid or
      f.proconfig is distinct from array['search_path=pg_catalog'] or
      encode(sha256(convert_to(pg_get_functiondef(f.oid),'UTF8')),'hex') is distinct from pin->>'definitionSha256' or
      encode(sha256(convert_to(coalesce(f.proacl::text,'null'),'UTF8')),'hex') is distinct from pin->>'aclSha256'
      then raise exception 'hourly dependency pin mismatch'; end if;
  end loop;
  if not exists(select 1 from pg_trigger where
    tgrelid='lean_private.marketing_spend_days'::regclass and tgname='marketing_day_immutable' and
    tgfoid='lean_private.marketing_spend_immutable()'::regprocedure and tgenabled='O' and not tgisinternal)
    then raise exception 'hourly immutable source boundary absent'; end if;
end $contract$;

create function public.lean_marketing_spend_hourly_register(p_packet jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $body$
declare from_at timestamptz; until_at timestamptz; query_since date; query_until date;
begin
  if jsonb_typeof(p_packet) is distinct from 'object' or
    not(p_packet ?& array['version','projectRef','shop','generationId','accountId','date','sourceCurrency',
      'sourceTimezone','approvalRef','actorRef','window','source','control']) or
    p_packet-array['version','projectRef','shop','generationId','accountId','date','sourceCurrency',
      'sourceTimezone','approvalRef','actorRef','window','source','control']<>'{}' or
    p_packet->'version' is distinct from '2'::jsonb or
    p_packet->>'sourceCurrency' is distinct from 'USD' or
    p_packet->>'sourceTimezone' is distinct from 'America/Los_Angeles' or
    p_packet#>>'{window,reportTimezone}' is distinct from 'America/New_York' or
    coalesce(length(trim(p_packet->>'approvalRef')),0)=0 or
    coalesce(length(trim(p_packet->>'actorRef')),0)=0 or
    p_packet#>'{source,complete}' is distinct from 'true'::jsonb or
    p_packet#>'{source,paginationComplete}' is distinct from 'true'::jsonb or
    p_packet#>'{control,complete}' is distinct from 'true'::jsonb or
    p_packet#>'{control,paginationComplete}' is distinct from 'true'::jsonb or
    p_packet#>'{control,independentlyExtracted}' is distinct from 'true'::jsonb or
    jsonb_typeof(p_packet#>'{source,rows}') is distinct from 'array' or
    jsonb_typeof(p_packet#>'{control,rows}') is distinct from 'array'
    then raise exception 'invalid hourly Meta registration'; end if;
  from_at:=(p_packet->>'date')::date::timestamp at time zone 'America/New_York';
  until_at:=((p_packet->>'date')::date+1)::timestamp at time zone 'America/New_York';
  query_since:=(from_at at time zone 'America/Los_Angeles')::date;
  query_until:=((until_at-interval '1 hour') at time zone 'America/Los_Angeles')::date;
  if until_at-from_at<>interval '24 hours' or
    ((query_until+1)::timestamp at time zone 'America/Los_Angeles')-
      (query_since::timestamp at time zone 'America/Los_Angeles')<>
      ((query_until-query_since+1)*interval '24 hours') or
    (p_packet#>>'{window,fromAt}')::timestamptz is distinct from from_at or
    (p_packet#>>'{window,untilAt}')::timestamptz is distinct from until_at or
    jsonb_array_length(p_packet#>'{source,rows}')>1000 or
    jsonb_array_length(p_packet#>'{control,rows}')>48
    then raise exception 'hourly window or row budget'; end if;
  if exists(select 1 from jsonb_each(p_packet) as section(name, value)
    where name in ('source','control') and (
      value#>>'{query,since}' is distinct from query_since::text or
      value#>>'{query,until}' is distinct from query_until::text or
      value#>'{query,timeIncrement}' is distinct from '1'::jsonb or
      value#>'{query,unfiltered}' is distinct from 'true'::jsonb or
      value#>>'{query,breakdown}' is distinct from 'hourly_stats_aggregated_by_advertiser_time_zone' or
      value#>>'{query,level}' is distinct from case when name='source' then 'campaign' else 'account' end or
      coalesce((value->>'capturedAt')::timestamptz<
        ((query_until+1)::timestamp at time zone 'America/Los_Angeles'),true)))
    then raise exception 'hourly native query coverage'; end if;
  -- Same immutable packet/hash and disabled-row lifecycle as installed P6.
  -- The existing current input reads both clocks and locks this exact row;
  -- current finish re-reads the same hash under those locks.
  insert into lean_private.marketing_spend_days(generation_id,project_ref,shop,account_id,report_date,packet,packet_hash)
    values(p_packet->>'generationId',p_packet->>'projectRef',p_packet->>'shop',p_packet->>'accountId',
      (p_packet->>'date')::date,p_packet,encode(sha256(convert_to(p_packet::text,'UTF8')),'hex'));
  return true;
end $body$;
revoke all on function public.lean_marketing_spend_hourly_register(jsonb) from public,anon,authenticated,service_role;
do $acl$
declare grant_row record;
begin
  for grant_row in select a.grantee from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid='public.lean_marketing_spend_hourly_register(jsonb)'::regprocedure and a.grantee<>p.proowner loop
    execute format('revoke all on function public.lean_marketing_spend_hourly_register(jsonb) from %s',
      case when grant_row.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(grant_row.grantee)) end);
  end loop;
end $acl$;
commit;
