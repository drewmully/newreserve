-- Gift a Season, no-reveal model: ship mode and next-season address state.
-- Additive only: nullable columns on public.gift_seasons. Firestore stays the
-- source of truth; this mirror is for finance/KPI queries.
alter table public.gift_seasons add column if not exists ship_mode text;
alter table public.gift_seasons add column if not exists address_needed boolean;
alter table public.gift_seasons add column if not exists address_source text;
alter table public.gift_seasons add column if not exists address_collected_at timestamptz;
alter table public.gift_seasons add column if not exists address_request_sent_at timestamptz;
alter table public.gift_seasons add column if not exists gifter_confirmation_sent_at timestamptz;
