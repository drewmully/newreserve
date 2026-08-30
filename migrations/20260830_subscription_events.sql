-- Shopify Subscriptions webhook landing table.
--
-- Written by /api/subscription/webhook (new in this PR). Mirrors the "persist
-- raw first, resolve later" pattern from public.inbound_event (see
-- migrations/20260730_stage_a_event_backbone.sql). Kept separate from
-- inbound_event because:
--   * These webhooks come from a different Shopify app (the new Partner app,
--     not the existing admin custom app), so HMAC secrets differ.
--   * We want an isolated audit trail during the Loop → Shopify migration
--     that can be truncated after cutover without touching the main event log.
--
-- NOT APPLIED. Emitted for the owner to review and apply manually via psql
-- against the production Supabase project.
--
-- Safety notes:
--   * No foreign keys yet. We'll add customer_id after the migration script
--     re-creates all Loop contracts under the new Partner app (Section 4 of
--     the migration plan).
--   * source_event_id is UNIQUE — a redelivered webhook hits the constraint
--     and the route returns 200 without a second row. Database-enforced.

begin;

create table if not exists public.subscription_events (
  id                bigserial primary key,
  received_at       timestamptz not null default now(),
  source_event_id   text        not null,
  topic             text,
  shop_domain       text,
  payload           jsonb,
  raw_body_bytes    integer,
  processed_at      timestamptz,
  processing_error  text,

  constraint subscription_events_topic_check
    check (
      topic is null
      or topic like 'subscription_contracts/%'
      or topic like 'subscription_billing_attempts/%'
    )
);

comment on table public.subscription_events is
  'Raw landing table for Shopify Subscriptions Partner-app webhooks '
  '(subscription_contracts/* and subscription_billing_attempts/*). '
  'Written before parsing so an incident can always be reconstructed. '
  'Kept separate from public.inbound_event during the Loop → Shopify migration.';

comment on column public.subscription_events.source_event_id is
  'Provider-supplied X-Shopify-Webhook-Id, or a deterministic sha256 of '
  '(topic, raw_body) when the header is missing.';
comment on column public.subscription_events.topic is
  'Shopify X-Shopify-Topic header. Only subscription_contracts/* and '
  'subscription_billing_attempts/* are accepted by the route.';

-- Idempotency: duplicate deliveries hit this unique index. The route catches
-- Postgres error 23505 and returns 200 with { duplicate: true }.
create unique index if not exists subscription_events_source_event_id_key
  on public.subscription_events (source_event_id);

create index if not exists subscription_events_topic_received_idx
  on public.subscription_events (topic, received_at desc);

create index if not exists subscription_events_unprocessed_idx
  on public.subscription_events (received_at)
  where processed_at is null;

commit;
