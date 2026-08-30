-- Loop → Shopify Subscriptions migration tracking table.
--
-- One row per Loop contract we plan to (or did) re-create under the new
-- Partner-Dashboard Shopify Subscriptions app (`mully-subscriptions-api`).
-- Populated by /api/admin/cron/migrate-prepaid-annual (Section 4 of the
-- migration plan). Kept separate from public.subscription_events because
-- that table is the raw webhook landing; this one is the migration audit.
--
-- Also adds a nullable `shopify_subscription_id` column to public.subscribers
-- so we can point downstream tools (admin UI, weekly-rollup) at the new
-- Shopify contract without dropping the old `loop_subscription_id` yet.
--
-- NOT APPLIED. Emitted for the owner to apply manually via psql against
-- the production Supabase project, matching the convention of
-- `20260830_subscription_events.sql` and `20260730_stage_a_event_backbone.sql`.
--
-- Safety notes:
--   * `loop_contract_id UNIQUE` — idempotent re-runs of the migration
--     endpoint hit this constraint; the route reads the existing row and
--     returns it instead of double-creating.
--   * `raw_loop_snapshot` and `raw_shopify_response` are jsonb blobs so any
--     incident can be reconstructed from Postgres alone without hitting Loop.
--   * Status is CHECK-constrained; new values require a migration.

begin;

create table if not exists public.subscription_migrations (
  id                          bigserial primary key,
  loop_contract_id            text        not null,
  shopify_customer_id         text        not null,
  customer_email              text        not null,
  loop_cadence                text        not null,   -- annual | quarterly
  loop_is_prepaid             boolean     not null,
  loop_next_billing_date      date,
  loop_boxes_remaining_credit numeric(10,2),
  loop_unshipped_credit_usd   numeric(10,2),
  loop_payment_method_id      text,
  new_shopify_contract_id     text,                   -- populated only on success
  status                      text        not null default 'planned',
  dry_run                     boolean     not null default true,
  error_message               text,
  planned_at                  timestamptz not null default now(),
  executed_at                 timestamptz,
  raw_loop_snapshot           jsonb,
  raw_shopify_response        jsonb,

  constraint subscription_migrations_status_check
    check (status in ('planned','dry_run_ok','migrated','rolled_back','failed')),

  constraint subscription_migrations_loop_unique unique (loop_contract_id)
);

comment on table public.subscription_migrations is
  'Audit row per Loop → Shopify Subscriptions contract migration. '
  'Written by /api/admin/cron/migrate-prepaid-annual. One-at-a-time by design '
  'during the initial cutover — no batch mode. See migration plan Section 4.';

comment on column public.subscription_migrations.loop_payment_method_id is
  'Loop-reported payment method identifier (Loop response field '
  '`customerPaymentMethodId` at time of writing). Captured verbatim so a '
  'human can trace vault handoff after cutover.';

comment on column public.subscription_migrations.status is
  'planned      — row inserted, no writes performed yet. '
  'dry_run_ok   — dry-run pass; Shopify + Loop were NOT touched. '
  'migrated     — Shopify contract created and Loop contract cancelled. '
  'rolled_back  — manual rollback recorded (reserved; not written by route). '
  'failed       — see error_message; may include partial state to reconcile.';

create index if not exists idx_subscription_migrations_status
  on public.subscription_migrations (status);

create index if not exists idx_subscription_migrations_planned_at
  on public.subscription_migrations (planned_at desc);

-- ─── subscribers: add shopify_subscription_id pointer ─────────────────────
--
-- Adds the column additively. Old `loop_subscription_id` is left in place
-- until the 30-day post-cutover Loop-uninstall grace window closes.
alter table public.subscribers
  add column if not exists shopify_subscription_id text;

comment on column public.subscribers.shopify_subscription_id is
  'Shopify SubscriptionContract global id after Loop→Shopify migration '
  '(gid://shopify/SubscriptionContract/<id>). Written by '
  '/api/admin/cron/migrate-prepaid-annual on successful cutover. '
  'Coexists with loop_subscription_id during the 30-day grace window.';

commit;
