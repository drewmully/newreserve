-- PRIVATE v1. Empty/default-off OWNER authority for a distinct terminal reason.
-- Requires017/047/052 and exact throughput6b127. Does not change either source file.
-- Health and throughput_step are explicit body amendments; old approval pins
-- cannot be reused for a future guarded install or operator package.
begin;
create table lean_private.pipeline_annual_access_rules (
  rule_id text primary key check(length(trim(rule_id)) between 1 and 150),
  project_ref text not null check(project_ref='xnfjdbpjuaezxjgargto'),
  shop text not null check(shop='mullybox-store.myshopify.com'),
  scope_sha256 text not null check(scope_sha256='799209cbd0913f5257afaabefc478ec7e402640b4ac5c30e5f9ee81eeee30689'),
  excluded_product_id text not null check(excluded_product_id='8501257175232'),
  approval_ref text not null check(length(trim(approval_ref))>0),
  actor_ref text not null check(length(trim(actor_ref))>0),
  enabled boolean not null default false,
  not_before timestamptz not null, expires_at timestamptz not null,
  check(isfinite(not_before) and isfinite(expires_at) and not_before<expires_at and
    expires_at-not_before<=interval '7 days')
);
create unique index pipeline_annual_access_one_enabled
  on lean_private.pipeline_annual_access_rules(project_ref,shop) where enabled;
alter table lean_private.pipeline_annual_access_rules enable row level security;
revoke all on lean_private.pipeline_annual_access_rules from public,anon,authenticated,service_role;
create function lean_private.pipeline_annual_access_rule_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' or (to_jsonb(old)-'enabled') is distinct from (to_jsonb(new)-'enabled') or
    (not old.enabled and new.enabled) then raise exception 'annual exclusion authority immutable'; end if;
  return new;
end $$;
create trigger immutable_pipeline_annual_access_rule before update or delete
  on lean_private.pipeline_annual_access_rules for each row
  execute function lean_private.pipeline_annual_access_rule_immutable();

create function public.lean_pipeline_exclude_annual_access(p_work_id bigint,p_token uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare
  w lean_private.work; s lean_private.pipeline_snapshots; r lean_private.receipts;
  rule lean_private.pipeline_annual_access_rules; cfg lean_private.pipeline_scope;
  created timestamptz; revised timestamptz; event_time timestamptz;
  gid text; expected text; refund_id text; refund jsonb; k text; t text; occupied boolean;
  lines jsonb; line jsonb; ids text[]:=array[]::text[];
  clock_pattern constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$';
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'annual exclusion requires current statement snapshots'; end if;
  -- An old business exclusion is not activation of this new terminal operation.
  select * into rule from lean_private.pipeline_annual_access_rules where
    project_ref='xnfjdbpjuaezxjgargto' and shop='mullybox-store.myshopify.com' and enabled and
    not_before<=clock_timestamp() and expires_at>clock_timestamp() for share;
  if not found then return false; end if;
  -- Same scope-before-work order as017/052. This also fences concurrent head changes.
  select c.* into cfg from lean_private.pipeline_scope c join lean_private.pipeline_snapshots x on x.shop=c.shop
    where x.work_id=p_work_id and c.shop=rule.shop and c.project_ref=rule.project_ref and c.enabled for update of c;
  if not found then return false; end if;
  if encode(sha256(convert_to(jsonb_build_object('shop',cfg.shop,'project',cfg.project_ref,'policy',cfg.policy,
    'from',to_char(cfg.from_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'until',to_char(cfg.until_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'UTF8')),'hex')
      is distinct from rule.scope_sha256 then raise exception 'annual exclusion scope changed'; end if;
  select * into w from lean_private.work where work_id=p_work_id for update;
  if not found or p_token is null or w.state<>'leased' or w.lease_token is distinct from p_token::text or
    w.lease_until is null or w.lease_until<=clock_timestamp() then return false; end if;
  select * into strict s from lean_private.pipeline_snapshots where work_id=p_work_id;
  select * into strict r from lean_private.receipts where receipt_id=w.receipt_id;
  if s.policy is distinct from cfg.policy or s.from_time is distinct from cfg.from_time or
    s.until_time is distinct from cfg.until_time or s.shop<>rule.shop then
    raise exception 'annual exclusion frozen authority changed'; end if;
  if jsonb_typeof(s.source) is distinct from 'object' or
    jsonb_typeof(s.source->'commerce') is distinct from 'object' or
    jsonb_typeof(s.source#>'{commerce,order}') is distinct from 'object' or
    jsonb_typeof(s.source->'financial') is distinct from 'object' or
    jsonb_typeof(s.source->'refunds') is distinct from 'array' or
    s.source#>>'{commerce,shop}' is distinct from s.shop or
    s.source#>>'{commerce,apiVersion}' is distinct from '2026-07' or
    s.source#>'{commerce,projection}' is distinct from s.policy->'sourceProjection' or
    s.source#>>'{commerce,projection}' is distinct from 'financial_no_geo_order_size' or
    s.policy->>'sourceRetention' is distinct from 'financial_allowlist_v1' or
    s.policy->>'retainedReports' is distinct from 'product-v1' then
    raise exception 'annual exclusion source scope'; end if;
  gid:=s.source#>>'{commerce,order,id}';
  if gid is null or gid !~ '^gid://shopify/Order/[1-9][0-9]*$' or gid is distinct from s.order_gid or
    s.source#>>'{financial,id}' is distinct from gid or
    s.source#>'{financial,updatedAt}' is distinct from s.source#>'{commerce,order,updatedAt}' then
    raise exception 'annual exclusion source identity'; end if;
  foreach k in array array['createdAt','updatedAt'] loop
    if jsonb_typeof(s.source#>array['commerce','order',k]) is distinct from 'string' or
      (s.source#>>array['commerce','order',k]) !~ clock_pattern then
      raise exception 'annual exclusion source clock'; end if;
  end loop;
  created:=(s.source#>>'{commerce,order,createdAt}')::timestamptz;
  revised:=(s.source#>>'{commerce,order,updatedAt}')::timestamptz;
  if not isfinite(created) or not isfinite(revised) or revised<created or revised is distinct from s.revision or
    created<s.from_time or created>=s.until_time then raise exception 'annual exclusion frozen window'; end if;
  if s.source#>'{commerce,order,edited}' is distinct from 'false'::jsonb or
    jsonb_typeof(s.source#>'{commerce,order,lineItems}') is distinct from 'object' or
    jsonb_typeof(s.source#>'{commerce,order,lineItems,pageInfo}') is distinct from 'object' or
    s.source#>'{commerce,order,lineItems,pageInfo,hasNextPage}' is distinct from 'false'::jsonb or
    jsonb_typeof(s.source#>'{commerce,order,lineItems,nodes}') is distinct from 'array' then
    raise exception 'annual exclusion needs complete unedited lines'; end if;
  lines:=s.source#>'{commerce,order,lineItems,nodes}';
  if jsonb_array_length(lines) not between 1 and 100 then raise exception 'annual exclusion line count'; end if;
  for line in select value from jsonb_array_elements(lines) loop
    if jsonb_typeof(line) is distinct from 'object' or
      jsonb_typeof(line->'id') is distinct from 'string' or line->>'id' !~ '^gid://shopify/LineItem/[1-9][0-9]*$' or
      (line->>'id')=any(ids) or jsonb_typeof(line->'product') is distinct from 'object' or
      line#>>'{product,id}' is distinct from ('gid://shopify/Product/'||rule.excluded_product_id) or
      line->'isGiftCard' is distinct from 'false'::jsonb or jsonb_typeof(line->'quantity') is distinct from 'number' then
      raise exception 'annual exclusion unknown mixed or malformed line'; end if;
    if (line->>'quantity')::numeric<=0 or (line->>'quantity')::numeric>9007199254740991 or
      trunc((line->>'quantity')::numeric)<>(line->>'quantity')::numeric then
      raise exception 'annual exclusion invalid quantity'; end if;
    ids:=array_append(ids,line->>'id');
  end loop;
  if r.source<>'shopify' or r.topic not in ('orders/paid','orders/updated','orders/cancelled','refunds/create') or
    jsonb_typeof(r.payload) is distinct from 'object' or
    lean_private.receipt_shop(r.business_key) is distinct from s.shop or
    r.business_key::jsonb is distinct from jsonb_build_array(s.shop,coalesce(r.payload->>'admin_graphql_api_id',r.payload->>'id')) then
    raise exception 'annual exclusion receipt'; end if;
  foreach k in array array['id','admin_graphql_api_id']||
    case when r.topic='refunds/create' then array['order_id'] else array[]::text[] end loop
    if (k='order_id' and not r.payload ? k) or (r.payload ? k and not coalesce(case
      when jsonb_typeof(r.payload->k)='number' then (r.payload->>k)::numeric>0 and
        (r.payload->>k)::numeric<=9007199254740991 and trunc((r.payload->>k)::numeric)=(r.payload->>k)::numeric
      when jsonb_typeof(r.payload->k)='string' then length(r.payload->>k)<200 and
        ((r.payload->>k) ~ '^[1-9][0-9]*$' or (r.payload->>k) ~ ('^gid://shopify/'||
          case when k='order_id' or r.topic<>'refunds/create' then 'Order' else 'Refund' end||'/[1-9][0-9]*$'))
      else false end,false)) then raise exception 'annual exclusion invalid receipt identifier'; end if;
  end loop;
  expected:=case when r.topic='refunds/create' then r.payload->>'order_id'
    else coalesce(r.payload->>'admin_graphql_api_id',r.payload->>'id') end;
  if expected ~ '^[1-9][0-9]*$' then expected:='gid://shopify/Order/'||expected; end if;
  if expected is distinct from gid then raise exception 'annual exclusion receipt order'; end if;
  foreach k in array array['created_at','updated_at'] loop
    if r.payload ? k then
      if jsonb_typeof(r.payload->k) is distinct from 'string' or (r.payload->>k) !~ clock_pattern then
        raise exception 'annual exclusion receipt clock'; end if;
      event_time:=(r.payload->>k)::timestamptz;
      if not isfinite(event_time) then raise exception 'annual exclusion receipt clock'; end if;
    end if;
  end loop;
  if r.topic='refunds/create' then
    refund_id:=coalesce(r.payload->>'admin_graphql_api_id',r.payload->>'id');
    if refund_id ~ '^[1-9][0-9]*$' then refund_id:='gid://shopify/Refund/'||refund_id; end if;
    if refund_id is null or refund_id !~ '^gid://shopify/Refund/[1-9][0-9]*$' or
      (select count(*) from jsonb_array_elements(s.source->'refunds') x where x->>'id'=refund_id)<>1 then
      raise exception 'annual exclusion refund not visible'; end if;
    select x into refund from jsonb_array_elements(s.source->'refunds') x where x->>'id'=refund_id;
    if refund#>>'{order,id}' is distinct from gid or jsonb_typeof(refund->'updatedAt') is distinct from 'string' or
      (refund->>'updatedAt') !~ clock_pattern then raise exception 'annual exclusion refund lineage'; end if;
    event_time:=(refund->>'updatedAt')::timestamptz;
    if not isfinite(event_time) or
      (coalesce(r.payload->>'updated_at',r.payload->>'created_at') is not null and
       event_time<coalesce(r.payload->>'updated_at',r.payload->>'created_at')::timestamptz) then
      raise exception 'annual exclusion refund behind event'; end if;
  elsif r.payload ? 'updated_at' and revised<(r.payload->>'updated_at')::timestamptz then
    raise exception 'annual exclusion source behind event';
  end if;
  -- Never leave an earlier merchandise head current after excluding a correction.
  if exists(select 1 from lean_private.pipeline_heads where shop=s.shop and order_gid=gid) then
    raise exception 'annual exclusion existing order head'; end if;
  perform 1 from lean_private.publications where publication_id=s.publication_id and state='candidate' for share;
  if not found then raise exception 'annual exclusion requires candidate'; end if;
  foreach t in array array['customers','identity_map','orders','order_items','sales_ledger','payments',
    'sessions','marketing_spend_daily','order_attribution','order_item_offers','coverage','certifications',
    'selected_publications','report_store_daily','report_product_daily','report_acquisition_daily',
    'report_customer_cohorts','report_funnel_daily'] loop
    execute format('select exists(select 1 from lean_private.%I where publication_id=$1)',t)
      into occupied using s.publication_id;
    if occupied then raise exception 'annual exclusion publication materialized'; end if;
  end loop;
  if exists(select 1 from lean_private.projections where receipt_id=w.receipt_id) then
    raise exception 'annual exclusion already projected'; end if;
  if clock_timestamp()>=rule.expires_at then return false; end if;
  update lean_private.work set state='done',last_error_code='excluded_annual_access',
    completed_at=clock_timestamp(),lease_token=null,lease_until=null
    where work_id=p_work_id and state='leased' and lease_token=p_token::text and lease_until>clock_timestamp();
  if not found then return false; end if;
  -- Original source stays byte-unchanged in its snapshot. Audit its digest and
  -- original metadata/work; no copied raw payload or source values are needed.
  insert into lean_private.pipeline_operator_audit(event,work_id,previous_state,approval_ref,actor_ref)
    values('excluded_annual_access',p_work_id,jsonb_build_object(
      'snapshot',to_jsonb(s)-'source','work',to_jsonb(w),
      'retained_source_jsonb_sha256',encode(sha256(convert_to(s.source::text,'UTF8')),'hex'),
      'rule',to_jsonb(rule),'reason','excluded_annual_access'),rule.approval_ref,rule.actor_ref);
  if clock_timestamp()>=rule.expires_at or clock_timestamp()>=w.lease_until then
    raise exception 'annual exclusion deadline after audit'; end if;
  return true;
end $$;

-- New-object ACLs only. Replaced health/throughput functions retain existing OID/ACL.
do $acl$
declare role_name text; p regprocedure;
begin
  foreach p in array array[
    'lean_private.pipeline_annual_access_rule_immutable()'::regprocedure,
    'public.lean_pipeline_exclude_annual_access(bigint,uuid)'::regprocedure] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',p);
    if exists(select 1 from pg_roles where rolname='lean_posthog_reader') then
      execute format('revoke all on function %s from lean_posthog_reader',p);
    end if;
    if exists(select 1 from pg_proc x cross join lateral aclexplode(x.proacl) a
      where x.oid=p::oid and a.grantee<>x.proowner) then raise exception 'annual exclusion function ACL'; end if;
    for role_name in select rolname from pg_roles where rolname in ('anon','authenticated','service_role','lean_posthog_reader') loop
      if has_function_privilege(role_name,p,'EXECUTE') then raise exception 'annual exclusion effective execute'; end if;
    end loop;
  end loop;
  if exists(select 1 from pg_roles where rolname='lean_posthog_reader') then
    revoke all on lean_private.pipeline_annual_access_rules from lean_posthog_reader;
  end if;
  if exists(select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
    where c.oid='lean_private.pipeline_annual_access_rules'::regclass and a.grantee<>c.relowner) then
    raise exception 'annual exclusion rule ACL'; end if;
  for role_name in select rolname from pg_roles where rolname in ('anon','authenticated','service_role','lean_posthog_reader') loop
    if has_table_privilege(role_name,'lean_private.pipeline_annual_access_rules','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or
      has_any_column_privilege(role_name,'lean_private.pipeline_annual_access_rules','SELECT,INSERT,UPDATE,REFERENCES') then
      raise exception 'annual exclusion effective rule privilege'; end if;
  end loop;
end $acl$;
grant execute on function public.lean_pipeline_exclude_annual_access(bigint,uuid) to service_role;

create or replace function public.lean_pipeline_health(p_project_ref text,p_shop text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb; enabled boolean;
begin
  select c.enabled into enabled from lean_private.pipeline_scope c where shop=p_shop and project_ref=p_project_ref;
  if not found then raise exception 'unapproved target'; end if;
  select jsonb_build_object('enabled',enabled,'pending',count(*) filter(where w.state='pending'),
    'leased',count(*) filter(where w.state='leased'),'dead',count(*) filter(where w.state='dead'),
    'done',count(*) filter(where w.state='done'),
    'excluded',count(*) filter(where w.state='done' and w.last_error_code in ('excluded_before_window','excluded_annual_access')),
    'excludedBeforeWindow',count(*) filter(where w.state='done' and w.last_error_code='excluded_before_window'),
    'excludedAnnualAccess',count(*) filter(where w.state='done' and w.last_error_code='excluded_annual_access'),
    'oldestPendingSeconds',coalesce(extract(epoch from clock_timestamp()-min(r.received_at)
      filter(where w.state in ('pending','leased'))),0),
    'expiredLeases',count(*) filter(where w.state='leased' and w.lease_until<=clock_timestamp()))
    into result from lean_private.work w join lean_private.receipts r using(receipt_id)
      where lean_private.receipt_shop(r.business_key)=p_shop;
  return result;
end $$;

create or replace function public.lean_pipeline_throughput_step(
  p_project_ref text,p_shop text,p_token uuid,p_operation text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare g lean_private.pipeline_throughput_grants; cfg lean_private.pipeline_scope;
  r jsonb; ok boolean; work_token uuid; w lean_private.work;
begin
  if current_setting('transaction_isolation')<>'read committed' or p_token is null or
    p_project_ref is distinct from 'xnfjdbpjuaezxjgargto' or p_shop is distinct from 'mullybox-store.myshopify.com' or
    p_args is null or jsonb_typeof(p_args)<>'object'
    then raise exception 'throughput context'; end if;
  select * into g from lean_private.pipeline_throughput_grants
    where project_ref=p_project_ref and shop=p_shop and batch_token=p_token for update;
  if not found or not g.enabled or g.held or clock_timestamp()>=g.batch_deadline or clock_timestamp()>=g.expires_at
    then raise exception 'throughput authority unavailable'; end if;
  select * into cfg from lean_private.pipeline_scope
    where project_ref=p_project_ref and shop=p_shop for share;
  if not found or not cfg.enabled or lean_private.pipeline_throughput_scope_hash() is distinct from g.scope_sha256
    then raise exception 'throughput scope changed'; end if;

  if p_operation='lean_pipeline_claim' then
    if g.current_work_id is not null or g.batch_claims>=g.max_batch_claims or
      g.extra_claims_used>=g.max_extra_claims or
      least(g.max_batch_native_requests-g.batch_native,g.max_native_requests-g.native_permits_used)<8 or
      g.batch_deadline<clock_timestamp()+interval '65 seconds' or
      p_args->>'p_project_ref' is distinct from p_project_ref or p_args->>'p_shop' is distinct from p_shop
      then raise exception 'throughput claim budget'; end if;
    work_token:=(p_args->>'p_token')::uuid;
    r:=public.lean_pipeline_claim(work_token,p_project_ref,p_shop);
    if r->>'state'='claimed' then
      -- Already-claimed snapshots keep their policy. Refuse drift; never reset it.
      if r->'policy' is distinct from cfg.policy or (r->>'fromTime')::timestamptz is distinct from cfg.from_time or
        (r->>'untilTime')::timestamptz is distinct from cfg.until_time
        then raise exception 'throughput frozen policy changed'; end if;
      update lean_private.pipeline_throughput_grants set
        extra_claims_used=extra_claims_used+1,batch_claims=batch_claims+1,
        current_work_id=(r->>'workId')::bigint,current_work_token=work_token,current_work_native=0
        where grant_id=g.grant_id;
    end if;
  elsif p_operation='native_request' then
    if g.current_work_id is null or p_args<>'{}'::jsonb or g.current_work_native>=8 or
      g.batch_native>=g.max_batch_native_requests or g.native_permits_used>=g.max_native_requests
      then raise exception 'throughput source budget'; end if;
    select * into w from lean_private.work where work_id=g.current_work_id;
    if not found or w.state<>'leased' or w.lease_token is distinct from g.current_work_token::text or
      w.lease_until<=clock_timestamp() then raise exception 'throughput work lease'; end if;
    update lean_private.pipeline_throughput_grants set native_permits_used=native_permits_used+1,
      batch_native=batch_native+1,current_work_native=current_work_native+1 where grant_id=g.grant_id;
    r:='true'::jsonb; -- burn one permit BEFORE the one native HTTP request
  else
    if g.current_work_id is null or (p_args->>'p_work_id')::bigint is distinct from g.current_work_id or
      (p_args->>'p_token')::uuid is distinct from g.current_work_token then raise exception 'throughput work binding'; end if;
    case p_operation
      when 'lean_pipeline_retain' then
        ok:=public.lean_pipeline_retain(g.current_work_id,g.current_work_token,p_args->'p_source');
      when 'lean_pipeline_finish_extended' then
        ok:=public.lean_pipeline_finish_extended(g.current_work_id,g.current_work_token,
          p_args->'p_facts',p_args->'p_reports',p_args->'p_product_reports',nullif(p_args->'p_order_item_sizes','null'::jsonb));
      when 'lean_pipeline_exclude_annual_access' then
        ok:=public.lean_pipeline_exclude_annual_access(g.current_work_id,g.current_work_token);
      when 'lean_pipeline_exclude_before_window' then
        ok:=public.lean_pipeline_exclude_before_window(g.current_work_id,g.current_work_token);
      when 'lean_pipeline_fail' then
        ok:=public.lean_pipeline_fail(g.current_work_id,g.current_work_token,p_args->>'p_code');
      else raise exception 'throughput operation not allowed';
    end case;
    r:=to_jsonb(ok);
    if ok and p_operation in ('lean_pipeline_finish_extended','lean_pipeline_exclude_before_window','lean_pipeline_exclude_annual_access') then
      update lean_private.pipeline_throughput_grants set current_work_id=null,current_work_token=null,current_work_native=0
        where grant_id=g.grant_id;
    elsif not ok or p_operation='lean_pipeline_fail' then
      update lean_private.pipeline_throughput_grants set held=true where grant_id=g.grant_id;
    end if;
  end if;
  -- A late delegate commit rolls back in THIS transaction. Caller abort alone
  -- does not prove this check ran, nor that an earlier commit did not succeed.
  if clock_timestamp()>=g.batch_deadline or clock_timestamp()>=g.expires_at
    then raise exception 'throughput deadline'; end if;
  return r;
end $$;
commit;
