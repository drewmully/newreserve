-- REVIEW ONLY. Not applied by this change. Requires explicit approval.
-- Adds (1) an IDs-only ledger of Shopify Flow native-subscription events and
-- (2) a durable, order-scoped lifecycle dispatch outbox with leased claims.
-- No customer emails, addresses or payment data are stored in either table.
-- RLS is enabled with no policies: only the service role can read or write.
begin;

create table if not exists public.lifecycle_native_subscription_events (
  id bigint generated always as identity primary key,
  idempotency_key text not null unique check (idempotency_key ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('contract_created','contract_updated','billing_success',
    'billing_failure','contract_snapshot','snapshot_run')),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  run_id text,
  shopify_contract_id text check (shopify_contract_id ~ '^[1-9][0-9]*$'),
  shopify_customer_id text check (shopify_customer_id ~ '^[1-9][0-9]*$'),
  shopify_order_id text check (shopify_order_id ~ '^[1-9][0-9]*$'),
  status text check (status in ('active','paused','cancelled','expired','failed')),
  snapshot_count integer check (snapshot_count >= 0)
);
create index if not exists lnse_customer_idx on public.lifecycle_native_subscription_events (shopify_customer_id, occurred_at desc);
create index if not exists lnse_run_idx on public.lifecycle_native_subscription_events (run_id) where run_id is not null;
alter table public.lifecycle_native_subscription_events enable row level security;

create table if not exists public.lifecycle_dispatch_outbox (
  id bigint generated always as identity primary key,
  dedupe_key text not null unique check (dedupe_key ~ '^mully-lifecycle-v1:[0-9a-f]{64}$'),
  program text not null check (program in ('shop_purchase','shop_delivery','member_start','member_first_delivery')),
  shopify_customer_id text not null check (shopify_customer_id ~ '^[1-9][0-9]*$'),
  shopify_order_id text not null check (shopify_order_id ~ '^[1-9][0-9]*$'),
  state text not null default 'pending' check (state in ('pending','claimed','sent','held','failed','dead','cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  last_holds text[] not null default '{}',
  last_error text check (last_error is null or length(last_error) <= 80),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program, shopify_order_id)
);
create index if not exists ldo_due_idx on public.lifecycle_dispatch_outbox (next_attempt_at) where state in ('pending','failed');
alter table public.lifecycle_dispatch_outbox enable row level security;

-- Atomically lease up to p_limit due rows. Expired leases are reclaimable;
-- the worker must present the same lease_token to finish a row.
create or replace function public.lifecycle_outbox_claim(p_limit integer, p_lease_seconds integer)
returns setof public.lifecycle_dispatch_outbox
language sql security definer set search_path = public as $$
  with due as (
    select id from public.lifecycle_dispatch_outbox
    where (state in ('pending','failed') and next_attempt_at <= now())
       or (state = 'claimed' and lease_until < now())
    order by next_attempt_at
    limit least(greatest(p_limit, 0), 100)
    for update skip locked
  )
  update public.lifecycle_dispatch_outbox o
     set state = 'claimed', lease_token = gen_random_uuid(),
         lease_until = now() + make_interval(secs => least(greatest(p_lease_seconds, 30), 600)),
         attempts = o.attempts + 1, updated_at = now()
    from due where o.id = due.id
  returning o.*;
$$;
revoke all on function public.lifecycle_outbox_claim(integer, integer) from public, anon, authenticated;

commit;
