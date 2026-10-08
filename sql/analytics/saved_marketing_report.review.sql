-- Additive saved-source reporting only. No grants, captures, selection or source
-- enabled bits are changed. Parent installs in a provider-owned transaction.
begin;
create table lean_private.saved_marketing_delivery (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  source_id uuid,
  token_sha256 text check(token_sha256 ~ '^[a-f0-9]{64}$'),
  approval_ref text,
  not_before timestamptz,
  expires_at timestamptz,
  lookback_days integer not null default 1 check(lookback_days between 1 and 7),
  allow_disabled_meta boolean not null default false,
  include_observed_sales boolean not null default false,
  check(not enabled or (source_id is not null and token_sha256 is not null and
    coalesce(length(trim(approval_ref)),0) between 1 and 512 and
    not_before is not null and expires_at is not null and expires_at>not_before and
    expires_at-not_before<=interval '14 days' and allow_disabled_meta))
);
alter table lean_private.saved_marketing_delivery enable row level security;
insert into lean_private.saved_marketing_delivery(singleton) values(true);
revoke all on lean_private.saved_marketing_delivery from public,anon,authenticated,service_role;

create function public.lean_saved_marketing_read(p_token_sha256 text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare s lean_private.saved_marketing_delivery; d date; g lean_private.google_auto_cycles;
  m lean_private.marketing_spend_days; days jsonb:='[]'; observed jsonb:=null; result jsonb;
begin
  -- One statement snapshot binds authority, original packets and current observed
  -- privacy checks. No live-cycle getter or producer capability is consulted.
  select * into s from lean_private.saved_marketing_delivery where singleton and enabled
    and token_sha256=p_token_sha256 and not_before<=statement_timestamp() and expires_at>statement_timestamp();
  if not found or not s.allow_disabled_meta then return null; end if;
  for d in select ((statement_timestamp() at time zone 'America/New_York')::date-n)::date
    from generate_series(s.lookback_days,1,-1) n
  loop
    select c.* into g from lean_private.google_auto_cycles c
      where c.report_date=d and c.state='accepted' and c.accepted_at is not null
        and c.capture_packet#>>'{manifest,projectRef}'='xnfjdbpjuaezxjgargto'
        and c.capture_packet#>>'{base,accountId}'='4335795219'
      order by c.committed_at desc nulls last,c.cycle_id desc limit 1;
    if found and (g.capture_packet is null or
      encode(sha256(convert_to(g.capture_packet::text,'UTF8')),'hex') is distinct from g.capture_sha256)
      then raise exception 'saved marketing google hash'; end if;
    select * into m from lean_private.marketing_spend_days
      where project_ref='xnfjdbpjuaezxjgargto' and shop='mullybox-store.myshopify.com'
        and account_id='act_2796962933960445' and report_date=d
        and generation_id ~ '^meta_ingest_([a-f0-9-]{36}|daily_[0-9]{4}-[0-9]{2}-[0-9]{2})$'
      order by (packet#>>'{source,capturedAt}')::timestamptz desc,generation_id desc limit 1;
    if found and (m.packet->>'generationId' is distinct from m.generation_id or
      m.packet->>'accountId' is distinct from m.account_id or m.packet->>'date' is distinct from d::text or
      m.packet->>'projectRef' is distinct from m.project_ref or m.packet->>'shop' is distinct from m.shop or
      encode(sha256(convert_to(m.packet::text,'UTF8')),'hex') is distinct from m.packet_hash)
      then raise exception 'saved marketing meta hash'; end if;
    days:=days||jsonb_build_array(jsonb_build_object('date',d::text,
      'google',g.capture_packet,'google_sha256',g.capture_sha256,'meta',m.packet,'meta_sha256',m.packet_hash));
  end loop;
  if s.include_observed_sales then
    -- Delegate the current function, including installed privacy wrappers.
    -- Do not read the Google full-build's unrelated historical commerce base.
    observed:=public.lean_production_reports_read();
  end if;
  result:=jsonb_build_object('scope',jsonb_build_object('source_id',s.source_id::text,
    'audience','posthog:353503:source:'||s.source_id::text,'project_ref','xnfjdbpjuaezxjgargto',
    'shop','mullybox-store.myshopify.com',
    'not_before',to_char(s.not_before at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'expires_at',to_char(s.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'lookback_days',s.lookback_days,'include_observed_sales',s.include_observed_sales),
    'days',days,'observed',observed);
  if octet_length(result::text)>8388608 then raise exception 'saved marketing byte budget'; end if;
  return result;
end $$;
revoke all on function public.lean_saved_marketing_read(text) from public,anon,authenticated,service_role;
do $acl$
begin
  if exists(select 1 from pg_roles where rolname='lean_posthog_reader') then
    revoke all on lean_private.saved_marketing_delivery from lean_posthog_reader;
    revoke all on function public.lean_saved_marketing_read(text) from lean_posthog_reader;
  end if;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.oid='public.lean_saved_marketing_read(text)'::regprocedure and a.grantee<>p.proowner) or
    exists(select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
      where c.oid='lean_private.saved_marketing_delivery'::regclass and a.grantee<>c.relowner)
    then raise exception 'saved marketing unexpected ACL'; end if;
end $acl$;
grant execute on function public.lean_saved_marketing_read(text) to service_role;
commit;
