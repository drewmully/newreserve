-- Executable owner migration for the existing daily Meta cron's source-only
-- branch. No new table, Google/B1 grant, full run, source enable or data rewrite.
begin;
set local search_path=pg_catalog;
set local lock_timeout='3s';
set local statement_timeout='20s';
set local idle_in_transaction_session_timeout='30s';
do $guard$
begin
  if current_user<>'postgres' or session_user<>'postgres' or
    current_setting('transaction_read_only')<>'off' or
    current_setting('transaction_isolation')<>'read committed' or
    to_regclass('public.job_runs') is null or
    to_regprocedure('lean_private.partition_digest(jsonb)') is null or
    to_regprocedure('public.lean_meta_source_register(bigint,jsonb,jsonb,text)') is not null or
    to_regclass('public.meta_source_daily_attempt_once') is not null or
    (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc
      where oid=to_regprocedure('public.lean_marketing_spend_hourly_register(jsonb)')) is distinct from
      '93e6de50dfc14763f4d3e2be9b2b94c5e5caac3c3e5ab4bf289aca10b74019c9'
    then raise exception 'Meta source migration precondition'; end if;
  if exists(select 1 from public.job_runs where job_name like 'meta-source:%')
    then raise exception 'Meta source prior attempt requires inspection'; end if;
end $guard$;

-- Existing withJobRun inserts this name before any HTTP. A failed/ambiguous
-- attempt keeps the unique name and cannot automatically recapture that day.
create unique index meta_source_daily_attempt_once on public.job_runs(job_name)
  where job_name like 'meta-source:%';

create function public.lean_meta_source_register(
  p_job bigint,p_packet jsonb,p_receipts jsonb,p_as_of text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $body$
declare j public.job_runs; d lean_private.marketing_spend_days; r jsonb; entry record;
  report_date date; generation text; since_date date; until_date date;
  from_at timestamptz; until_at timestamptz; close_at timestamptz; as_of timestamptz;
  first_at timestamptz; previous_at timestamptz; began timestamptz; ended timestamptz;
  expected_params jsonb; metadata jsonb; account_rows jsonb; campaign_rows jsonb;
  expected_packet jsonb; source_empty boolean; control_empty boolean; amount_rows integer;
begin
  select * into strict j from public.job_runs where id=p_job for update;
  report_date:=((clock_timestamp() at time zone 'America/New_York')::date-1);
  generation:='meta_ingest_daily_'||report_date::text;
  as_of:=p_as_of::timestamptz;
  if j.job_name is distinct from 'meta-source:'||report_date::text or j.status is distinct from 'running' or
    j.finished_at is not null or j.started_at is null or j.started_at>clock_timestamp() or
    (j.started_at at time zone 'America/New_York')::date<>report_date+1 or
    clock_timestamp()>=j.started_at+interval '90 seconds' or
    as_of is null or not isfinite(as_of) or as_of<j.started_at or as_of>clock_timestamp() or
    coalesce(j.meta,'{}'::jsonb) ? 'meta_source_registered' or
    jsonb_typeof(p_receipts) is distinct from 'object' or
    not(p_receipts ?& array['metadata','accountHours','campaignHours']) or
    p_receipts-array['metadata','accountHours','campaignHours']<>'{}' or
    octet_length(p_receipts::text)>3500000 or octet_length(p_packet::text)>1000000
    then raise exception 'Meta source job or receipt scope'; end if;
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
    'sourceCurrency','USD','sourceTimezone','America/Los_Angeles','approvalRef','meta-source-daily-v1',
    'actorRef','meta-source-job:'||p_job::text,
    'window',jsonb_build_object('reportTimezone','America/New_York',
      'fromAt',p_packet#>>'{window,fromAt}','untilAt',p_packet#>>'{window,untilAt}'),
    'source',jsonb_build_object('evidenceRef','meta-graph:campaign:'||lean_private.partition_digest(p_receipts->'campaignHours'),
      'accountMetadataRef','meta-graph:metadata:'||lean_private.partition_digest(p_receipts->'metadata'),
      'capturedAt',p_receipts#>>'{campaignHours,finishedAt}','complete',true,'paginationComplete',true,
      'verifiedEmpty',source_empty,'rows',campaign_rows,
      'query',jsonb_build_object('since',since_date::text,'until',until_date::text,'timeIncrement',1,
        'breakdown','hourly_stats_aggregated_by_advertiser_time_zone','level','campaign','unfiltered',true)),
    'control',jsonb_build_object('evidenceRef','meta-graph:account:'||lean_private.partition_digest(p_receipts->'accountHours'),
      'approvalRef','meta-source-job:'||p_job::text||':account-control',
      'capturedAt',p_receipts#>>'{accountHours,finishedAt}','independentlyExtracted',true,'complete',true,
      'paginationComplete',true,'verifiedEmpty',control_empty,'rows',account_rows,
      'query',jsonb_build_object('since',since_date::text,'until',until_date::text,'timeIncrement',1,
        'breakdown','hourly_stats_aggregated_by_advertiser_time_zone','level','account','unfiltered',true)));
  if p_packet is distinct from expected_packet or
    (p_packet#>>'{window,fromAt}')::timestamptz is distinct from from_at or
    (p_packet#>>'{window,untilAt}')::timestamptz is distinct from until_at
    then raise exception 'Meta source packet correspondence'; end if;
  perform public.lean_marketing_spend_hourly_register(p_packet);
  select * into strict d from lean_private.marketing_spend_days where generation_id=generation for share;
  if d.enabled or d.packet is distinct from p_packet or
    d.packet_hash<>encode(sha256(convert_to(d.packet::text,'UTF8')),'hex') or
    clock_timestamp()>=j.started_at+interval '90 seconds'
    then raise exception 'Meta source persistence readback'; end if;
  update public.job_runs set meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object(
    'meta_source_registered',true,'meta_source_receipts',p_receipts,'report_date',report_date::text,
    'generationId',generation,'packetHash',d.packet_hash,'source_requests',3) where id=p_job;
  return jsonb_build_object('state','source_registered','generationId',generation,'enabled',false,
    'packetHash',d.packet_hash,'packetHashValid',true,'packet',d.packet,'readCapturedAt',clock_timestamp());
end $body$;

revoke all on function public.lean_meta_source_register(bigint,jsonb,jsonb,text) from public,anon,authenticated,service_role;
do $acl$
declare a record;
begin
  for a in select x.grantee from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
    where p.oid='public.lean_meta_source_register(bigint,jsonb,jsonb,text)'::regprocedure and x.grantee<>p.proowner loop
    execute format('revoke all on function public.lean_meta_source_register(bigint,jsonb,jsonb,text) from %s',
      case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end);
  end loop;
end $acl$;
grant execute on function public.lean_meta_source_register(bigint,jsonb,jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
