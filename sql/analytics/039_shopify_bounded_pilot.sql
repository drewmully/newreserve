-- UNVERIFIED DRAFT: review/smoke before activation. Registers/enables nothing.
-- Independent supplement to 017; does not alter Google 019/038.
begin;
create table lean_private.shopify_pilots (
  pilot_id text primary key check(length(pilot_id) between 1 and 128),
  shop text not null unique references lean_private.pipeline_scope,
  project_ref text not null check(project_ref ~ '^[a-z]{20}$'),
  from_time timestamptz not null, until_time timestamptz not null,
  expires_at timestamptz not null,
  policy jsonb not null, approval_ref text not null check(length(trim(approval_ref))>0),
  actor_ref text not null check(length(trim(actor_ref))>0),
  max_receipts integer not null check(max_receipts between 1 and 1000),
  max_attempts integer not null check(max_attempts between 1 and 100),
  max_daily_attempts integer not null check(max_daily_attempts between 1 and 20),
  enabled boolean not null default false, blocked boolean not null default false,
  receipts_used integer not null default 0, attempts_used integer not null default 0,
  check(isfinite(from_time) and isfinite(until_time) and isfinite(expires_at) and from_time<until_time)
);
create table lean_private.shopify_pilot_members (
  pilot_id text not null references lean_private.shopify_pilots,
  order_gid text not null check(order_gid ~ '^gid://shopify/Order/[1-9][0-9]*$'),
  event_at timestamptz not null, verified boolean not null default false, withheld boolean not null default false,
  primary key(pilot_id,order_gid)
);
create table lean_private.shopify_pilot_receipts (
  receipt_id bigint primary key references lean_private.receipts,
  pilot_id text not null references lean_private.shopify_pilots
);
create table lean_private.shopify_pilot_days (
  pilot_id text not null references lean_private.shopify_pilots, day date not null,
  attempts integer not null default 0, primary key(pilot_id,day)
);
alter table lean_private.shopify_pilots enable row level security;
alter table lean_private.shopify_pilot_members enable row level security;
alter table lean_private.shopify_pilot_receipts enable row level security;
alter table lean_private.shopify_pilot_days enable row level security;
revoke all on lean_private.shopify_pilots,lean_private.shopify_pilot_members,
  lean_private.shopify_pilot_receipts,lean_private.shopify_pilot_days from public,anon,authenticated,service_role;
create function lean_private.shopify_pilot_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' or (to_jsonb(old)-array['enabled','blocked','receipts_used','attempts_used'])
    is distinct from (to_jsonb(new)-array['enabled','blocked','receipts_used','attempts_used'])
    then raise exception 'shopify pilot immutable'; end if;
  return new;
end $$;
create trigger immutable_shopify_pilot before update or delete on lean_private.shopify_pilots
  for each row execute function lean_private.shopify_pilot_immutable();
create function public.lean_shopify_pilot_register(p_scope jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.shopify_pilots; k text; v jsonb; n integer;
begin
  if jsonb_typeof(p_scope) is distinct from 'object' or
    p_scope-array['pilotId','shop','projectRef','fromTime','untilTime','expiresAt','policy','approvalRef','actorRef',
      'maxReceipts','maxAttempts','maxDailyAttempts']<>'{}'::jsonb then raise exception 'invalid pilot scope'; end if;
  foreach k in array array['fromTime','untilTime','expiresAt'] loop
    if coalesce(p_scope->>k,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
      then raise exception 'explicit UTC required'; end if;
  end loop;
  if p_scope#>>'{policy,decision,eligibility}' is distinct from 'eligible' or
    p_scope#>'{policy,decision,acquisitionEligible}' is distinct from 'false'::jsonb or
    coalesce(p_scope#>>'{policy,decision,commerceSource}','') not in ('storefront','subscription_renewal','other') or
    jsonb_typeof(p_scope#>'{policy,productClasses}') is distinct from 'object'
    then raise exception 'reviewed policy required'; end if;
  n:=0;
  for k,v in select * from jsonb_each(p_scope#>'{policy,productClasses}') loop
    if k !~ '^[1-9][0-9]*$' or v is distinct from '"merchandise"'::jsonb
      then raise exception 'invalid physical product'; end if; n:=n+1;
  end loop;
  if n not between 1 and 2 then raise exception 'one or two reviewed products required'; end if;
  if exists(select 1 from lean_private.receipts where lean_private.receipt_shop(business_key)=p_scope->>'shop')
    then raise exception 'pilot requires an empty shop receipt queue'; end if;
  insert into lean_private.pipeline_scope(shop,project_ref,from_time,until_time,policy,approval_ref,actor_ref)
    values(p_scope->>'shop',p_scope->>'projectRef',(p_scope->>'fromTime')::timestamptz,
      (p_scope->>'untilTime')::timestamptz,p_scope->'policy',p_scope->>'approvalRef',p_scope->>'actorRef');
  insert into lean_private.shopify_pilots
    (pilot_id,shop,project_ref,from_time,until_time,expires_at,policy,approval_ref,actor_ref,
      max_receipts,max_attempts,max_daily_attempts)
    values(p_scope->>'pilotId',p_scope->>'shop',p_scope->>'projectRef',(p_scope->>'fromTime')::timestamptz,
      (p_scope->>'untilTime')::timestamptz,(p_scope->>'expiresAt')::timestamptz,p_scope->'policy',
      p_scope->>'approvalRef',p_scope->>'actorRef',(p_scope->>'maxReceipts')::integer,
      (p_scope->>'maxAttempts')::integer,(p_scope->>'maxDailyAttempts')::integer) returning * into p;
  if p.expires_at<=clock_timestamp() or p.expires_at>clock_timestamp()+interval '14 days'
    then raise exception 'invalid execution expiry'; end if;
  return true;
end $$;
revoke all on function public.lean_shopify_pilot_register(jsonb) from public,anon,authenticated,service_role;
-- Scope lock is always before pipeline_scope/work. Never change scope in-place.
create function lean_private.shopify_pilot_ready(p lean_private.shopify_pilots) returns boolean
language sql volatile set search_path=pg_catalog as $$
  select p.enabled and not p.blocked and p.expires_at>clock_timestamp() and exists(
    select 1 from lean_private.pipeline_scope c where c.shop=p.shop and c.project_ref=p.project_ref
      and c.enabled and c.policy=p.policy and c.from_time=p.from_time and c.until_time=p.until_time)
$$;
create function public.lean_shopify_pilot_status(p_pilot text,p_project_ref text,p_shop text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.shopify_pilots;
begin
  select * into p from lean_private.shopify_pilots where pilot_id=p_pilot and project_ref=p_project_ref and shop=p_shop;
  if not found then raise exception 'unapproved pilot target'; end if;
  return jsonb_build_object('state',case when lean_private.shopify_pilot_ready(p) then 'ready' else 'disabled' end,
    'expiresAt',p.expires_at,'receiptsUsed',p.receipts_used,'attemptsUsed',p.attempts_used);
end $$;
revoke all on function public.lean_shopify_pilot_status(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.lean_shopify_pilot_status(text,text,text) to service_role;

alter function public.lean_accept_receipt(text,text,text,text,text,jsonb) rename to lean_accept_receipt_003;
revoke all on function public.lean_accept_receipt_003(text,text,text,text,text,jsonb) from public,anon,authenticated,service_role;
create function public.lean_accept_receipt(p_source text,p_delivery_id text,p_business_key text,p_topic text,p_payload_hash text,p_payload jsonb)
returns bigint language plpgsql security definer set search_path=pg_catalog as $$
begin
  if exists(select 1 from lean_private.shopify_pilots where shop=lean_private.receipt_shop(p_business_key))
    then raise exception 'bounded pilot receipt path required'; end if;
  return public.lean_accept_receipt_003(p_source,p_delivery_id,p_business_key,p_topic,p_payload_hash,p_payload);
end $$;
revoke all on function public.lean_accept_receipt(text,text,text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.lean_accept_receipt(text,text,text,text,text,jsonb) to service_role;
create function public.lean_shopify_pilot_accept(p_pilot text,p_project_ref text,p_shop text,p_delivery_id text,
  p_topic text,p_payload_hash text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.shopify_pilots; m lean_private.shopify_pilot_members; r lean_private.receipts;
  gid text; event_time timestamptz; created timestamptz; admitted boolean; known boolean; rid bigint;
begin
  select * into p from lean_private.shopify_pilots where pilot_id=p_pilot and project_ref=p_project_ref and shop=p_shop for update;
  if not found then raise exception 'unapproved pilot target'; end if;
  if not lean_private.shopify_pilot_ready(p) then return jsonb_build_object('state',
    case when p.expires_at<=clock_timestamp() then 'expired' when p.blocked then 'blocked' else 'disabled' end); end if;
  if p_topic not in ('orders/paid','orders/updated','orders/cancelled','refunds/create') or
    p_payload_hash is null or p_payload_hash !~ '^[a-f0-9]{64}$' or
    p_delivery_id is null or p_delivery_id !~ '^[A-Za-z0-9_-]{1,200}$' or
    jsonb_typeof(p_payload) is distinct from 'object' or
    p_payload-array['admin_graphql_api_id','order_id','created_at','updated_at','product_ids','unsupported']<>'{}'::jsonb or
    octet_length(p_payload::text)>65536 or jsonb_typeof(p_payload->'product_ids') is distinct from 'array' or
    jsonb_typeof(p_payload->'unsupported') is distinct from 'boolean'
    then raise exception 'invalid minimal envelope'; end if;
  if coalesce(p_payload->>'admin_graphql_api_id','') !~ '^gid://shopify/(Order|Refund)/[1-9][0-9]*$' or
    (p_topic='refunds/create' and p_payload->>'admin_graphql_api_id' !~ '^gid://shopify/Refund/') or
    (p_topic<>'refunds/create' and p_payload->>'admin_graphql_api_id' !~ '^gid://shopify/Order/') or
    (p_payload->>'created_at' is not null and p_payload->>'created_at' !~ '^[0-9T:.Z-]+Z$') or
    (p_payload->>'updated_at' is not null and p_payload->>'updated_at' !~ '^[0-9T:.Z-]+Z$')
    then raise exception 'invalid minimal identifiers or timestamps'; end if;
  gid:=case when p_topic='refunds/create' then p_payload->>'order_id' else p_payload->>'admin_graphql_api_id' end;
  if gid is null or gid !~ '^gid://shopify/Order/[1-9][0-9]*$' then raise exception 'invalid order identity'; end if;
  event_time:=(p_payload->>'updated_at')::timestamptz; created:=(p_payload->>'created_at')::timestamptz;
  if event_time<created then event_time:=null; end if;
  -- Equal-delivery replay has no counter increment and cannot change admission.
  select * into r from lean_private.receipts where source='shopify' and delivery_id=p_delivery_id;
  if found then
    if r.payload_hash<>p_payload_hash or r.topic<>p_topic or r.payload<>p_payload or
      not exists(select 1 from lean_private.shopify_pilot_receipts x where x.receipt_id=r.receipt_id and x.pilot_id=p.pilot_id)
      then raise exception 'delivery collision'; end if;
    return jsonb_build_object('state','accepted','receiptId',r.receipt_id::text);
  end if;
  select * into m from lean_private.shopify_pilot_members where pilot_id=p.pilot_id and order_gid=gid;
  known:=found;
  if p_topic='refunds/create' then
    if not known or not m.verified then return jsonb_build_object('state','ignored'); end if;
    admitted:=event_time is not null and created is not null; -- No guessed clock.
  else
    if known and event_time<m.event_at then return jsonb_build_object('state','ignored'); end if;
    admitted:=created is not null and event_time is not null and created>=p.from_time and created<p.until_time and
      p_payload->'unsupported'='false'::jsonb and jsonb_array_length(p_payload->'product_ids') between 1 and 500 and
      not exists(select 1 from jsonb_array_elements(p_payload->'product_ids') x where
        jsonb_typeof(x) is distinct from 'string' or
        (x#>>'{}') !~ '^gid://shopify/Product/[1-9][0-9]*$' or
        p.policy#>array['productClasses',replace(x#>>'{}','gid://shopify/Product/','')] is distinct from '"merchandise"'::jsonb);
    if not admitted and not known then return jsonb_build_object('state','ignored'); end if;
  end if;
  if p.receipts_used>=p.max_receipts then
    update lean_private.shopify_pilots set blocked=true where pilot_id=p.pilot_id;
    if p.expires_at<=clock_timestamp() then raise exception 'pilot expired during admission'; end if;
    return jsonb_build_object('state','blocked');
  end if;
  rid:=public.lean_accept_receipt_003('shopify',p_delivery_id,jsonb_build_array(p.shop,gid)::text,p_topic,p_payload_hash,p_payload);
  insert into lean_private.shopify_pilot_receipts values(rid,p.pilot_id);
  update lean_private.shopify_pilots set receipts_used=receipts_used+1 where pilot_id=p.pilot_id;
  if known then
    update lean_private.shopify_pilot_members set event_at=greatest(shopify_pilot_members.event_at,event_time),
      withheld=not admitted
      where pilot_id=p.pilot_id and order_gid=gid;
  else
    insert into lean_private.shopify_pilot_members(pilot_id,order_gid,event_at) values(p.pilot_id,gid,event_time);
  end if;
  if not admitted then
    update lean_private.shopify_pilot_members set verified=false where pilot_id=p.pilot_id and order_gid=gid;
    update lean_private.work set state='dead',last_error_code='mapping_rejected' where receipt_id=rid;
  end if;
  if p.expires_at<=clock_timestamp() then raise exception 'pilot expired during admission'; end if;
  return jsonb_build_object('state',case when admitted then 'accepted' else 'withheld' end,'receiptId',rid::text);
end $$;
revoke all on function public.lean_shopify_pilot_accept(text,text,text,text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.lean_shopify_pilot_accept(text,text,text,text,text,text,jsonb) to service_role;

alter function public.lean_pipeline_claim(uuid,text,text) rename to lean_pipeline_claim_017;
alter function public.lean_pipeline_retain(bigint,uuid,jsonb) rename to lean_pipeline_retain_017;
alter function public.lean_pipeline_finish(bigint,uuid,jsonb,jsonb) rename to lean_pipeline_finish_017;
alter function public.lean_pipeline_fail(bigint,uuid,text) rename to lean_pipeline_fail_017;
revoke all on function public.lean_pipeline_claim_017(uuid,text,text),
  public.lean_pipeline_retain_017(bigint,uuid,jsonb),public.lean_pipeline_finish_017(bigint,uuid,jsonb,jsonb),
  public.lean_pipeline_fail_017(bigint,uuid,text) from public,anon,authenticated,service_role;
create function public.lean_pipeline_claim(p_token uuid,p_project_ref text,p_shop text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if exists(select 1 from lean_private.shopify_pilots where shop=p_shop)
    then raise exception 'bounded pilot claim required'; end if;
  return public.lean_pipeline_claim_017(p_token,p_project_ref,p_shop);
end $$;
create function public.lean_shopify_pilot_claim(p_token uuid,p_project_ref text,p_shop text,p_pilot text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.shopify_pilots; result jsonb; current_day date; used integer;
begin
  select * into p from lean_private.shopify_pilots where shop=p_shop and pilot_id=p_pilot for update;
  if not found or p.project_ref<>p_project_ref then raise exception 'unapproved pilot target'; end if;
  if not lean_private.shopify_pilot_ready(p) then return jsonb_build_object('state','disabled'); end if;
  current_day:=(clock_timestamp() at time zone 'UTC')::date;
  select attempts into used from lean_private.shopify_pilot_days where pilot_id=p.pilot_id and day=current_day;
  if p.attempts_used>=p.max_attempts then
    update lean_private.shopify_pilots set blocked=true where pilot_id=p.pilot_id;
    if p.expires_at<=clock_timestamp() then raise exception 'pilot expired during claim'; end if;
    return jsonb_build_object('state','disabled');
  end if;
  if coalesce(used,0)>=p.max_daily_attempts then return jsonb_build_object('state','disabled'); end if;
  -- Never reset a failed/abandoned source attempt or silently bypass its budget.
  update lean_private.work w set state='dead',lease_token=null,lease_until=null,last_error_code='attempts_exhausted'
    from lean_private.shopify_pilot_receipts r where r.receipt_id=w.receipt_id and r.pilot_id=p.pilot_id
      and w.attempts>=1 and (w.state='pending' or (w.state='leased' and w.lease_until<=clock_timestamp()));
  result:=public.lean_pipeline_claim_017(p_token,p_project_ref,p_shop);
  if result->>'state'='claimed' then
    if not exists(select 1 from lean_private.shopify_pilot_receipts r join lean_private.work w using(receipt_id)
      where w.work_id=(result->>'workId')::bigint and r.pilot_id=p.pilot_id) then raise exception 'unadmitted work'; end if;
    update lean_private.work set lease_until=least(lease_until,p.expires_at,clock_timestamp()+interval '60 seconds')
      where work_id=(result->>'workId')::bigint;
    update lean_private.shopify_pilots set attempts_used=attempts_used+1 where pilot_id=p.pilot_id;
    insert into lean_private.shopify_pilot_days values(p.pilot_id,current_day,1)
      on conflict(pilot_id,day) do update set attempts=lean_private.shopify_pilot_days.attempts+1;
  end if;
  if p.expires_at<=clock_timestamp() then raise exception 'pilot expired during claim'; end if;
  return result;
end $$;
-- Helper locks the pilot through the same transaction as a retain/finish/fail.
create function lean_private.shopify_pilot_work(p_work bigint) returns lean_private.shopify_pilots
language sql set search_path=pg_catalog as $$
  select p.* from lean_private.shopify_pilots p join lean_private.shopify_pilot_receipts r using(pilot_id)
    join lean_private.work w using(receipt_id) where w.work_id=p_work for update of p
$$;
create function public.lean_pipeline_retain(p_work_id bigint,p_token uuid,p_source jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.shopify_pilots; w lean_private.work; retained boolean; created timestamptz;
begin
  p:=lean_private.shopify_pilot_work(p_work_id);
  if p.pilot_id is null then return public.lean_pipeline_retain_017(p_work_id,p_token,p_source); end if;
  if not lean_private.shopify_pilot_ready(p) then return false; end if;
  select * into w from lean_private.work where work_id=p_work_id for update;
  created:=(p_source#>>'{commerce,order,createdAt}')::timestamptz;
  if p_source is null or octet_length(p_source::text)>8388608 or created is null or
    not isfinite(created) or created<p.from_time or created>=p.until_time or
    jsonb_typeof(p_source#>'{commerce,order,lineItems,nodes}') is distinct from 'array' or
    p_source#>'{commerce,order,lineItems,pageInfo,hasNextPage}' is distinct from 'false'::jsonb
    then raise exception 'source outside admitted scope'; end if;
  if jsonb_array_length(p_source#>'{commerce,order,lineItems,nodes}') not between 1 and 500 or
    exists(select 1 from jsonb_array_elements(p_source#>'{commerce,order,lineItems,nodes}') x where
      coalesce(x#>>'{product,id}','') !~ '^gid://shopify/Product/[1-9][0-9]*$' or
      p.policy#>array['productClasses',replace(x#>>'{product,id}','gid://shopify/Product/','')] is distinct from '"merchandise"'::jsonb)
    then raise exception 'source catalog unapproved'; end if;
  if not exists(select 1 from lean_private.shopify_pilot_members m where m.pilot_id=p.pilot_id
    and m.order_gid=p_source#>>'{commerce,order,id}' and not m.withheld
    and m.event_at<=(p_source#>>'{commerce,order,updatedAt}')::timestamptz)
    then raise exception 'newer or withheld membership'; end if;
  retained:=public.lean_pipeline_retain_017(p_work_id,p_token,p_source);
  if retained then
    update lean_private.shopify_pilot_members set verified=true
      where pilot_id=p.pilot_id and order_gid=p_source#>>'{commerce,order,id}';
    if p.expires_at<=clock_timestamp() or w.lease_until<=clock_timestamp() then raise exception 'pilot expired during retain'; end if;
  end if;
  return retained;
end $$;
create function public.lean_pipeline_finish(p_work_id bigint,p_token uuid,p_facts jsonb,p_reports jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.shopify_pilots; w lean_private.work; finished boolean;
begin
  p:=lean_private.shopify_pilot_work(p_work_id);
  if p.pilot_id is null then return public.lean_pipeline_finish_017(p_work_id,p_token,p_facts,p_reports); end if;
  if not lean_private.shopify_pilot_ready(p) then return false; end if;
  select * into w from lean_private.work where work_id=p_work_id for update;
  if not exists(select 1 from lean_private.pipeline_snapshots s join lean_private.shopify_pilot_members m
    on m.pilot_id=p.pilot_id and m.order_gid=s.order_gid
    where s.work_id=p_work_id and not m.withheld and m.event_at<=s.revision) then return false; end if;
  finished:=public.lean_pipeline_finish_017(p_work_id,p_token,p_facts,p_reports);
  if finished and (p.expires_at<=clock_timestamp() or w.lease_until<=clock_timestamp())
    then raise exception 'pilot expired during finish'; end if;
  return finished;
end $$;
create function public.lean_pipeline_fail(p_work_id bigint,p_token uuid,p_code text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.shopify_pilots; failed boolean;
begin
  p:=lean_private.shopify_pilot_work(p_work_id);
  if p.pilot_id is null then return public.lean_pipeline_fail_017(p_work_id,p_token,p_code); end if;
  if not lean_private.shopify_pilot_ready(p) then return false; end if;
  failed:=public.lean_pipeline_fail_017(p_work_id,p_token,p_code);
  if failed then update lean_private.work set state='dead' where work_id=p_work_id; end if;
  if p.expires_at<=clock_timestamp() then raise exception 'pilot expired during fail'; end if;
  return failed;
end $$;
revoke all on function public.lean_pipeline_claim(uuid,text,text),public.lean_pipeline_retain(bigint,uuid,jsonb),
  public.lean_pipeline_finish(bigint,uuid,jsonb,jsonb),public.lean_pipeline_fail(bigint,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.lean_pipeline_claim(uuid,text,text),public.lean_pipeline_retain(bigint,uuid,jsonb),
  public.lean_pipeline_finish(bigint,uuid,jsonb,jsonb),public.lean_pipeline_fail(bigint,uuid,text) to service_role;
revoke all on function public.lean_shopify_pilot_claim(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.lean_shopify_pilot_claim(uuid,text,text,text) to service_role;
revoke all on function lean_private.shopify_pilot_work(bigint),lean_private.shopify_pilot_ready(lean_private.shopify_pilots)
  from public,anon,authenticated,service_role;
-- An old generic endpoint cannot claim/finish a pilot receipt after its switches
-- turn off, or mark dead/stale pilot work complete without the bounded publisher.
alter function public.lean_claim_work(text,integer,integer) rename to lean_claim_work_039_ordinary;
alter function public.lean_finish_work(bigint,text,text,jsonb) rename to lean_finish_work_039_ordinary;
alter function public.lean_fail_work(bigint,text,text) rename to lean_fail_work_039_ordinary;
revoke all on function public.lean_claim_work_039_ordinary(text,integer,integer),
  public.lean_finish_work_039_ordinary(bigint,text,text,jsonb),public.lean_fail_work_039_ordinary(bigint,text,text)
  from public,anon,authenticated,service_role;
create function public.lean_claim_work(p_token text,p_limit integer,p_lease_seconds integer)
returns table(work_id bigint,receipt_id bigint,topic text,payload jsonb,attempts integer)
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if exists(select 1 from lean_private.shopify_pilots) then raise exception 'use bounded pilot worker'; end if;
  return query select * from public.lean_claim_work_039_ordinary(p_token,p_limit,p_lease_seconds);
end $$;
create function public.lean_finish_work(p_work_id bigint,p_token text,p_version text,p_facts jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if exists(select 1 from lean_private.work w join lean_private.shopify_pilot_receipts r using(receipt_id)
    where w.work_id=p_work_id) then raise exception 'use bounded pilot worker'; end if;
  return public.lean_finish_work_039_ordinary(p_work_id,p_token,p_version,p_facts);
end $$;
create function public.lean_fail_work(p_work_id bigint,p_token text,p_code text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if exists(select 1 from lean_private.work w join lean_private.shopify_pilot_receipts r using(receipt_id)
    where w.work_id=p_work_id) then raise exception 'use bounded pilot worker'; end if;
  return public.lean_fail_work_039_ordinary(p_work_id,p_token,p_code);
end $$;
revoke all on function public.lean_claim_work(text,integer,integer),public.lean_finish_work(bigint,text,text,jsonb),
  public.lean_fail_work(bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.lean_claim_work(text,integer,integer),public.lean_finish_work(bigint,text,text,jsonb),
  public.lean_fail_work(bigint,text,text) to service_role;
-- Preserve ordinary rows/columns. Pilot expiry, kill and budget exhaustion cannot
-- leave a last-good row presented as current. Dead/pending receipts already stale it.
create or replace view lean_analytics.observed_order_daily with(security_barrier=true) as
select r.*,h.order_gid,h.revision as source_revision,'unverified'::text as certification,
  'webhook_observed_only'::text as coverage,
  (not cfg.enabled or s.policy is distinct from cfg.policy or
    s.from_time is distinct from cfg.from_time or s.until_time is distinct from cfg.until_time or
    exists(select 1 from lean_private.shopify_pilots p where p.shop=h.shop and
      (not p.enabled or p.blocked or p.expires_at<=clock_timestamp() or
        p.receipts_used>=p.max_receipts or p.attempts_used>=p.max_attempts)) or
    exists(select 1 from lean_private.work w join lean_private.receipts q using(receipt_id)
      where lean_private.receipt_shop(q.business_key)=h.shop and w.state<>'done')) as pipeline_stale
from lean_private.pipeline_heads h join lean_private.pipeline_snapshots s using(work_id)
join lean_private.report_store_daily r on r.publication_id=s.publication_id
join lean_private.pipeline_scope cfg on cfg.shop=h.shop;
commit;
