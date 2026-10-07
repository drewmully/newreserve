-- REVIEW ONLY. Requires prospective v3 policy installation. No activation/data.
begin;
set local statement_timeout='15s';
set local lock_timeout='2s';
create table lean_private.source_session_paid_receipts (
  order_gid text primary key check(order_gid ~ '^gid://shopify/Order/[1-9][0-9]{0,24}$'),
  cart_token text not null unique references lean_private.source_session_cart_receipts(cart_token),
  native_session_id uuid not null references lean_private.source_session_receipts(native_session_id),
  grant_hash text not null references lean_private.journey_grants(token_hash),
  delivery_id uuid not null unique,
  payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
  shop text not null check(shop='mullybox-store.myshopify.com'),
  topic text not null check(topic='orders/paid'),
  verification_version text not null check(verification_version='shopify-hmac-sha256:source-session-v3'),
  webhook_key_sha256 text not null check(webhook_key_sha256 ~ '^[a-f0-9]{64}$'),
  order_created_at timestamptz not null,
  order_processed_at timestamptz,
  order_updated_at timestamptz,
  received_at timestamptz not null default clock_timestamp(),
  conflicted_at timestamptz
  -- No paid_at: root processed/updated clocks are not payment transaction clocks.
);
alter table lean_private.source_session_paid_receipts enable row level security;
revoke all on lean_private.source_session_paid_receipts from public,anon,authenticated,service_role,lean_posthog_reader;
create function lean_private.source_session_paid_authority(p_config text,p_cart text)
returns lean_private.journey_grants language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies; g lean_private.journey_grants;
  c lean_private.source_session_cart_receipts; b lean_private.source_session_receipts;
begin
  if p_config is null then raise exception 'source config required'; end if;
  p:=lean_private.source_session_policy(p_config);
  select * into c from lean_private.source_session_cart_receipts where cart_token=p_cart for share;
  if not found or c.conflicted_at is not null then raise exception 'source cart unavailable'; end if;
  select * into g from lean_private.journey_grants where token_hash=c.grant_hash for share;
  if not found or g.project_ref<>p.project_ref or g.shop<>p.shop or g.posthog_project<>p.posthog_project
    or g.permission_evidence_ref<>'explicit-browser-choice:'||p.policy_version||':'||g.subject_id
    or g.approval_ref<>p.approval_ref or g.firebase_uid is not null or g.revoked_at is not null
    or c.captured_at<g.valid_from or c.captured_at>=g.expires_at
    or exists(select 1 from lean_private.journey_removals where token_hash=g.token_hash) then
    raise exception 'source paid authority unavailable'; end if;
  select * into b from lean_private.source_session_receipts where native_session_id=c.native_session_id for share;
  if not found or b.grant_hash<>g.token_hash or b.conflicted_at is not null or b.paid_link_until<=clock_timestamp()
    or b.source_started_at<g.valid_from or b.source_started_at>=g.expires_at then
    raise exception 'source paid deadline unavailable'; end if;
  -- This permits only an already-authorized checkout's later order, not new capture.
  return g;
end $$;
create function lean_private.source_session_paid_clock_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies; g lean_private.journey_grants; deadline timestamptz;
begin
  p:=lean_private.source_session_policy();
  g:=lean_private.source_session_paid_authority(public.lean_source_session_config()->>'configToken',new.cart_token);
  select paid_link_until into deadline from lean_private.source_session_receipts where native_session_id=new.native_session_id;
  if g.token_hash<>new.grant_hash or new.received_at<g.valid_from or new.received_at>=deadline or new.received_at>clock_timestamp()
    or new.received_at>=p.source_session_valid_until then raise exception 'source paid receipt clock'; end if;
  return new;
end $$;
create trigger source_paid_clock before insert on lean_private.source_session_paid_receipts
  for each row execute function lean_private.source_session_paid_clock_guard();
create trigger source_paid_immutable before update on lean_private.source_session_paid_receipts
  for each row execute function lean_private.source_session_immutable_receipt();

create function public.lean_source_session_paid(p_config text,p_order text,p_cart text,p_delivery uuid,
  p_digest text,p_created timestamptz,p_processed timestamptz,p_updated timestamptz)
returns boolean language plpgsql security definer set search_path=pg_catalog,lean_private as $$
declare p lean_private.journey_policies; g lean_private.journey_grants;
  c lean_private.source_session_cart_receipts; b lean_private.source_session_receipts;
  prior lean_private.source_session_paid_receipts; conflicts boolean;
begin
  if p_config is null then raise exception 'source config required'; end if;
  p:=lean_private.source_session_policy(p_config);
  if p_order is null or p_order !~ '^gid://shopify/Order/[1-9][0-9]{0,24}$'
    or p_cart is null or p_cart !~ '^[A-Za-z0-9_-]{1,200}$' or p_delivery is null
    or p_digest is null or p_digest !~ '^[a-f0-9]{64}$' or p_created is null
    or p_created>clock_timestamp() or p_processed>clock_timestamp() or p_updated>clock_timestamp()
    then raise exception 'source paid shape'; end if;
  select * into c from lean_private.source_session_cart_receipts where cart_token=p_cart for share;
  if not found or c.conflicted_at is not null then return false; end if;
  g:=lean_private.source_session_paid_authority(p_config,p_cart);
  select * into b from lean_private.source_session_receipts where native_session_id=c.native_session_id for share;
  if not found or b.grant_hash<>g.token_hash or b.conflicted_at is not null then return false; end if;
  -- Fixed lineage from this route's owner-bound secret and exact shop/topic.
  insert into lean_private.source_session_paid_receipts(order_gid,cart_token,native_session_id,grant_hash,
    delivery_id,payload_sha256,shop,topic,verification_version,webhook_key_sha256,
    order_created_at,order_processed_at,order_updated_at)
    values(p_order,p_cart,c.native_session_id,g.token_hash,p_delivery,p_digest,p.shop,'orders/paid',
      'shopify-hmac-sha256:source-session-v3',p.source_session_webhook_sha256,p_created,p_processed,p_updated)
    on conflict do nothing;
  perform 1 from lean_private.source_session_paid_receipts
    where order_gid=p_order or cart_token=p_cart or delivery_id=p_delivery order by order_gid for update;
  select exists(select 1 from lean_private.source_session_paid_receipts where
    (order_gid=p_order or cart_token=p_cart or delivery_id=p_delivery) and
    (order_gid<>p_order or cart_token<>p_cart or grant_hash<>g.token_hash or native_session_id<>c.native_session_id
      or payload_sha256<>p_digest or order_created_at<>p_created
      or order_processed_at is distinct from p_processed or order_updated_at is distinct from p_updated)) into conflicts;
  if conflicts then
    update lean_private.source_session_paid_receipts set conflicted_at=coalesce(conflicted_at,clock_timestamp())
      where order_gid=p_order or cart_token=p_cart or delivery_id=p_delivery;
    return false;
  end if;
  select * into prior from lean_private.source_session_paid_receipts where order_gid=p_order;
  return found and prior.conflicted_at is null;
end $$;

create function public.lean_source_session_paid_read(p_orders text[])
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,lean_private as $$
begin
  if p_orders is null or cardinality(p_orders)>100 or exists(select 1 from unnest(p_orders) x
    where x is null or x !~ '^gid://shopify/Order/[1-9][0-9]{0,24}$') then raise exception 'source paid read scope'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'orderGid',p.order_gid,'cartToken',p.cart_token,'nativeSessionId',p.native_session_id,
    'payloadSha256',p.payload_sha256,'deliveryId',p.delivery_id,'shop',p.shop,'topic',p.topic,
    'verificationVersion',p.verification_version,'webhookKeySha256',p.webhook_key_sha256,
    'orderCreatedAt',to_char(p.order_created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'orderProcessedAt',to_char(p.order_processed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'orderUpdatedAt',to_char(p.order_updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'receivedAt',to_char(p.received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'cartCapturedAt',to_char(c.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'paidLinkUntil',to_char(b.paid_link_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'contextToken',c.context_token,'subjectId',g.subject_id,'permissionEvidenceRef',g.permission_evidence_ref,
    'removed',g.revoked_at is not null or exists(select 1 from lean_private.journey_removals m where m.token_hash=g.token_hash),
    'conflicted',p.conflicted_at is not null or c.conflicted_at is not null or b.conflicted_at is not null
  ) order by p.order_gid),'[]'::jsonb)
  from lean_private.source_session_paid_receipts p
  join lean_private.source_session_cart_receipts c on c.cart_token=p.cart_token and c.grant_hash=p.grant_hash
  join lean_private.source_session_receipts b on b.native_session_id=p.native_session_id and b.grant_hash=p.grant_hash
  join lean_private.journey_grants g on g.token_hash=p.grant_hash
  where p.order_gid=any(p_orders));
end $$;
revoke all on function public.lean_source_session_paid(text,text,text,uuid,text,timestamptz,timestamptz,timestamptz),
  public.lean_source_session_paid_read(text[]),lean_private.source_session_paid_clock_guard(),lean_private.source_session_paid_authority(text,text)
  from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_source_session_paid(text,text,text,uuid,text,timestamptz,timestamptz,timestamptz),
  public.lean_source_session_paid_read(text[]) to service_role;
commit;
