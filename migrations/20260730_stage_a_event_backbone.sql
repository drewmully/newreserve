-- Stage A — event backbone.
--
-- Creates the inbound event landing table plus its two support tables.
-- NOT APPLIED. Emitted for the owner to review and apply manually.
--
-- Safety notes for whoever applies this:
--   * public.customers.id IS the Shopify customer id. Both foreign keys below
--     are ON DELETE SET NULL, never CASCADE — an event log must survive the
--     disappearance of the customer it referenced.
--   * Nothing here writes to, or triggers on, public.customers.

begin;

-- ─── public.inbound_event ────────────────────────────────────────────────────

create table if not exists public.inbound_event (
  id                bigserial primary key,
  source            text        not null,
  source_event_id   text        not null,
  source_topic      text,
  event_name        text        not null,
  received_at       timestamptz not null default now(),
  payload           jsonb,
  payload_purged_at timestamptz,
  payload_bytes     integer,
  customer_id       bigint      references public.customers (id) on delete set null,
  resolution        text        not null default 'pending',
  resolution_detail text,
  identity_hint     jsonb,
  processed_at      timestamptz,
  error             text,
  attempts          integer     not null default 0,

  constraint inbound_event_source_check
    check (source in ('shopify', 'loop', 'resend', 'reconciler', 'manual_replay')),
  constraint inbound_event_resolution_check
    check (resolution in ('pending', 'resolved', 'created', 'linked', 'unresolvable'))
);

comment on table public.inbound_event is
  'Raw landing table for every inbound provider event (Shopify, Loop, Resend) plus reconciler-synthesised and manually replayed events. Written before any parsing so an incident can always be reconstructed or replayed. Payloads are nulled after 90 days by the retention cron; the metadata row is kept forever.';

comment on column public.inbound_event.source_event_id is
  'Provider-supplied event id. Shopify: X-Shopify-Webhook-Id. Loop: payload id, else a deterministic hash. Reconciler: recon:<entity>:<id>:<state>.';
comment on column public.inbound_event.event_name is
  'Canonical internal event name from src/lib/events/catalog.ts. Nothing downstream ever reads a provider topic string.';
comment on column public.inbound_event.payload_bytes is
  'Size of the raw payload recorded at insert, so the volume metric survives the retention purge.';
comment on column public.inbound_event.customer_id is
  'Resolved public.customers.id, which is the Shopify customer id. ON DELETE SET NULL — never cascade.';

-- The idempotency mechanism. A redelivered webhook hits this unique violation
-- and the front door returns 200 immediately. Database-enforced, so it is
-- atomic — unlike the read-then-write Firestore check it supersedes.
create unique index if not exists inbound_event_source_dedupe_idx
  on public.inbound_event (source, source_event_id);

create index if not exists inbound_event_name_received_idx
  on public.inbound_event (event_name, received_at desc);

create index if not exists inbound_event_open_resolution_idx
  on public.inbound_event (resolution)
  where resolution in ('pending', 'unresolvable');

create index if not exists inbound_event_customer_idx
  on public.inbound_event (customer_id)
  where customer_id is not null;

create index if not exists inbound_event_received_at_idx
  on public.inbound_event (received_at);

-- ─── public.event_topic_expectation ──────────────────────────────────────────

create table if not exists public.event_topic_expectation (
  id              bigserial primary key,
  checked_at      timestamptz not null default now(),
  provider        text,
  topic           text,
  expected        boolean,
  registered      boolean,
  registered_uri  text,
  verdict         text,
  detail          text
);

comment on table public.event_topic_expectation is
  'Latest observed webhook-topic drift snapshot, written by /api/admin/events/topic-drift. The desired-topic list itself lives in code (src/lib/events/desired-topics.ts); this table only stores what was observed, so the drift report is queryable after the fact.';

create index if not exists event_topic_expectation_checked_idx
  on public.event_topic_expectation (checked_at desc);

-- ─── public.backbone_alert ───────────────────────────────────────────────────

create table if not exists public.backbone_alert (
  id               bigserial primary key,
  created_at       timestamptz not null default now(),
  kind             text,
  severity         text,
  customer_id      bigint  references public.customers (id) on delete set null,
  inbound_event_id bigint  references public.inbound_event (id) on delete set null,
  summary          text,
  detail           jsonb,
  acknowledged_at  timestamptz,
  delivered_at     timestamptz,
  delivery_error   text
);

comment on table public.backbone_alert is
  'Durable record of every event-backbone condition an operator needs to see: a customer row created, an identity linked to an existing row, an unresolvable event, an unknown topic, a failed signature check, a reconciler gap. The row is always written first; Slack delivery is best-effort on top of it.';

create index if not exists backbone_alert_unacknowledged_idx
  on public.backbone_alert (created_at desc)
  where acknowledged_at is null;

-- ─── identity-resolution helpers ─────────────────────────────────────────────
--
-- These two functions exist because PostgREST cannot express
-- `where lower(email) = lower($1)` from the client without turning the value
-- into an ilike pattern, where a literal `_` or `%` in an address silently
-- becomes a wildcard. customers_email_key is UNIQUE on the RAW email and is
-- therefore case-sensitive, so a raw `=` match is also wrong. Both functions
-- are read-only; neither writes to public.customers.

create or replace function public.event_backbone_find_customer_by_email(p_email text)
returns table (id bigint, email text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select c.id, c.email
  from public.customers c
  where lower(c.email) = lower(p_email)
  order by c.id asc
  limit 1;
$$;

comment on function public.event_backbone_find_customer_by_email(text) is
  'Case-insensitive, deterministic customer lookup by email for the event backbone. Uses customers_email_lower_idx. Ordered by id so a duplicate-email pair always resolves to the same row.';

-- Mirrors mully-hub''s nextSyntheticId: max(id)+1 over the synthetic range
-- only, so the two allocators interleave without colliding with a real
-- Shopify id (which is always below the 9e15 base).
create or replace function public.event_backbone_next_synthetic_id()
returns bigint
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(max(c.id), 9000000000000000::bigint) + 1
  from public.customers c
  where c.id >= 9000000000000000::bigint;
$$;

comment on function public.event_backbone_next_synthetic_id() is
  'Allocates the next synthetic customer id (>= 9e15), matching mully-hub''s nextSyntheticId semantics. Only used when an event carries no Shopify customer id and no existing row matches.';

-- ─── coverage aggregation ────────────────────────────────────────────────────
--
-- Aggregated in SQL rather than by pulling 30 days of rows into the route, so
-- the coverage report stays correct as volume grows.

create or replace function public.event_backbone_coverage()
returns table (
  event_name             text,
  first_seen_at          timestamptz,
  last_seen_at           timestamptz,
  count_24h              bigint,
  count_7d               bigint,
  count_30d              bigint,
  resolved_count_30d     bigint,
  unresolvable_count_30d bigint,
  total_count            bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    e.event_name,
    min(e.received_at) as first_seen_at,
    max(e.received_at) as last_seen_at,
    count(*) filter (where e.received_at >= now() - interval '24 hours') as count_24h,
    count(*) filter (where e.received_at >= now() - interval '7 days')   as count_7d,
    count(*) filter (where e.received_at >= now() - interval '30 days')  as count_30d,
    count(*) filter (
      where e.received_at >= now() - interval '30 days'
        and e.resolution in ('resolved', 'created', 'linked')
    ) as resolved_count_30d,
    count(*) filter (
      where e.received_at >= now() - interval '30 days'
        and e.resolution = 'unresolvable'
    ) as unresolvable_count_30d,
    count(*) as total_count
  from public.inbound_event e
  group by e.event_name;
$$;

comment on function public.event_backbone_coverage() is
  'Per-canonical-event volume and resolution aggregates backing /api/admin/events/coverage.';

commit;
