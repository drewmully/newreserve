-- PRIVATE ADDITIVE REVIEW. Capture only. No destination, registration or selection.
-- Required existing type/table: lean_private.google_auto_setups from installed B6.
-- No digest extension: sha256(bytea) is the PostgreSQL built-in.
begin;
do $$ begin
  if (select relowner from pg_class where oid='lean_private.google_auto_setups'::regclass)
    is distinct from current_user::regrole::oid then raise exception 'commission installer owner'; end if;
end $$;
create table lean_private.google_commissions (
  grant_id text primary key check(grant_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  revision bigint not null check(revision>0),
  enabled boolean not null default false, revoked boolean not null default false,
  setup_id text not null references lean_private.google_auto_setups,
  setup_revision bigint not null check(setup_revision>0),
  setup_receipt_sha256 text not null check(setup_receipt_sha256 ~ '^[a-f0-9]{64}$'),
  credential_sha256 text not null check(credential_sha256 ~ '^[a-f0-9]{64}$'),
  credential_binding_ref text not null check(length(trim(credential_binding_ref)) between 1 and 256),
  producer_sha256 text not null check(producer_sha256 ~ '^[a-f0-9]{64}$'),
  cycle_id uuid not null unique,
  account_id text not null check(account_id='4335795219'),
  login_customer_id text not null check(login_customer_id='9552995078'),
  report_date date not null check(isfinite(report_date)),
  not_before timestamptz not null, expires_at timestamptz not null,
  capture_seconds integer not null check(capture_seconds between 1 and 80),
  source_deadline_seconds integer not null check(source_deadline_seconds between 1 and 60),
  max_pages integer not null check(max_pages between 1 and 5),
  max_requests integer not null check(max_requests between 7 and 20 and max_requests>=5+2*max_pages),
  max_bytes integer not null check(max_bytes between 1 and 16777216),
  approval_ref text not null check(length(trim(approval_ref)) between 1 and 256),
  actor_ref text not null check(length(trim(actor_ref)) between 1 and 256),
  started_at timestamptz, deadline timestamptz, committed_at timestamptz,
  capture_packet jsonb, capture_sha256 text,
  check(isfinite(not_before) and isfinite(expires_at) and expires_at>not_before and
    expires_at-not_before<=interval '1 hour' and expires_at=date_trunc('milliseconds',expires_at)),
  check((started_at is null)=(deadline is null)),
  check((capture_packet is null)=(capture_sha256 is null) and (capture_packet is null)=(committed_at is null))
);
alter table lean_private.google_commissions enable row level security;
revoke all on lean_private.google_commissions from public,anon,authenticated,service_role,lean_posthog_reader;

create function lean_private.google_commission_guard() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare s lean_private.google_auto_setups;
begin
  if tg_op='DELETE' then raise exception 'commission audit immutable'; end if;
  if tg_op='INSERT' then
    if new.enabled or new.revoked or new.started_at is not null or new.deadline is not null or
      new.capture_packet is not null or new.capture_sha256 is not null or new.committed_at is not null
      then raise exception 'commission must register disabled and unattempted'; end if;
    select * into strict s from lean_private.google_auto_setups where setup_id=new.setup_id for share;
    if s.revision is distinct from new.setup_revision or not s.enabled or s.revoked or s.receipt is null or
      s.account_id is distinct from new.account_id or s.login_customer_id is distinct from new.login_customer_id or
      s.credential_binding_ref is distinct from new.credential_binding_ref or
      s.receipt->>'credentialSha256' is distinct from new.credential_sha256 or
      s.receipt->>'authMode' is distinct from 'service_account' or
      s.receipt->>'transport' is distinct from 'native_google_ads' or
      s.receipt->>'currency' is distinct from 'USD' or s.receipt->>'timezone' is distinct from 'America/New_York' or
      encode(sha256(convert_to(s.receipt::text,'UTF8')),'hex') is distinct from new.setup_receipt_sha256 or
      (s.receipt->>'capturedAt')::timestamptz>new.not_before or new.expires_at<=clock_timestamp()
      then raise exception 'commission setup proof mismatch'; end if;
  else
    if (to_jsonb(old)-array['enabled','revoked','started_at','deadline','capture_packet','capture_sha256','committed_at'])
      is distinct from
      (to_jsonb(new)-array['enabled','revoked','started_at','deadline','capture_packet','capture_sha256','committed_at']) or
      old.revoked and (not new.revoked or new.enabled) or
      not old.enabled and new.enabled and old.started_at is not null or
      old.started_at is not null and (new.started_at is distinct from old.started_at or new.deadline is distinct from old.deadline) or
      old.capture_packet is not null and (new.capture_packet is distinct from old.capture_packet or
        new.capture_sha256 is distinct from old.capture_sha256 or new.committed_at is distinct from old.committed_at)
      then raise exception 'commission immutable'; end if;
    new.revoked:=old.revoked or new.revoked or (old.enabled and not new.enabled);
  end if;
  return new;
end $$;
create trigger google_commission_guard before insert or update or delete on lean_private.google_commissions
  for each row execute function lean_private.google_commission_guard();

-- Lock order is commissioning grant UPDATE, then existing metadata setup SHARE.
-- Setup mutators never acquire a commissioning grant. No build/publication locks.
create function lean_private.google_commission_current(p_grant text,p_revision bigint,p_capability text)
returns lean_private.google_commissions language plpgsql set search_path=pg_catalog as $$
declare g lean_private.google_commissions; s lean_private.google_auto_setups;
begin
  select * into strict g from lean_private.google_commissions where grant_id=p_grant for update;
  select * into strict s from lean_private.google_auto_setups where setup_id=g.setup_id for share;
  if current_setting('transaction_isolation')<>'read committed' or not g.enabled or g.revoked or
    g.revision is distinct from p_revision or clock_timestamp()<g.not_before or clock_timestamp()>=g.expires_at or
    p_capability is null or length(p_capability) not between 32 and 512 or
    encode(sha256(convert_to(p_capability,'UTF8')),'hex') is distinct from g.producer_sha256 or
    not s.enabled or s.revoked or s.revision is distinct from g.setup_revision or s.receipt is null or
    encode(sha256(convert_to(s.receipt::text,'UTF8')),'hex') is distinct from g.setup_receipt_sha256
    then raise exception 'commission authority unavailable'; end if;
  return g;
end $$;

create function public.lean_google_commission_claim(p_grant text,p_revision bigint,p_capability text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare g lean_private.google_commissions; started timestamptz; until_at timestamptz;
begin
  g:=lean_private.google_commission_current(p_grant,p_revision,p_capability);
  started:=date_trunc('milliseconds',clock_timestamp());
  if g.started_at is not null or g.report_date>=(started at time zone 'America/New_York')::date
    then raise exception 'commission consumed or day not closed'; end if;
  until_at:=least(g.expires_at,started+make_interval(secs=>g.capture_seconds));
  update lean_private.google_commissions set started_at=started,deadline=until_at where grant_id=p_grant;
  perform lean_private.google_commission_current(p_grant,p_revision,p_capability);
  if clock_timestamp()>=until_at then raise exception 'commission claim deadline'; end if;
  return jsonb_build_object('state','capture','cycleId',g.cycle_id,'grantId',g.grant_id,'revision',g.revision::text,
    'projectRef','xnfjdbpjuaezxjgargto','shop','mullybox-store.myshopify.com','accountId',g.account_id,
    'loginCustomerId',g.login_customer_id,'date',g.report_date,
    'startedAt',to_char(started at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deadline',to_char(until_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt',to_char(g.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'maxPages',g.max_pages,'maxRequests',g.max_requests,'maxBytes',g.max_bytes,
    'sourceDeadlineSeconds',g.source_deadline_seconds,'approvalRef',g.approval_ref,'actorRef',g.actor_ref,
    'credentialBindingRef',g.credential_binding_ref,'credentialSha256',g.credential_sha256);
end $$;

create function public.lean_google_commission_commit(p_grant text,p_revision bigint,p_capability text,p_capture jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare g lean_private.google_commissions; m jsonb; b jsonb; r jsonb; c jsonb; d jsonb; digest text;
begin
  g:=lean_private.google_commission_current(p_grant,p_revision,p_capability);
  if g.started_at is null or g.capture_packet is not null or clock_timestamp()>=g.deadline
    then raise exception 'commission consumed or expired'; end if;
  if jsonb_typeof(p_capture) is distinct from 'object' or octet_length(p_capture::text)>8000000 or
    not(p_capture ?& array['manifest','spendRegistration','base','costControl','delivery','asOf','receipt']) or
    p_capture-array['manifest','spendRegistration','base','costControl','delivery','asOf','receipt']<>'{}' or
    exists(select 1 from jsonb_each(p_capture) where value='null'::jsonb)
    then raise exception 'commission packet shape'; end if;
  m:=p_capture->'manifest'; b:=p_capture->'base'; r:=p_capture->'receipt';
  c:=p_capture->'costControl'; d:=p_capture->'delivery';
  if jsonb_typeof(m) is distinct from 'object' or jsonb_typeof(b) is distinct from 'object' or
    jsonb_typeof(r) is distinct from 'object' or jsonb_typeof(c) is distinct from 'object' or
    jsonb_typeof(d) is distinct from 'object' or
    m->>'projectRef' is distinct from 'xnfjdbpjuaezxjgargto' or m->>'accountId' is distinct from g.account_id or
    m->>'loginCustomerId' is distinct from g.login_customer_id or m->>'revisionRef' is distinct from 'auto:'||g.cycle_id or
    m->>'credentialBindingRef' is distinct from g.credential_binding_ref or m->>'approvalRef' is distinct from g.approval_ref or
    m->>'actorRef' is distinct from g.actor_ref or m->>'sourceCurrency' is distinct from 'USD' or
    m->>'sourceTimezone' is distinct from 'America/New_York' or m->>'coverage' is distinct from 'whole_account_campaign_day' or
    (m->>'preparedAt')::timestamptz is distinct from g.started_at or
    (m->>'freshnessCutoffAt')::timestamptz is distinct from g.started_at or
    (m->>'expiresAt')::timestamptz is distinct from g.expires_at or
    m->'maxPages' is distinct from to_jsonb(g.max_pages) or
    m->'maxRequestsPerDay' is distinct from to_jsonb(2+g.max_pages) or
    m->'deadlineSeconds' is distinct from to_jsonb(g.source_deadline_seconds) or
    jsonb_typeof(m->'days') is distinct from 'array' or jsonb_array_length(m->'days')<>1 or
    m#>>'{days,0,date}' is distinct from g.report_date::text or
    (m#>>'{days,0,dueAt}')::timestamptz is distinct from g.started_at or
    b->>'baseReportId' is distinct from p_capture#>>'{spendRegistration,days,0,runId}' or
    b->>'evidenceRef' is distinct from 'lean_private.spend_jobs/'||(b->>'baseReportId') or
    b->>'provider' is distinct from 'google_ads' or b->>'accountId' is distinct from g.account_id or
    b->>'date' is distinct from g.report_date::text or b->>'sourceCurrency' is distinct from 'USD' or
    b->>'sourceTimezone' is distinct from 'America/New_York' or b->'paginationComplete' is distinct from 'true'::jsonb or
    b->'verifiedEmpty' is distinct from 'false'::jsonb or jsonb_typeof(b->'rows') is distinct from 'array' or
    jsonb_array_length(b->'rows') not between 1 and 10000
    then raise exception 'commission packet scope'; end if;
  if r->>'transport' is distinct from 'native_google_ads' or r->>'credentialBindingRef' is distinct from g.credential_binding_ref or
    coalesce(r->>'controlHash','') !~ '^[a-f0-9]{64}$' or coalesce(r->>'nativeHash','') !~ '^[a-f0-9]{64}$' or
    coalesce((r->>'requests')::integer not between 1 and g.max_requests,true) or
    coalesce((r->>'bytes')::integer not between 1 and g.max_bytes,true) or
    coalesce((r->>'controlStartedAt')::timestamptz<g.started_at,true) or
    coalesce((r->>'controlCompletedAt')::timestamptz<(r->>'controlStartedAt')::timestamptz,true) or
    coalesce((r->>'nativeStartedAt')::timestamptz<(r->>'controlCompletedAt')::timestamptz,true) or
    (r->>'nativeCompletedAt')::timestamptz is distinct from (p_capture->>'asOf')::timestamptz or
    (b->>'completedAt')::timestamptz is distinct from (p_capture->>'asOf')::timestamptz or
    coalesce((p_capture->>'asOf')::timestamptz not between (r->>'nativeStartedAt')::timestamptz and clock_timestamp(),true) or
    coalesce((p_capture->>'asOf')::timestamptz>=g.deadline,true) or
    c->>'accountId' is distinct from g.account_id or c->>'date' is distinct from g.report_date::text or
    c->>'evidenceRef' is distinct from 'google-auto-control:'||(r->>'controlHash')||':cost' or
    c->'complete' is distinct from 'true'::jsonb or c->'independentlyExtracted' is distinct from 'true'::jsonb or
    (c->>'capturedAt')::timestamptz is distinct from (r->>'controlCompletedAt')::timestamptz or
    d->>'accountId' is distinct from g.account_id or d->>'date' is distinct from g.report_date::text or
    d#>>'{control,evidenceRef}' is distinct from 'google-auto-control:'||(r->>'controlHash')||':counts' or
    (d#>>'{control,capturedAt}')::timestamptz is distinct from (r->>'controlCompletedAt')::timestamptz or
    jsonb_typeof(r->'accountMetadata') is distinct from 'array' or jsonb_array_length(r->'accountMetadata')<>2 or
    exists(select 1 from jsonb_array_elements(r->'accountMetadata') x where
      x->>'accountId' is distinct from g.account_id or x->>'currency' is distinct from 'USD' or
      x->>'timezone' is distinct from 'America/New_York' or coalesce(x->>'responseSha256','') !~ '^[a-f0-9]{64}$' or
      coalesce((x->>'startedAt')::timestamptz<g.started_at,true) or
      coalesce((x->>'finishedAt')::timestamptz<(x->>'startedAt')::timestamptz,true) or
      coalesce((x->>'finishedAt')::timestamptz>(p_capture->>'asOf')::timestamptz,true))
    then raise exception 'commission native receipt'; end if;
  digest:=encode(sha256(convert_to(p_capture::text,'UTF8')),'hex');
  update lean_private.google_commissions set capture_packet=p_capture,capture_sha256=digest,
    committed_at=clock_timestamp() where grant_id=p_grant;
  perform lean_private.google_commission_current(p_grant,p_revision,p_capability);
  if clock_timestamp()>=g.deadline then raise exception 'commission commit deadline'; end if;
  return jsonb_build_object('state','captured','grantId',g.grant_id,'revision',g.revision::text,
    'cycleId',g.cycle_id,'captureSha256',digest,'registered',false,'selected',false);
end $$;
revoke all on function lean_private.google_commission_guard(),
  lean_private.google_commission_current(text,bigint,text),
  public.lean_google_commission_claim(text,bigint,text),public.lean_google_commission_commit(text,bigint,text,jsonb)
  from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_google_commission_claim(text,bigint,text),
  public.lean_google_commission_commit(text,bigint,text,jsonb) to service_role;
commit;
