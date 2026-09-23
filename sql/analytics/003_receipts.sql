-- REVIEW ONLY. Requires 001_staging.sql. No webhook subscription is created.
begin;
create table lean_private.receipts (
  receipt_id bigint generated always as identity primary key,
  source text not null,
  delivery_id text not null,
  business_key text not null,
  topic text not null,
  payload_hash text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique(source, delivery_id)
);
create table lean_private.work (
  work_id bigint generated always as identity primary key,
  receipt_id bigint not null references lean_private.receipts,
  destination text not null check(destination = 'lean_warehouse'),
  state text not null default 'pending' check(state in ('pending','leased','done','dead')),
  attempts integer not null default 0 check(attempts >= 0),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token text,
  completed_at timestamptz,
  last_error_code text,
  unique(receipt_id,destination)
);
alter table lean_private.receipts enable row level security;
alter table lean_private.work enable row level security;
revoke all on lean_private.receipts, lean_private.work from public;

create function public.lean_accept_receipt(
  p_source text, p_delivery_id text, p_business_key text, p_topic text,
  p_payload_hash text, p_payload jsonb
) returns bigint language plpgsql security definer set search_path = pg_catalog as $$
declare r lean_private.receipts;
begin
  if p_source <> 'shopify' or length(p_delivery_id) not between 1 and 200
     or length(p_business_key) not between 1 and 300
     or p_topic not in ('orders/paid','orders/updated','orders/cancelled','refunds/create')
     or p_payload_hash !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid receipt envelope';
  end if;
  insert into lean_private.receipts(source,delivery_id,business_key,topic,payload_hash,payload)
    values(p_source,p_delivery_id,p_business_key,p_topic,p_payload_hash,p_payload)
    on conflict(source,delivery_id) do nothing;
  select * into strict r from lean_private.receipts
    where source=p_source and delivery_id=p_delivery_id for update;
  if r.payload_hash <> p_payload_hash or r.topic <> p_topic or r.business_key <> p_business_key then
    raise exception 'delivery collision';
  end if;
  insert into lean_private.work(receipt_id,destination) values(r.receipt_id,'lean_warehouse')
    on conflict(receipt_id,destination) do nothing;
  return r.receipt_id;
end $$;
revoke all on function public.lean_accept_receipt(text,text,text,text,text,jsonb) from public;
-- Migration owner must verify this is Supabase's server-only role before granting.
grant execute on function public.lean_accept_receipt(text,text,text,text,text,jsonb) to service_role;
commit;
