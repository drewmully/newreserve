-- Application-owned source jobs. Install off; no old grants, holds, cron entries,
-- provider settings or finite consumer authorizations are changed.
begin;
set local search_path=pg_catalog;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $guard$
begin
  if current_user<>'postgres' or session_user<>'postgres' or
    current_setting('transaction_read_only')<>'off' or
    current_setting('transaction_isolation')<>'read committed' or
    to_regclass('lean_private.marketing_source_settings') is not null or
    to_regclass('public.job_runs') is null or
    to_regprocedure('lean_private.partition_digest(jsonb)') is null or
    (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc
      where oid=to_regprocedure('public.lean_saved_marketing_read(text)')) is distinct from
      '0578e55a605b92f7633a3d44dfdc1f3f1d9fb85103f1108b60d9e34a240086d9' or
    (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc
      where oid=to_regprocedure('public.lean_marketing_spend_hourly_register(jsonb)')) is distinct from
      '93e6de50dfc14763f4d3e2be9b2b94c5e5caac3c3e5ab4bf289aca10b74019c9'
    then raise exception 'marketing source migration precondition'; end if;
end $guard$;

create table lean_private.marketing_source_settings (
  provider text primary key check(provider in ('google_ads','meta_ads')),
  enabled boolean not null default false,
  report_enabled boolean not null default false,
  source_expires_at timestamptz,
  retry_after timestamptz,
  blocked_code text,
  admin_actor text,
  admin_reason text,
  admin_at timestamptz,
  check(not enabled or (source_expires_at is not null and isfinite(source_expires_at)))
);
insert into lean_private.marketing_source_settings(provider) values('google_ads'),('meta_ads');
create table lean_private.marketing_source_jobs (
  job_id bigint primary key references public.job_runs(id),
  provider text not null references lean_private.marketing_source_settings(provider),
  report_date date not null,
  slot text not null,
  lane text not null check(lane in ('primary','correction')),
  attempt integer not null check(attempt between 1 and 2),
  state text not null check(state in ('running','complete','failed','held')),
  lease_token uuid not null,
  started_at timestamptz not null,
  deadline timestamptz not null check(deadline=started_at+interval '90 seconds'),
  finished_at timestamptz,
  code text,
  packet jsonb,
  receipts jsonb,
  digest text,
  packet_hash text,
  admin_actor text,
  admin_reason text,
  unique(provider,report_date,slot,attempt),
  check((state='complete')=(packet is not null)),
  check(state<>'complete' or (receipts is not null and digest ~ '^[a-f0-9]{64}$' and
    packet_hash ~ '^[a-f0-9]{64}$' and finished_at is not null)),
  check(packet is null or octet_length(packet::text)<=4000000),
  check(receipts is null or octet_length(receipts::text)<=8388608)
);
create index marketing_source_latest on lean_private.marketing_source_jobs(provider,report_date,finished_at desc)
  where state='complete';
alter table lean_private.marketing_source_settings enable row level security;
alter table lean_private.marketing_source_jobs enable row level security;
revoke all on lean_private.marketing_source_settings,lean_private.marketing_source_jobs
  from public,anon,authenticated,service_role;

create function lean_private.marketing_source_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' or old.state='complete' or
    (new.job_id,new.provider,new.report_date,new.slot,new.lane,new.attempt,new.lease_token,new.started_at,new.deadline)
      is distinct from
    (old.job_id,old.provider,old.report_date,old.slot,old.lane,old.attempt,old.lease_token,old.started_at,old.deadline)
    then raise exception 'immutable marketing source revision'; end if;
  return new;
end $$;
create trigger marketing_source_immutable before update or delete on lean_private.marketing_source_jobs
  for each row execute function lean_private.marketing_source_immutable();
create function lean_private.marketing_source_iso(t timestamptz) returns text
language sql immutable set search_path=pg_catalog as $$
  select to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

create function public.lean_marketing_source_claim(p_provider text,p_lane text,
  p_date text default null,p_actor text default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s lean_private.marketing_source_settings; j lean_private.marketing_source_jobs;
  t timestamptz; today date;
  d date; slot_name text; lane_name text; attempts integer; allocated_id bigint; token uuid;
  repair boolean:=p_actor is not null; candidate record;
begin
  if p_provider not in ('google_ads','meta_ads') or p_provider is null or
    p_lane not in ('primary','correction') or p_lane is null or
    (repair and (length(p_actor) not between 1 and 128 or p_reason !~ '^[A-Za-z0-9 _.-]{3,120}$' or
      p_reason is null or p_date is null)) or
    (not repair and (p_date is not null or p_reason is not null))
    then raise exception 'marketing claim scope'; end if;
  select * into strict s from lean_private.marketing_source_settings where provider=p_provider for update;
  if not s.enabled then return jsonb_build_object('state','disabled'); end if;
  t:=date_trunc('milliseconds',clock_timestamp());
  -- Admission must leave the whole unchanged 90-second job lease inside the
  -- owner-bound source window. Expiry never extends or recycles an old lease.
  if s.source_expires_at is null or clock_timestamp()+interval '90 seconds'>s.source_expires_at
    then return jsonb_build_object('state','disabled'); end if;
  today:=(t at time zone 'America/New_York')::date;
  if repair then
    if p_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or p_date::date::text<>p_date or
      p_date::date not between today-7 and today-1 then raise exception 'marketing repair date'; end if;
  end if;
  -- Rate limits are provider-wide, including authenticated repairs.
  if s.retry_after>t then return jsonb_build_object('state','rate_limited'); end if;
  if exists(select 1 from lean_private.marketing_source_jobs where provider=p_provider and
    state='running' and deadline>t) then return jsonb_build_object('state','busy'); end if;
  -- The provider lock serializes this with commit. At expiry, a persisted
  -- complete packet is already visible; any remaining running job is unknown.
  for j in select * from lean_private.marketing_source_jobs where provider=p_provider and
    state='running' and deadline<=t for update loop
    update lean_private.marketing_source_jobs set state='held',code='commit_unconfirmed',finished_at=t where job_id=j.job_id;
    update public.job_runs set status='error',finished_at=t,error='marketing_source:commit_unconfirmed' where id=j.job_id;
  end loop;
  if exists(select 1 from lean_private.marketing_source_jobs where provider=p_provider and state='held') then
    if not repair then return jsonb_build_object('state','held'); end if;
    -- Explicit admin reconciliation of an expired, packet-absent source attempt.
    -- Never touches the separate automatic Google journal/hold/cycle.
    if exists(select 1 from lean_private.marketing_source_jobs where provider=p_provider and state='held' and
      (deadline>t or report_date<>p_date::date or packet is not null))
      then return jsonb_build_object('state','held'); end if;
    update lean_private.marketing_source_jobs set state='failed',code='admin_confirmed_no_commit',
      admin_actor=p_actor,admin_reason=p_reason where provider=p_provider and state='held';
  end if;
  if s.blocked_code='rate_limit_manual' or s.blocked_code is not null and not repair
    then return jsonb_build_object('state','held'); end if;
  if repair then
    update lean_private.marketing_source_settings set blocked_code=null,admin_actor=p_actor,
      admin_reason=p_reason,admin_at=t where provider=p_provider;
  end if;
  -- Separate mounted lanes prevent primary-hourly work starving D2-D7.
  -- One hourly primary call plus at least six correction calls/day/provider.
  for candidate in
    select n, today-n as date from generate_series(1,7) n where
      case when repair then today-n=p_date::date
        when p_lane='primary' then n=1 else n between 2 and 7 end
    order by n desc
  loop
    d:=candidate.date;
    lane_name:=case when candidate.n=1 then 'primary' else 'correction' end;
    slot_name:=case when lane_name='primary' then 'hour:'||to_char(t at time zone 'UTC','YYYYMMDDHH24')
      else 'correction:'||today::text end;
    -- Meta's two Pacific dates must both close before collecting the NY day.
    if p_provider='meta_ads' and t<(d+1)::timestamp at time zone 'America/Los_Angeles' then continue; end if;
    if exists(select 1 from lean_private.marketing_source_jobs where provider=p_provider and report_date=d and
      slot=slot_name and state='complete') then continue; end if;
    select count(*) into attempts from lean_private.marketing_source_jobs
      where provider=p_provider and report_date=d and slot=slot_name;
    if attempts>=2 then continue; end if;
    token:=gen_random_uuid();
    insert into public.job_runs(job_name,started_at,status,meta)
      values('marketing-source:'||p_provider||':'||d::text||':'||slot_name||':'||(attempts+1)::text,t,'running',
        jsonb_build_object('provider',p_provider,'report_date',d::text,'source_only',true))
      returning job_runs.id into allocated_id;
    insert into lean_private.marketing_source_jobs(job_id,provider,report_date,slot,lane,attempt,state,
      lease_token,started_at,deadline,admin_actor,admin_reason)
      values(allocated_id,p_provider,d,slot_name,lane_name,attempts+1,'running',token,t,t+interval '90 seconds',p_actor,p_reason);
    return jsonb_build_object('state','claimed','jobId',allocated_id::text,'token',token::text,'provider',p_provider,
      'date',d::text,'attempt',attempts+1,'startedAt',lean_private.marketing_source_iso(t),
      'deadline',lean_private.marketing_source_iso(t+interval '90 seconds'));
  end loop;
  return jsonb_build_object('state','not_due');
end $$;

create function public.lean_marketing_source_read(p_job bigint,p_token uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare j lean_private.marketing_source_jobs;
begin
  select * into j from lean_private.marketing_source_jobs where job_id=p_job and lease_token=p_token;
  if not found then return null; end if;
  if j.state='complete' and (j.digest is distinct from lean_private.partition_digest(
    jsonb_build_object('packet',j.packet,'receipts',j.receipts)) or j.packet_hash is distinct from
      encode(sha256(convert_to(j.packet::text,'UTF8')),'hex')) then raise exception 'marketing source hash'; end if;
  return jsonb_build_object('state',j.state,'jobId',j.job_id::text,'digest',j.digest,
    'packetHash',j.packet_hash,'packet',j.packet);
end $$;

create function public.lean_marketing_source_fail(p_job bigint,p_token uuid,p_code text,p_retry_seconds integer default 0)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j lean_private.marketing_source_jobs; provider_name text; t timestamptz:=clock_timestamp();
begin
  if p_code is null or p_code not in ('configuration_missing','authentication_denied','rate_limited',
    'rate_limit_manual','provider_unavailable','timeout','incomplete_pages','schema_changed','control_mismatch',
    'unsupported_window','scope_invalid','commit_unconfirmed') or p_retry_seconds is null or
    p_retry_seconds not between 0 and 86400 then raise exception 'marketing failure scope'; end if;
  select provider into strict provider_name from lean_private.marketing_source_jobs where job_id=p_job and lease_token=p_token;
  perform 1 from lean_private.marketing_source_settings where provider=provider_name for update;
  select * into strict j from lean_private.marketing_source_jobs where job_id=p_job and lease_token=p_token for update;
  if j.state='complete' then return jsonb_build_object('state','complete'); end if;
  if j.state<>'running' then return jsonb_build_object('state',j.state); end if;
  update lean_private.marketing_source_jobs set state=case when p_code='commit_unconfirmed' then 'held' else 'failed' end,
    code=p_code,finished_at=t where job_id=p_job;
  update public.job_runs set status='error',finished_at=t,error='marketing_source:'||p_code where id=p_job;
  update lean_private.marketing_source_settings set
    retry_after=greatest(retry_after,t+make_interval(secs=>greatest(900,p_retry_seconds))),
    blocked_code=case when p_code in ('configuration_missing','authentication_denied','rate_limit_manual',
      'schema_changed','scope_invalid','control_mismatch','incomplete_pages') then p_code else blocked_code end
    where provider=provider_name;
  return jsonb_build_object('state',case when p_code='commit_unconfirmed' then 'held' else 'failed' end);
end $$;

create function public.lean_marketing_source_health()
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_agg(jsonb_build_object('provider',s.provider,'enabled',s.enabled,'reportEnabled',s.report_enabled,
    'sourceExpiresAt',s.source_expires_at,
    'blockedCode',s.blocked_code,'retryAfter',s.retry_after,
    'lastAttempt',recent.started_at,'lastState',recent.state,'lastCode',recent.code,
    'lastSuccess',g.finished_at,'lastSuccessDate',g.report_date,'lastSuccessHash',g.packet_hash,
    'lastCaptureAt',case when s.provider='google_ads' then g.packet#>>'{google,base,completedAt}'
      else g.packet#>>'{meta,source,capturedAt}' end,
    'lastControlAt',case when s.provider='google_ads' then g.packet#>>'{google,costControl,capturedAt}'
      else g.packet#>>'{meta,control,capturedAt}' end,
    'downstreamImport','not_observed') order by s.provider)
  from lean_private.marketing_source_settings s left join lateral
    (select * from lean_private.marketing_source_jobs j where j.provider=s.provider and j.state='complete'
      order by j.finished_at desc,j.job_id desc limit 1) g on true
  left join lateral (select * from lean_private.marketing_source_jobs j where j.provider=s.provider
    order by j.started_at desc,j.job_id desc limit 1) recent on true
$$;
create function public.lean_marketing_source_pause(p_provider text,p_actor text,p_reason text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
  if p_provider is null or p_provider not in ('google_ads','meta_ads') or
    coalesce(length(p_actor),0) not between 1 and 128 or p_reason is null or
    p_reason !~ '^[A-Za-z0-9 _.-]{3,120}$' then raise exception 'marketing pause scope'; end if;
  update lean_private.marketing_source_settings set enabled=false,admin_actor=p_actor,
    admin_reason=p_reason,admin_at=clock_timestamp() where provider=p_provider;
  return true;
end $$;

-- VALIDATORS
create function lean_private.marketing_google_validate(j lean_private.marketing_source_jobs,
  p jsonb,receipts jsonb,as_of text) returns void language plpgsql set search_path=pg_catalog as $$
declare r jsonb; i integer; prev timestamptz:=j.started_at; began timestamptz; ended timestamptz;
  first_at timestamptz; byte_count bigint:=0; query text; mask text[];
  base_rows jsonb; cost_rows jsonb; count_rows jsonb; expected jsonb; customer jsonb;
  total numeric; clicks numeric; impressions numeric; empty boolean;
  control_at text; ref text:='app-marketing-job:'||j.job_id::text; m jsonb;
begin
  if jsonb_typeof(receipts) is distinct from 'object' or receipts-'requests'<>'{}' or
    jsonb_typeof(receipts->'requests') is distinct from 'array' or jsonb_array_length(receipts->'requests')<>7 or
    p->>'kind' is distinct from 'app_google_v1' or p->>'jobId' is distinct from j.job_id::text or
    p->>'asOf' is distinct from as_of or p-array['kind','jobId','manifest','base','costControl','delivery','asOf']<>'{}'
    then raise exception 'marketing Google envelope'; end if;
  for i in 0..6 loop
    r:=receipts->'requests'->i;
    began:=(r->>'startedAt')::timestamptz; ended:=(r->>'finishedAt')::timestamptz;
    if i=0 then first_at:=began; end if;
    if not(r ?& array['method','url','query','startedAt','finishedAt','status','bodyBytes','bodySha256','response']) or
      r-array['method','url','query','startedAt','finishedAt','status','bodyBytes','bodySha256','response']<>'{}' or
      r->>'method' is distinct from 'POST' or r->'status' is distinct from '200'::jsonb or
      began is null or ended is null or not isfinite(began) or not isfinite(ended) or began<prev or
      ended<began or ended-began>=interval '15 seconds' or ended-first_at>=interval '60 seconds' or
      ended>as_of::timestamptz or coalesce(r->>'bodyBytes','') !~ '^[0-9]+$' or
      (r->>'bodyBytes')::bigint not between 2 and 8388608 or
      coalesce(r->>'bodySha256','') !~ '^[a-f0-9]{64}$'
      then raise exception 'marketing Google request bounds'; end if;
    prev:=ended; byte_count:=byte_count+(r->>'bodyBytes')::bigint;
    if i in (0,4) then
      if r->>'url' is distinct from 'https://oauth2.googleapis.com/token' or
        r->'response' is distinct from 'null'::jsonb or r->'query' is distinct from 'null'::jsonb
        then raise exception 'marketing Google credential receipt'; end if;
      continue;
    end if;
    if r->>'url' is distinct from 'https://googleads.googleapis.com/v25/customers/4335795219/googleAds:search' or
      (r->'response')-array['fieldMask','results']<>'{}' or
      jsonb_typeof(r#>'{response,results}') is distinct from 'array' or
      jsonb_array_length(r#>'{response,results}')>10000 then raise exception 'marketing Google EOF'; end if;
    if i in (1,5) then
      query:='SELECT customer.id, customer.currency_code, customer.time_zone FROM customer';
      mask:=array['customer.currencyCode','customer.id','customer.timeZone'];
      expected:=jsonb_build_array(jsonb_build_object('customer',
        jsonb_build_object('id','4335795219','currencyCode','USD','timeZone','America/New_York')));
      if r#>'{response,results}' is distinct from expected then raise exception 'marketing Google account'; end if;
    elsif i=3 then
      query:='SELECT segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions FROM customer WHERE segments.date BETWEEN '||
        quote_literal(j.report_date::text)||' AND '||quote_literal(j.report_date::text)||' ORDER BY segments.date';
      mask:=array['metrics.clicks','metrics.costMicros','metrics.impressions','segments.date'];
      if jsonb_array_length(r#>'{response,results}')>1 then raise exception 'marketing Google customer scope'; end if;
    else
      query:='SELECT campaign.id, segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions FROM campaign WHERE segments.date = '||
        quote_literal(j.report_date::text)||' ORDER BY campaign.id';
      mask:=array['campaign.id','metrics.clicks','metrics.costMicros','metrics.impressions','segments.date'];
    end if;
    if r->>'query' is distinct from query or (select array_agg(v order by v) from
      unnest(string_to_array(r#>>'{response,fieldMask}',',')) v) is distinct from mask
      then raise exception 'marketing Google query'; end if;
    if i in (2,3,6) and exists(select 1 from jsonb_array_elements(r#>'{response,results}') x where
      x#>>'{segments,date}' is distinct from j.report_date::text or
      coalesce(x#>>'{metrics,costMicros}','') !~ '^(0|[1-9][0-9]{0,19})$' or
      (i<>3 and (coalesce(x#>>'{campaign,id}','') !~ '^[1-9][0-9]{0,19}$' or
        coalesce(x#>>'{metrics,clicks}','') !~ '^(0|[1-9][0-9]{0,15})$' or
        coalesce(x#>>'{metrics,impressions}','') !~ '^(0|[1-9][0-9]{0,15})$')))
      then raise exception 'marketing Google row'; end if;
  end loop;
  if byte_count>8388608 then raise exception 'marketing Google bytes'; end if;
  if receipts#>'{requests,2,response,results}' is distinct from receipts#>'{requests,6,response,results}' or
    (select count(*) from jsonb_array_elements(receipts#>'{requests,6,response,results}')) <>
    (select count(distinct x#>>'{campaign,id}') from jsonb_array_elements(receipts#>'{requests,6,response,results}') x)
    then raise exception 'marketing Google campaign control'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('campaignId',x#>>'{campaign,id}','costMicros',x#>>'{metrics,costMicros}',
      'clicks',x#>>'{metrics,clicks}','impressions',x#>>'{metrics,impressions}') order by n),'[]'),
    coalesce(jsonb_agg(jsonb_build_object('id',x#>>'{campaign,id}','costMicros',x#>>'{metrics,costMicros}') order by n),'[]'),
    coalesce(jsonb_agg(jsonb_build_object('id',x#>>'{campaign,id}','clicks',x#>>'{metrics,clicks}',
      'impressions',x#>>'{metrics,impressions}') order by n),'[]'),
    coalesce(sum((x#>>'{metrics,costMicros}')::numeric),0),sum((x#>>'{metrics,clicks}')::numeric),
    sum((x#>>'{metrics,impressions}')::numeric)
    into base_rows,cost_rows,count_rows,total,clicks,impressions
    from jsonb_array_elements(receipts#>'{requests,6,response,results}') with ordinality rows(x,n);
  empty:=jsonb_array_length(base_rows)=0;
  customer:=receipts#>'{requests,3,response,results,0,metrics}';
  if empty then
    if customer is not null and (customer->>'costMicros' is distinct from '0' or
      coalesce(customer->>'clicks','0')<>'0' or coalesce(customer->>'impressions','0')<>'0')
      then raise exception 'marketing Google zero control'; end if;
  elsif customer is null or customer->>'costMicros' is distinct from total::text or
    customer->>'clicks' is distinct from clicks::text or customer->>'impressions' is distinct from impressions::text
    then raise exception 'marketing Google account control'; end if;
  control_at:=p#>>'{costControl,capturedAt}';
  if control_at is null or (control_at::timestamptz) not between
    (receipts#>>'{requests,3,finishedAt}')::timestamptz and (receipts#>>'{requests,4,startedAt}')::timestamptz
    then raise exception 'marketing Google control clock'; end if;
  expected:=jsonb_build_object('provider','google_ads','accountId','4335795219','date',j.report_date::text,
    'sourceCurrency','USD','sourceTimezone','America/New_York','capturedAt',control_at,
    'evidenceRef',ref||':independent-cost','independentlyExtracted',true,'complete',true,
    'verifiedEmpty',empty,'totalCostMicros',total::text,'campaigns',cost_rows);
  if p->'costControl' is distinct from expected then raise exception 'marketing Google cost packet'; end if;
  expected:=jsonb_build_object('version',1,'accountId','4335795219','date',j.report_date::text,
    'approvalRef','app-owned-marketing-v1','definitionVersion','google-account-daily-v1',
    'control',jsonb_build_object('evidenceRef',ref||':independent-counts','capturedAt',control_at,
      'independentlyExtracted',true,'complete',true,'clickDefinition','google_ads.metrics.clicks',
      'clicks',case when empty then null else clicks::text end,
      'impressions',case when empty then null else impressions::text end,'campaigns',count_rows));
  if p->'delivery' is distinct from expected then raise exception 'marketing Google delivery packet'; end if;
  expected:=jsonb_build_object('provider','google_ads','accountId','4335795219','date',j.report_date::text,
    'baseReportId',p#>>'{base,baseReportId}','sourceCurrency','USD','sourceTimezone','America/New_York',
    'completedAt',as_of,'paginationComplete',true,'verifiedEmpty',empty,
    'evidenceRef','lean_private.marketing_source_jobs/'||j.job_id::text,'rows',base_rows);
  if p->'base' is distinct from expected or coalesce(p#>>'{base,baseReportId}','') !~
    ('^fresh-google:[a-f0-9]{64}:'||j.report_date::text||'$')
    then raise exception 'marketing Google base packet'; end if;
  m:=jsonb_build_object('version',1,'projectRef','xnfjdbpjuaezxjgargto','accountId','4335795219',
    'loginCustomerId','9552995078','approvalRef','app-owned-marketing-v1','actorRef',ref,'revisionRef',ref,
    'credentialBindingRef','application-generic-google-service-account','coverage','whole_account_campaign_day',
    'sourceCurrency','USD','sourceTimezone','America/New_York','preparedAt',lean_private.marketing_source_iso(j.started_at),
    'expiresAt',lean_private.marketing_source_iso(j.deadline),'freshnessCutoffAt',lean_private.marketing_source_iso(j.started_at),
    'maxPages',1,'maxRequestsPerDay',3,'deadlineSeconds',60,
    'days',jsonb_build_array(jsonb_build_object('date',j.report_date::text,'dueAt',lean_private.marketing_source_iso(j.started_at))));
  if p->'manifest' is distinct from m or j.report_date>=(j.started_at at time zone 'America/New_York')::date
    then raise exception 'marketing Google manifest'; end if;
end $$;

-- Native Meta correspondence is the released daily validator, parameterized
-- only by this new job's date/clock/identity. The original registrar is untouched.
create function lean_private.marketing_meta_validate(j lean_private.marketing_source_jobs,
  p_packet jsonb,p_receipts jsonb,p_as_of text) returns void
language plpgsql set search_path=pg_catalog as $body$
declare r jsonb; entry record; report_date date:=j.report_date;
  generation text:='meta_ingest_app_'||j.job_id::text; since_date date; until_date date;
  from_at timestamptz; until_at timestamptz; close_at timestamptz; as_of timestamptz:=p_as_of::timestamptz;
  first_at timestamptz; previous_at timestamptz; began timestamptz; ended timestamptz;
  expected_params jsonb; metadata jsonb; account_rows jsonb; campaign_rows jsonb;
  expected_packet jsonb; source_empty boolean; control_empty boolean; amount_rows integer;
begin
  if jsonb_typeof(p_receipts) is distinct from 'object' or
    not(p_receipts ?& array['metadata','accountHours','campaignHours']) or
    p_receipts-array['metadata','accountHours','campaignHours']<>'{}' or
    octet_length(p_receipts::text)>3500000 or octet_length(p_packet::text)>1000000
    then raise exception 'marketing Meta receipts'; end if;
  from_at:=report_date::timestamp at time zone 'America/New_York';
  until_at:=(report_date+1)::timestamp at time zone 'America/New_York';
  since_date:=(from_at at time zone 'America/Los_Angeles')::date;
  until_date:=((until_at-interval '1 hour') at time zone 'America/Los_Angeles')::date;
  close_at:=(until_date+1)::timestamp at time zone 'America/Los_Angeles';
  if until_at-from_at<>interval '24 hours' or
    close_at-(since_date::timestamp at time zone 'America/Los_Angeles')<>interval '48 hours'
    then raise exception 'Meta source unsupported DST day'; end if;
  previous_at:=j.started_at;
  for entry in select * from (values
    (1,'metadata'),(2,'accountHours'),(3,'campaignHours')) v(ordinal,name) order by ordinal loop
    r:=p_receipts->entry.name;
    began:=(r->>'startedAt')::timestamptz; ended:=(r->>'finishedAt')::timestamptz;
    if entry.ordinal=1 then first_at:=began; end if;
    if jsonb_typeof(r) is distinct from 'object' or
      not(r ?& array['startedAt','finishedAt','method','url','params','status','bodyBytes','bodySha256',
        'pagingCredentialQueryParametersRemoved','response']) or
      r-array['startedAt','finishedAt','method','url','params','status','bodyBytes','bodySha256',
        'pagingCredentialQueryParametersRemoved','response']<>'{}' or
      began is null or ended is null or not isfinite(began) or not isfinite(ended) or
      began<previous_at or began<close_at or ended<began or ended>as_of or
      ended-began>=interval '15 seconds' or ended-first_at>=interval '55 seconds' or
      r->>'method' is distinct from 'GET' or r->'status' is distinct from '200'::jsonb or
      r->>'url' is distinct from 'https://graph.facebook.com/v25.0/act_2796962933960445'||
        (case when entry.ordinal=1 then '' else '/insights' end) or
      jsonb_typeof(r->'bodyBytes') is distinct from 'number' or
      coalesce(r->>'bodyBytes','') !~ '^[0-9]+$' or (r->>'bodyBytes')::integer not between 2 and 1000000 or
      coalesce(r->>'bodySha256','') !~ '^[a-f0-9]{64}$' or
      r->'pagingCredentialQueryParametersRemoved' is distinct from 'true'::jsonb
      then raise exception 'Meta source capture limits'; end if;
    previous_at:=ended;
    if entry.ordinal=1 then
      expected_params:=jsonb_build_object('fields','id,account_id,currency,timezone_name,account_status,business');
      metadata:=r->'response';
      if metadata is distinct from jsonb_build_object('id','act_2796962933960445','account_id','2796962933960445',
        'currency','USD','timezone_name','America/Los_Angeles','account_status',1)
        then raise exception 'Meta source account'; end if;
    else
      expected_params:=jsonb_build_object('time_range',r#>>'{params,time_range}','time_increment','1',
        'breakdowns','hourly_stats_aggregated_by_advertiser_time_zone',
        'level',case when entry.ordinal=2 then 'account' else 'campaign' end,
        'fields','account_id,account_currency,date_start,date_stop,spend'||
          case when entry.ordinal=3 then ',campaign_id' else '' end,
        'limit',case when entry.ordinal=2 then '49' else '1001' end);
      if (r#>>'{params,time_range}')::jsonb is distinct from
        jsonb_build_object('since',since_date::text,'until',until_date::text) or
        jsonb_typeof(r#>'{response,data}') is distinct from 'array' or (r->'response')-'data'<>'{}' or
        jsonb_array_length(r#>'{response,data}')>(case when entry.ordinal=2 then 48 else 1000 end)
        then raise exception 'Meta source native EOF'; end if;
      if exists(select 1 from jsonb_array_elements(r#>'{response,data}') x where
        jsonb_typeof(x) is distinct from 'object' or
        exists(select 1 from jsonb_each(x) member where jsonb_typeof(member.value) is distinct from 'string') or
        not(x ?& (array['account_id','account_currency','date_start','date_stop','spend',
          'hourly_stats_aggregated_by_advertiser_time_zone']||
          case when entry.ordinal=3 then array['campaign_id'] else array[]::text[] end)) or
        x-(array['account_id','account_currency','date_start','date_stop','spend',
          'hourly_stats_aggregated_by_advertiser_time_zone']||
          case when entry.ordinal=3 then array['campaign_id'] else array[]::text[] end)<>'{}' or
        x->>'account_id' is distinct from '2796962933960445' or x->>'account_currency' is distinct from 'USD' or
        jsonb_typeof(x->'spend') is distinct from 'string' or
        coalesce(x->>'spend','') !~ '^(0|[1-9][0-9]{0,13})([.][0-9]{1,6})?$' or
        coalesce(x->>'date_start','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or
        x->>'date_start' is distinct from x->>'date_stop' or
        (x->>'date_start')::date not between since_date and until_date or
        coalesce(x->>'hourly_stats_aggregated_by_advertiser_time_zone','') !~ '^([01][0-9]|2[0-3]):00:00 - \1:59:59$' or
        entry.ordinal=3 and coalesce(x->>'campaign_id','') !~ '^[1-9][0-9]{0,19}$')
        then raise exception 'Meta source row'; end if;
      select coalesce(jsonb_agg(x.value-'account_currency' order by x.ordinality),'[]'::jsonb)
        into r from jsonb_array_elements(p_receipts#>array[entry.name,'response','data']) with ordinality x;
      if entry.ordinal=2 then account_rows:=r; else campaign_rows:=r; end if;
    end if;
    if p_receipts#>array[entry.name,'params'] is distinct from expected_params
      then raise exception 'Meta source query'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(account_rows)) <>
    (select count(distinct (x->>'date_start',x->>'hourly_stats_aggregated_by_advertiser_time_zone'))
       from jsonb_array_elements(account_rows) x) or
    (select count(*) from jsonb_array_elements(campaign_rows)) <>
    (select count(distinct (x->>'date_start',x->>'hourly_stats_aggregated_by_advertiser_time_zone',x->>'campaign_id'))
       from jsonb_array_elements(campaign_rows) x)
    then raise exception 'Meta source duplicate hour'; end if;
  with accounts as (
    select x->>'date_start' d,x->>'hourly_stats_aggregated_by_advertiser_time_zone' h,(x->>'spend')::numeric amount
    from jsonb_array_elements(account_rows) x
  ), campaigns as (
    select x->>'date_start' d,x->>'hourly_stats_aggregated_by_advertiser_time_zone' h,sum((x->>'spend')::numeric) amount
    from jsonb_array_elements(campaign_rows) x group by 1,2
  ) select count(*) into amount_rows from accounts a full join campaigns c using(d,h)
    where coalesce(a.amount,0)<>coalesce(c.amount,0);
  if amount_rows<>0 then raise exception 'Meta source independent amount mismatch'; end if;
  select not exists(select 1 from jsonb_array_elements(campaign_rows) x where
    (((x->>'date_start')::date::timestamp+make_interval(hours=>left(x->>'hourly_stats_aggregated_by_advertiser_time_zone',2)::integer))
      at time zone 'America/Los_Angeles')>=from_at and
    (((x->>'date_start')::date::timestamp+make_interval(hours=>left(x->>'hourly_stats_aggregated_by_advertiser_time_zone',2)::integer))
      at time zone 'America/Los_Angeles')<until_at) into source_empty;
  select not exists(select 1 from jsonb_array_elements(account_rows) x where
    (((x->>'date_start')::date::timestamp+make_interval(hours=>left(x->>'hourly_stats_aggregated_by_advertiser_time_zone',2)::integer))
      at time zone 'America/Los_Angeles')>=from_at and
    (((x->>'date_start')::date::timestamp+make_interval(hours=>left(x->>'hourly_stats_aggregated_by_advertiser_time_zone',2)::integer))
      at time zone 'America/Los_Angeles')<until_at) into control_empty;
  if source_empty<>control_empty then raise exception 'Meta source empty disagreement'; end if;
  expected_packet:=jsonb_build_object(
    'version',2,'projectRef','xnfjdbpjuaezxjgargto','shop','mullybox-store.myshopify.com',
    'generationId',generation,'accountId','act_2796962933960445','date',report_date::text,
    'sourceCurrency','USD','sourceTimezone','America/Los_Angeles','approvalRef','app-owned-marketing-v1',
    'actorRef','app-marketing-job:'||j.job_id::text,
    'window',jsonb_build_object('reportTimezone','America/New_York',
      'fromAt',p_packet#>>'{window,fromAt}','untilAt',p_packet#>>'{window,untilAt}'),
    'source',jsonb_build_object('evidenceRef','meta-graph:campaign:'||lean_private.partition_digest(p_receipts->'campaignHours'),
      'accountMetadataRef','meta-graph:metadata:'||lean_private.partition_digest(p_receipts->'metadata'),
      'capturedAt',p_receipts#>>'{campaignHours,finishedAt}','complete',true,'paginationComplete',true,
      'verifiedEmpty',source_empty,'rows',campaign_rows,
      'query',jsonb_build_object('since',since_date::text,'until',until_date::text,'timeIncrement',1,
        'breakdown','hourly_stats_aggregated_by_advertiser_time_zone','level','campaign','unfiltered',true)),
    'control',jsonb_build_object('evidenceRef','meta-graph:account:'||lean_private.partition_digest(p_receipts->'accountHours'),
      'approvalRef','app-marketing-job:'||j.job_id::text||':control',
      'capturedAt',p_receipts#>>'{accountHours,finishedAt}','independentlyExtracted',true,'complete',true,
      'paginationComplete',true,'verifiedEmpty',control_empty,'rows',account_rows,
      'query',jsonb_build_object('since',since_date::text,'until',until_date::text,'timeIncrement',1,
        'breakdown','hourly_stats_aggregated_by_advertiser_time_zone','level','account','unfiltered',true)));
  if p_packet is distinct from expected_packet or
    (p_packet#>>'{window,fromAt}')::timestamptz is distinct from from_at or
    (p_packet#>>'{window,untilAt}')::timestamptz is distinct from until_at
    then raise exception 'Meta source packet correspondence'; end if;
end $body$;

create function public.lean_marketing_source_commit(p_job bigint,p_token uuid,p_packet jsonb,p_receipts jsonb,p_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j lean_private.marketing_source_jobs; s lean_private.marketing_source_settings; provider_name text;
  t timestamptz; meta_row lean_private.marketing_spend_days;
begin
  select provider into strict provider_name from lean_private.marketing_source_jobs where job_id=p_job and lease_token=p_token;
  select * into strict s from lean_private.marketing_source_settings where provider=provider_name for update;
  select * into strict j from lean_private.marketing_source_jobs where job_id=p_job and lease_token=p_token for update;
  if p_digest is null or p_digest is distinct from lean_private.partition_digest(
    jsonb_build_object('packet',p_packet,'receipts',p_receipts)) or
    octet_length(p_packet::text)>4000000 or octet_length(p_receipts::text)>8388608
    then raise exception 'marketing source input hash'; end if;
  if j.state='complete' then
    if j.digest is distinct from p_digest then raise exception 'marketing source different revision'; end if;
    return public.lean_marketing_source_read(p_job,p_token);
  end if;
  t:=clock_timestamp();
  if not s.enabled or s.source_expires_at is null or t>=s.source_expires_at or j.state<>'running' or t>=j.deadline or
    (p_packet->>'asOf')::timestamptz is null or (p_packet->>'asOf')::timestamptz not between j.started_at and t or
    p_packet-array['kind','asOf',case when provider_name='google_ads' then 'google' else 'meta' end]<>'{}'
    then raise exception 'marketing source commit scope'; end if;
  if provider_name='google_ads' then
    if p_packet->>'kind' is distinct from 'app_google_v1' then raise exception 'marketing Google kind'; end if;
    perform lean_private.marketing_google_validate(j,p_packet->'google',p_receipts,p_packet->>'asOf');
  else
    if p_packet->>'kind' is distinct from 'app_meta_v1' then raise exception 'marketing Meta kind'; end if;
    perform lean_private.marketing_meta_validate(j,p_packet->'meta',p_receipts,p_packet->>'asOf');
    perform public.lean_marketing_spend_hourly_register(p_packet->'meta');
    select * into strict meta_row from lean_private.marketing_spend_days
      where generation_id='meta_ingest_app_'||j.job_id::text for share;
    if meta_row.enabled or meta_row.packet is distinct from p_packet->'meta' or
      meta_row.packet_hash is distinct from encode(sha256(convert_to(meta_row.packet::text,'UTF8')),'hex')
      then raise exception 'marketing Meta persistence'; end if;
  end if;
  if clock_timestamp()>=j.deadline or clock_timestamp()>=s.source_expires_at
    then raise exception 'marketing source commit expiry'; end if;
  update lean_private.marketing_source_jobs set state='complete',packet=p_packet,receipts=p_receipts,digest=p_digest,
    packet_hash=encode(sha256(convert_to(p_packet::text,'UTF8')),'hex'),finished_at=clock_timestamp()
    where job_id=p_job;
  update public.job_runs set status='ok',finished_at=clock_timestamp(),rows_in=case when provider_name='google_ads' then 7 else 3 end,
    rows_out=1,meta=meta||jsonb_build_object('source_registered',true,'digest',p_digest) where id=p_job;
  update lean_private.marketing_source_settings set retry_after=null,blocked_code=null where provider=provider_name;
  -- A row lock or trigger in any final write can outlast the admission check.
  -- Refuse after every write so the whole registration transaction rolls back.
  if clock_timestamp()>=j.deadline or clock_timestamp()>=s.source_expires_at
    then raise exception 'marketing source commit expiry'; end if;
  return public.lean_marketing_source_read(p_job,p_token);
end $$;

alter function public.lean_saved_marketing_read(text) rename to lean_saved_marketing_read_before_app_sources;
revoke all on function public.lean_saved_marketing_read_before_app_sources(text) from public,anon,authenticated,service_role;
create function public.lean_saved_marketing_read(p_token_sha256 text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare value jsonb; days jsonb:='[]'; d jsonb; p text; j lean_private.marketing_source_jobs;
  payload jsonb; old_at timestamptz; at timestamptz; field text;
begin
  -- Retain the current finite bearer/scope/disabled-P6 opt-in and legacy fallback.
  value:=public.lean_saved_marketing_read_before_app_sources(p_token_sha256);
  if value is null then return null; end if;
  for d in select * from jsonb_array_elements(value->'days') loop
    foreach p in array array['google_ads','meta_ads'] loop
      if not exists(select 1 from lean_private.marketing_source_settings where provider=p and report_enabled) then continue; end if;
      select * into j from lean_private.marketing_source_jobs where provider=p and report_date=(d->>'date')::date and
        state='complete' order by finished_at desc,job_id desc limit 1;
      if not found then continue; end if;
      if j.packet_hash is distinct from encode(sha256(convert_to(j.packet::text,'UTF8')),'hex') or
        j.digest is distinct from lean_private.partition_digest(jsonb_build_object('packet',j.packet,'receipts',j.receipts))
        then raise exception 'marketing latest source hash'; end if;
      field:=case when p='google_ads' then 'google' else 'meta' end;
      payload:=j.packet->field;
      at:=case when p='google_ads' then (payload->>'asOf')::timestamptz
        else (payload#>>'{source,capturedAt}')::timestamptz end;
      old_at:=case when p='google_ads' then (d#>>'{google,asOf}')::timestamptz
        else (d#>>'{meta,source,capturedAt}')::timestamptz end;
      if old_at is null or at>old_at then
        d:=jsonb_set(jsonb_set(d,array[field],payload),array[field||'_sha256'],
          to_jsonb(encode(sha256(convert_to(payload::text,'UTF8')),'hex')));
      end if;
    end loop;
    days:=days||jsonb_build_array(d);
  end loop;
  value:=jsonb_set(value,'{days}',days);
  if octet_length(value::text)>8388608 then raise exception 'marketing read byte budget'; end if;
  return value;
end $$;

-- Explicitly clean inherited default ACLs on only the new objects. The legacy
-- alias becomes owner-only; no existing source/consumer capability is expanded.
do $acl$
declare f record; a record; tab record;
begin
  for f in select p.oid::regprocedure sig,p.proowner from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and p.proname in ('lean_marketing_source_claim','lean_marketing_source_read',
      'lean_marketing_source_fail','lean_marketing_source_health','lean_marketing_source_pause',
      'lean_marketing_source_commit','lean_saved_marketing_read','lean_saved_marketing_read_before_app_sources'))
    or (n.nspname='lean_private' and p.proname in ('marketing_source_iso','marketing_source_immutable',
      'marketing_google_validate','marketing_meta_validate'))
  loop
    for a in select grantee from aclexplode(coalesce((select proacl from pg_proc where oid=f.sig),acldefault('f',f.proowner)))
      where grantee<>f.proowner loop
      execute format('revoke all on function %s from %s',f.sig,
        case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end);
    end loop;
  end loop;
  for tab in select oid,relowner from pg_class where oid in
    ('lean_private.marketing_source_jobs'::regclass,'lean_private.marketing_source_settings'::regclass) loop
    for a in select grantee from aclexplode(coalesce((select relacl from pg_class where oid=tab.oid),acldefault('r',tab.relowner)))
      where grantee<>tab.relowner loop
      execute format('revoke all on table %s from %s',tab.oid::regclass,
        case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end);
    end loop;
  end loop;
end $acl$;
grant execute on function public.lean_marketing_source_claim(text,text,text,text,text),
  public.lean_marketing_source_read(bigint,uuid),public.lean_marketing_source_fail(bigint,uuid,text,integer),
  public.lean_marketing_source_health(),public.lean_marketing_source_pause(text,text,text),
  public.lean_marketing_source_commit(bigint,uuid,jsonb,jsonb,text),public.lean_saved_marketing_read(text) to service_role;
notify pgrst,'reload schema';
commit;
