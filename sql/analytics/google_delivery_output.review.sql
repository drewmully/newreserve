-- PRIVATE REVIEW ONLY. Additive optional output, not a sixth default workbook
-- family. Requires current 021/026/029/053 and any installed privacy/partition
-- wrappers. No existing public function is renamed/replaced, no scope is seeded.
begin;
create function lean_private.google_delivery_row_valid(r jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare k text; metrics text[]:=array['spend_usd','clicks','impressions','ctr','cpc_usd','cpm_usd'];
begin
  if jsonb_typeof(r) is distinct from 'object' or
    not(r ?& (array['shop_id','publication_id','definition_version','report_scope','provider','account_id',
      'report_date','source_currency','source_timezone','click_definition','as_of_at','is_stale','readiness']||metrics)) or
    r-(array['shop_id','publication_id','definition_version','report_scope','provider','account_id',
      'report_date','source_currency','source_timezone','click_definition','as_of_at','is_stale','readiness']||metrics)<>'{}' or
    exists(select 1 from unnest(array['shop_id','publication_id','definition_version','report_scope','provider',
      'account_id','report_date','source_currency','source_timezone','click_definition','as_of_at']) field
      where jsonb_typeof(r->field) is distinct from 'string') or
    r->>'definition_version' is distinct from 'google-account-daily-v1' or
    r->>'report_scope' is distinct from 'single_google_account' or r->>'provider' is distinct from 'google_ads' or
    r->>'source_currency' is distinct from 'USD' or r->>'source_timezone' is distinct from 'America/New_York' or
    r->>'click_definition' is distinct from 'google_ads.metrics.clicks' or
    coalesce(r->>'account_id','') !~ '^[0-9]{10}$' or
    coalesce(r->>'shop_id','') !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' or
    coalesce(r->>'publication_id','') !~ '^full:[A-Za-z0-9_-]{1,100}$' or
    coalesce(r->>'report_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or
    (r->>'report_date')::date::text<>r->>'report_date' or
    coalesce(r->>'as_of_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$' or
    not isfinite((r->>'as_of_at')::timestamptz) or r->'is_stale' is distinct from 'true'::jsonb or
    jsonb_typeof(r->'readiness') is distinct from 'object' or
    not((r->'readiness') ?& metrics) or (r->'readiness')-metrics<>'{}'
    then return false; end if;
  foreach k in array metrics loop
    if r->k='null'::jsonb then
      if r->'readiness'->>k is distinct from 'withheld' then return false; end if;
    elsif jsonb_typeof(r->k) is distinct from 'string' or
      r->'readiness'->>k is distinct from 'observed_unverified' then return false;
    elsif k in ('clicks','impressions') then
      if r->>k !~ '^(0|[1-9][0-9]{0,15})$' or (r->>k)::numeric>9007199254740991 then return false; end if;
    elsif r->>k !~ '^(0|[1-9][0-9]{0,13})\.[0-9]{6}$' then return false;
    end if;
  end loop;
  return true;
exception when others then return false;
end $$;

create table lean_private.report_google_account_daily (
  run_id text primary key references lean_private.full_builds,
  project_ref text not null,
  input_hash text not null,
  full_result_hash text not null,
  row_hash text not null check(row_hash ~ '^[a-f0-9]{32}$'),
  report jsonb not null check(lean_private.google_delivery_row_valid(report)),
  created_at timestamptz not null default clock_timestamp(),
  check(row_hash=md5(report::text))
);
alter table lean_private.report_google_account_daily enable row level security;
create function lean_private.google_delivery_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin raise exception 'Google optional result immutable'; end $$;
create trigger immutable_google_delivery before update or delete on lean_private.report_google_account_daily
for each row execute function lean_private.google_delivery_immutable();

-- Deferred guard prevents a caller using the old finish RPC from silently
-- completing a bound run without its optional row. The atomic wrapper below
-- inserts it before commit. Unbound generations are untouched.
create function lean_private.google_delivery_complete_guard() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if new.completed_at is not null and new.policy ? 'googleDelivery' and not exists(
    select 1 from lean_private.report_google_account_daily g
      where g.run_id=new.run_id and g.project_ref=new.project_ref and g.full_result_hash=new.result_hash)
    then raise exception 'bound Google output must commit with full result'; end if;
  return null;
end $$;
create constraint trigger google_delivery_complete_guard after insert or update on lean_private.full_builds
deferrable initially deferred for each row execute function lean_private.google_delivery_complete_guard();

create function public.lean_google_delivery_finish(p_run text,p_project_ref text,p_token uuid,p_input_hash text,
  p_facts jsonb,p_reports jsonb,p_manifest jsonb,p_google_report jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare f lean_private.full_builds; b lean_private.report_builds; g lean_private.report_google_account_daily;
  input jsonb; binding jsonb; done boolean; hash text;
begin
  if current_setting('transaction_isolation')<>'read committed' then return false; end if;
  lock table lean_private.selected_publications in share mode;
  select x.* into f from lean_private.full_builds x where x.run_id=p_run and x.project_ref=p_project_ref for update;
  if not found or not f.enabled then return false; end if;
  select x.* into strict b from lean_private.report_builds x where x.run_id=f.base_run and x.project_ref=p_project_ref for share;
  binding:=f.policy->'googleDelivery';
  if not b.enabled or b.completed_at is null or jsonb_typeof(binding) is distinct from 'object' or
    binding->'version' is distinct from '1'::jsonb or
    binding->>'definitionVersion' is distinct from 'google-account-daily-v1' or
    coalesce(length(trim(binding->>'approvalRef')),0)=0 or
    not(f.policy ? 'freshGoogleSpend') or not lean_private.google_delivery_row_valid(p_google_report) or
    p_google_report->>'publication_id' is distinct from 'full:'||p_run or
    p_google_report->>'shop_id' is distinct from b.shop or
    p_google_report->>'account_id' is distinct from binding->>'accountId' or
    p_google_report->>'report_date' is distinct from binding->>'date' or
    p_google_report->>'report_date' is distinct from b.from_date::text or b.from_date<>b.through_date or
    p_google_report->>'as_of_at' is distinct from f.policy->>'asOf' or
    f.policy#>>'{freshGoogleSpend,manifest,accountId}' is distinct from binding->>'accountId'
    then raise exception 'Google finish binding mismatch'; end if;
  hash:=md5(p_google_report::text);
  if f.completed_at is not null then
    select x.* into g from lean_private.report_google_account_daily x where x.run_id=p_run;
    if not found or g.full_result_hash<>f.result_hash or g.input_hash is distinct from p_input_hash or
      g.row_hash<>hash or g.report is distinct from p_google_report
      then raise exception 'completed Google result immutable'; end if;
  else
    -- Calls CURRENT input, including native source and customer/privacy wrappers.
    input:=public.lean_full_inputs(p_run,p_project_ref);
    if input->>'state' is distinct from 'ready' or input->>'inputHash' is distinct from p_input_hash or
      not(input ? 'freshGoogleSpend') then return false; end if;
  end if;
  -- Never call historical aliases. Both writes belong to this transaction.
  done:=public.lean_full_finish(p_run,p_project_ref,p_token,p_input_hash,p_facts,p_reports,p_manifest);
  if not done then return false; end if;
  if f.completed_at is null then
    select x.* into strict f from lean_private.full_builds x where x.run_id=p_run;
    insert into lean_private.report_google_account_daily(run_id,project_ref,input_hash,full_result_hash,row_hash,report)
      values(p_run,p_project_ref,p_input_hash,f.result_hash,hash,p_google_report);
  end if;
  return true;
end $$;

create table lean_private.google_delivery_selection (
  singleton boolean primary key default true check(singleton),
  revision bigint not null check(revision>0),
  enabled boolean not null default false,
  run_id text not null references lean_private.report_google_account_daily,
  project_ref text not null, full_result_hash text not null, row_hash text not null,
  account_id text not null check(account_id ~ '^[0-9]{10}$'), report_date date not null,
  approval_ref text not null check(length(trim(approval_ref)) between 1 and 512),
  reconciliation_ref text not null check(length(trim(reconciliation_ref)) between 1 and 512),
  not_before timestamptz not null, expires_at timestamptz not null,
  is_stale boolean not null default true,
  check(isfinite(not_before) and isfinite(expires_at) and expires_at>not_before and
    expires_at<=not_before+interval '1 hour')
);
alter table lean_private.google_delivery_selection enable row level security;
create function lean_private.google_delivery_selection_lock() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin lock table lean_private.selected_publications in share row exclusive mode; return null; end $$;
create trigger google_delivery_selection_lock before insert or update or delete
on lean_private.google_delivery_selection for each statement execute function lean_private.google_delivery_selection_lock();

-- Owner-only CAS prepares a DISABLED selection. Separate approval/enablement is
-- required; no existing workbook/observed pointer or import source is changed.
create function public.lean_google_delivery_select(p_run text,p_project_ref text,p_result_hash text,p_row_hash text,
  p_expected_revision bigint,p_approval text,p_reconciliation text,p_not_before timestamptz,
  p_expires_at timestamptz,p_is_stale boolean)
returns bigint language plpgsql security definer set search_path=pg_catalog as $$
declare f lean_private.full_builds; g lean_private.report_google_account_daily; rev bigint;
begin
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'read committed required'; end if;
  lock table lean_private.selected_publications in share row exclusive mode;
  select s.revision into rev from lean_private.google_delivery_selection s where s.singleton for update;
  rev:=coalesce(rev,0);
  if rev is distinct from p_expected_revision then raise exception 'Google selection changed'; end if;
  select x.* into strict f from lean_private.full_builds x where x.run_id=p_run and x.project_ref=p_project_ref for share;
  select x.* into strict g from lean_private.report_google_account_daily x where x.run_id=p_run for share;
  if not f.enabled or f.completed_at is null or f.result_hash is distinct from p_result_hash or
    g.full_result_hash is distinct from p_result_hash or g.row_hash is distinct from p_row_hash or
    g.project_ref<>p_project_ref or p_expires_at<=clock_timestamp() or
    (f.policy->>'asOf')::timestamptz>clock_timestamp()
    then raise exception 'Google selection result mismatch'; end if;
  if f.policy ? 'customerGeneration' then
    perform lean_private.customer_generation_full_check(p_run,p_project_ref,false);
  end if;
  if exists(select 1 from lean_private.journey_removals j where j.downstream_verified_at is null or
    j.requested_at>(f.policy->>'asOf')::timestamptz) then raise exception 'current removal gate'; end if;
  insert into lean_private.google_delivery_selection(singleton,revision,enabled,run_id,project_ref,full_result_hash,
    row_hash,account_id,report_date,approval_ref,reconciliation_ref,not_before,expires_at,is_stale)
    values(true,rev+1,false,p_run,p_project_ref,p_result_hash,p_row_hash,g.report->>'account_id',
      (g.report->>'report_date')::date,p_approval,p_reconciliation,p_not_before,p_expires_at,p_is_stale)
    on conflict(singleton) do update set revision=excluded.revision,enabled=false,run_id=excluded.run_id,
      project_ref=excluded.project_ref,full_result_hash=excluded.full_result_hash,row_hash=excluded.row_hash,
      account_id=excluded.account_id,report_date=excluded.report_date,approval_ref=excluded.approval_ref,
      reconciliation_ref=excluded.reconciliation_ref,not_before=excluded.not_before,expires_at=excluded.expires_at,
      is_stale=excluded.is_stale;
  return rev+1;
end $$;

create function public.lean_google_delivery_read(p_project_ref text,p_run text,p_result_hash text,p_account_id text,p_date text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s lean_private.google_delivery_selection; f lean_private.full_builds; g lean_private.report_google_account_daily;
  row jsonb; ready jsonb;
begin
  if current_setting('transaction_isolation')<>'read committed' then return null; end if;
  lock table lean_private.selected_publications in share mode;
  select x.* into s from lean_private.google_delivery_selection x where x.singleton and x.enabled for share;
  if not found or (s.project_ref,s.run_id,s.full_result_hash,s.account_id,s.report_date::text) is distinct from
    (p_project_ref,p_run,p_result_hash,p_account_id,p_date) or
    clock_timestamp()<s.not_before or clock_timestamp()>=s.expires_at then return null; end if;
  select x.* into f from lean_private.full_builds x where x.run_id=s.run_id and x.project_ref=s.project_ref for share;
  if not found or not f.enabled or f.completed_at is null or f.result_hash<>s.full_result_hash or
    (f.policy->>'asOf')::timestamptz>clock_timestamp() then return null; end if;
  select x.* into g from lean_private.report_google_account_daily x where x.run_id=s.run_id for share;
  if not found or (g.project_ref,g.full_result_hash,g.row_hash) is distinct from
    (s.project_ref,s.full_result_hash,s.row_hash) then return null; end if;
  if f.policy ? 'customerGeneration' then
    perform lean_private.customer_generation_full_check(s.run_id,s.project_ref,false);
  end if;
  if exists(select 1 from lean_private.journey_removals j where j.downstream_verified_at is null or
    j.requested_at>(f.policy->>'asOf')::timestamptz) then return null; end if;
  select jsonb_object_agg(k,case when v='observed_unverified' then 'ready' else v end) into ready
    from jsonb_each_text(g.report->'readiness') as fields(k,v);
  row:=g.report||jsonb_build_object('is_stale',s.is_stale,'readiness',ready);
  if clock_timestamp()>=s.expires_at then return null; end if;
  return jsonb_build_object('google_account_daily',jsonb_build_array(row),
    'google_delivery_status',jsonb_build_object('state','selected','report_scope','single_google_account',
      'run_id',s.run_id,'result_hash',s.full_result_hash,'row_hash',s.row_hash,'selection_revision',s.revision::text,
      'row_count','1','atomic_resource_refresh',false,
      'not_before',to_char(s.not_before at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'expires_at',to_char(s.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
end $$;

revoke all on lean_private.report_google_account_daily,lean_private.google_delivery_selection
  from public,anon,authenticated,service_role,lean_posthog_reader;
revoke all on function lean_private.google_delivery_row_valid(jsonb),lean_private.google_delivery_immutable(),
  lean_private.google_delivery_complete_guard(),lean_private.google_delivery_selection_lock(),
  public.lean_google_delivery_finish(text,text,uuid,text,jsonb,jsonb,jsonb,jsonb),
  public.lean_google_delivery_select(text,text,text,text,bigint,text,text,timestamptz,timestamptz,boolean),
  public.lean_google_delivery_read(text,text,text,text,text)
  from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_google_delivery_finish(text,text,uuid,text,jsonb,jsonb,jsonb,jsonb),
  public.lean_google_delivery_read(text,text,text,text,text) to service_role;
commit;
