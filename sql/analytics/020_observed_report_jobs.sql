-- REVIEW ONLY. Requires 001/013/014/018/019. No source/job/reader is activated.
begin;
create table lean_private.report_builds (
  run_id text primary key check(length(run_id) between 1 and 128),
  project_ref text not null check(project_ref ~ '^[a-z]{20}$'),
  shop text not null check(shop ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  history_runs text[] not null check(cardinality(history_runs) between 1 and 5),
  spend_runs text[] not null default '{}' check(cardinality(spend_runs)<=100),
  from_date date not null, through_date date not null,
  policy jsonb not null check(jsonb_typeof(policy)='object'),
  approval_ref text not null check(length(trim(approval_ref))>0),
  actor_ref text not null check(length(trim(actor_ref))>0),
  enabled boolean not null default false,
  completed_at timestamptz, result_hash text,
  check(isfinite(from_date) and isfinite(through_date) and through_date-from_date between 0 and 30),
  check((completed_at is null)=(result_hash is null))
);
alter table lean_private.report_builds enable row level security;
revoke all on lean_private.report_builds from public,anon,authenticated,service_role;
create function lean_private.report_scope_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if (to_jsonb(old)-array['enabled','completed_at','result_hash']) is distinct from
     (to_jsonb(new)-array['enabled','completed_at','result_hash']) or old.completed_at is not null and
     (old.result_hash,old.completed_at) is distinct from (new.result_hash,new.completed_at) then
    raise exception 'report scope/result immutable';
  end if;
  return new;
end $$;
create trigger immutable_report_scope before update on lean_private.report_builds
  for each row execute function lean_private.report_scope_immutable();
create function public.lean_report_inputs(p_run text,p_project_ref text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.report_builds; h lean_private.history_jobs; s lean_private.spend_jobs;
  id text; history jsonb := '[]'; spend jsonb := '[]'; input jsonb; pages integer := 0; rows integer := 0;
begin
  select * into r from lean_private.report_builds where run_id=p_run and project_ref=p_project_ref;
  if not found then raise exception 'unapproved report target'; end if;
  if not r.enabled then return jsonb_build_object('state','disabled'); end if;
  if r.completed_at is not null then return jsonb_build_object('state','complete'); end if;
  if cardinality(r.history_runs)<>(select count(distinct x) from unnest(r.history_runs) x) or
     cardinality(r.spend_runs)<>(select count(distinct x) from unnest(r.spend_runs) x)
    then raise exception 'duplicate source run'; end if;
  foreach id in array r.history_runs loop
    select * into h from lean_private.history_jobs
      where run_id=id and project_ref=r.project_ref and shop=r.shop;
    if not found or not h.enabled or not h.complete then return jsonb_build_object('state','blocked'); end if;
    pages := pages+h.page_count; rows := rows+h.row_count;
    if pages>25 or rows>100 then raise exception 'report source budget'; end if;
    select history || coalesce(jsonb_agg(jsonb_build_object('source',x.value->'source',
      'evidenceRef','lean_private.history_pages/'||id||'/'||p.page_number)
      order by p.page_number,x.ordinality),'[]'::jsonb) into history
      from lean_private.history_pages p cross join lateral jsonb_array_elements(p.rows) with ordinality x
      where p.run_id=id;
  end loop;
  foreach id in array r.spend_runs loop
    select * into s from lean_private.spend_jobs where run_id=id and project_ref=r.project_ref;
    if not found or not s.enabled or s.base is null then return jsonb_build_object('state','blocked'); end if;
    if s.report_date<r.from_date or s.report_date>r.through_date then raise exception 'spend outside report dates'; end if;
    spend := spend || jsonb_build_array(s.base);
  end loop;
  if (select coalesce(sum(jsonb_array_length(b->'rows')),0) from jsonb_array_elements(spend) b)>10000
    then raise exception 'report spend budget'; end if;
  input := jsonb_build_object('state','ready','shop',r.shop,'publication','observed:'||r.run_id,
    'fromDate',r.from_date,'throughDate',r.through_date,'policy',r.policy,'history',history,'spend',spend);
  if octet_length(input::text)>5000000 then raise exception 'report input budget'; end if;
  return input || jsonb_build_object('inputHash',md5(input::text));
end $$;
create function public.lean_report_finish(p_run text,p_project_ref text,p_input_hash text,p_facts jsonb,p_reports jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.report_builds; input jsonb; pub text; t text; item jsonb; hash text;
  fact_names text[] := array['customers','identity_map','orders','order_items','sales_ledger','payments',
    'order_item_offers','sessions','marketing_spend_daily','order_attribution'];
  report_names text[] := array['store_daily','product_daily','acquisition_daily'];
begin
  select * into r from lean_private.report_builds where run_id=p_run and project_ref=p_project_ref for update;
  if not found or not r.enabled then return false; end if;
  if p_facts is null or jsonb_typeof(p_facts)<>'object' or p_reports is null or jsonb_typeof(p_reports)<>'object'
    or octet_length(p_facts::text)+octet_length(p_reports::text)>16000000 then raise exception 'invalid report batch'; end if;
  hash := md5(p_facts::text||p_reports::text);
  if r.completed_at is not null then
    if r.result_hash is distinct from hash then raise exception 'completed report immutable'; end if;
    return true;
  end if;
  -- Pin dependencies until the transaction completes (including the kill switch).
  perform 1 from lean_private.history_jobs where run_id=any(r.history_runs) order by run_id for share;
  perform 1 from lean_private.spend_jobs where run_id=any(r.spend_runs) order by run_id for share;
  input := public.lean_report_inputs(p_run,p_project_ref);
  if input->>'state'<>'ready' or input->>'inputHash' is distinct from p_input_hash then return false; end if;
  pub := 'observed:'||p_run;
  if (select count(*) from jsonb_object_keys(p_facts))<>10 or
    (select count(*) from jsonb_object_keys(p_reports))<>3 then raise exception 'invalid report domains'; end if;
  foreach t in array array['customers','identity_map','order_item_offers','sessions','order_attribution'] loop
    if p_facts->t is distinct from '[]'::jsonb then raise exception 'unproven report domain'; end if;
  end loop;
  insert into lean_private.publications(publication_id,contract_version)
    values(pub,'lean-v1-draft.1');
  foreach t in array fact_names loop
    if jsonb_typeof(p_facts->t) is distinct from 'array' or jsonb_array_length(p_facts->t)>100000
      then raise exception 'invalid fact batch'; end if;
    for item in select value from jsonb_array_elements(p_facts->t) loop
      if item->>'publication_id' is distinct from pub then raise exception 'mixed fact publication'; end if;
      if t='orders' and (item->>'shop_id' is distinct from r.shop or item->'customer_id' is distinct from 'null'::jsonb)
        then raise exception 'mixed shop or unproven identity'; end if;
      if t='payments' and (item->'cash_eligible' is distinct from 'false'::jsonb or
        item->'cash_amount_usd' is distinct from 'null'::jsonb) then raise exception 'unproven settlement'; end if;
    end loop;
    execute format('insert into lean_private.%I select * from jsonb_populate_recordset(null::lean_private.%I,$1)',t,t)
      using p_facts->t;
  end loop;
  foreach t in array report_names loop
    if jsonb_typeof(p_reports->t) is distinct from 'array' or jsonb_array_length(p_reports->t)>20000
      then raise exception 'invalid report rows'; end if;
    for item in select value from jsonb_array_elements(p_reports->t) loop
      if item->>'publication_id' is distinct from pub or item->>'shop_id' is distinct from r.shop or
        item->>'definition_version' is distinct from 'observed-sources-v1' or
        item->'is_stale' is distinct from 'true'::jsonb or
        (item->>'report_date')::date not between r.from_date and r.through_date or
        jsonb_typeof(item->'readiness') is distinct from 'object' then raise exception 'invalid observed report'; end if;
      if exists(select 1 from jsonb_each_text(item->'readiness') v where v.value not in ('withheld','observed_unverified'))
        then raise exception 'uncertified readiness'; end if;
      if t='store_daily' and (item->'collected_cash_usd' is distinct from 'null'::jsonb or
        item->'new_customers' is distinct from 'null'::jsonb or item->'mer' is distinct from 'null'::jsonb or
        item->'ncac_usd' is distinct from 'null'::jsonb) then raise exception 'unproven store comparison'; end if;
      if t='acquisition_daily' and (item->'attributed_purchase_merchandise_net_usd' is distinct from 'null'::jsonb or
        item->'credited_orders' is distinct from 'null'::jsonb or item->'weighted_new_customers' is distinct from 'null'::jsonb or
        item->'first_party_roas' is distinct from 'null'::jsonb or item->'ncac_usd' is distinct from 'null'::jsonb)
        then raise exception 'unproven attribution'; end if;
    end loop;
    execute format('insert into lean_private.%I select * from jsonb_populate_recordset(null::lean_private.%I,$1)',
      'report_'||t,'report_'||t) using p_reports->t;
  end loop;
  update lean_private.report_builds set completed_at=clock_timestamp(),result_hash=hash where run_id=p_run;
  -- Candidate only: no certifications, reader grants, or selected-pointer changes.
  return true;
end $$;
revoke all on function public.lean_report_inputs(text,text) from public,anon,authenticated,service_role;
revoke all on function public.lean_report_finish(text,text,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.lean_report_inputs(text,text) to service_role;
grant execute on function public.lean_report_finish(text,text,text,jsonb,jsonb) to service_role;
commit;
