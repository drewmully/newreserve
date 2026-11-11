-- Gift a Season: read-only mirror of Firestore gift_orders where gift_kind = 'season'.
-- Additive only: one new table, no changes to existing objects.
-- Firestore stays the source of truth; the app upserts here via the service role.
-- RLS is enabled with no policies: only the service role can read or write.
begin;

create table if not exists public.gift_seasons (
  gift_order_id text primary key,               -- Shopify order id of the paid gift order
  shopify_order_number text,
  purchaser_email text,
  recipient_email text,
  recipient_first_name text,
  seasons_total integer not null check (seasons_total in (1, 2, 4)),
  amount numeric(10, 2),
  currency text,
  status text,
  boxes_dispatched integer not null default 0 check (boxes_dispatched >= 0),
  boxes_shipped integer not null default 0 check (boxes_shipped >= 0),
  boxes_remaining integer not null default 0 check (boxes_remaining >= 0),
  next_box_due_on date,
  box_orders jsonb not null default '[]'::jsonb,
  deliver_on text,
  recipient_emailed_at timestamptz,
  sizing_collected_at timestamptz,
  first_box_shipped_at timestamptz,
  continue_offer_sent_at timestamptz,
  converted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists gift_seasons_status_idx on public.gift_seasons (status);
create index if not exists gift_seasons_recipient_idx on public.gift_seasons (recipient_email);
create index if not exists gift_seasons_next_due_idx on public.gift_seasons (next_box_due_on)
  where boxes_remaining > 0;

alter table public.gift_seasons enable row level security;

comment on table public.gift_seasons is
  'Gift a Season prepaid gifts (1/2/4 Reserve seasons, no auto-renewal). Mirror of Firestore gift_orders.';

commit;
