# MyMully existing-account source adapter

This change uses existing source accounts, not new invitations. The customer
adapter and PostHog field mappings are executable code connected to the refresh
preparer; deploying them does not activate a source read, publish reports, or
install a schedule.

## Actual source mappings

| Source | Mapping | Boundary |
|---|---|---|
| Shopify Admin order `customer.id` | `orderIdentities` in the `shopify_customer` namespace | `null` is a guest; a missing selected field is an error. Re-read older retained documents rather than treating them as guests. |
| Supabase `public.customers.id` | Deterministic project/shop-scoped canonical customer ID | Reject synthetic customer IDs and unsafe numeric serialization. Never join by email or phone. |
| `customers.created_at` | Earliest observed Shopify-customer association | If absent, validity begins at capture, not a guessed historical date. |
| `customers.firebase_uid` | Firebase identity link from snapshot capture onward | A current UID is not proof of historical ownership. Conflicting current UID associations remain conflicting. |
| Explicit analytics permission timeline | Permission intervals and current permission/removal lists | Marketing flags, authentication, and presence in PostHog do not establish permission. An empty timeline remains unknown. |
| PostHog `reserve_user_id`, `shopify_customer_id`, `mully_anon_id` | Configurable identity properties in the bounded reader and diagnostic query | Only the configured property is selected. No heuristic namespace fallback or full properties blob. |
| Shopify successful transactions | Optional collected-cash evidence under an explicit approved success-time policy | Off unless configured; excludes authorizations, voids, pending/failed/test transactions. Not fee-net payouts or bank settlement. |

The source schema permits nullable customer timestamps. `entity` is explicitly
configured because the repository's event writer uses `mully`, while the
database default is `shopify`. Source IDs are taken from retained Shopify orders,
not from an unbounded customer scan. The adapter requires every requested
customer row; missing rows or a server-imposed row cap fail the read.

`hub_identity` is deliberately not treated as historical Firebase identity:
its inspected kind constraint lists email, phone, Instagram, WhatsApp and web
chat, not Firebase UID. The style profile `consent` field is explicitly described
as marketing consent in `src/lib/styleProfiles/types.ts`, so it is not reused as
analytics permission.

## Read, review, prepare

Run these commands only in an approved environment. They have not been executed
against customer data by this change.

1. Prepare a private JSON object with `projectRef`, `shop`, `entities`, an actual
   `approvalRef`, and `orders` containing at most 100 retained
   `ShopifyOrderDocument` objects. The documents must include `customer.id`.
2. Configure `LEAN_MULLY_SOURCE_READ_APPROVED=true`,
   `LEAN_MULLY_SOURCE_PROJECT_REF`, `LEAN_SHOPIFY_SHOP_DOMAIN` and a server-side
   `LEAN_MULLY_SOURCE_READ_KEY` suitable for the selected customer rows.
   Credentials belong in secret storage, never the JSON input or Git.
3. Extract a private current snapshot:

   ```sh
   node scripts/analytics/read-mully-source.mjs approved-source-input.json new-private-snapshot.json
   ```

4. Construct the existing refresh input inside this envelope:

   ```text
   {
     kind: "mully-source-v1",
     refresh: RefreshInput,
     source: {
       snapshot: extracted snapshot,
       orders: the same retained ShopifyOrderDocument objects,
       mappingVersion: refresh.policy.mappingVersion,
       permissions: reviewed MullyPermission[]
     },
     binding: {
       sourceId, schemaVersion, approvalRef, maxAgeSeconds
     },
     cashPolicy?: ShopifyCashPolicy,
     journey?: JourneySnapshot,
     journeyPermissions?: JourneyPermissions,
     offers?: OfferRegistry,
     retainReviewed?: { identity?: reviewedSourceId, customerHistory?: reviewedSourceId }
   }
   ```

   Permission records require Shopify customer ID, effective `from`, exclusive
   `to` or null, `permitted`, `removed`, and an actual authority `evidenceRef`.
   A current permission record must not be backdated to make old events eligible.

5. Run the existing offline preparer:

   ```sh
   node scripts/analytics/prepare-refresh.mjs approved-refresh-input.json private-new-output
   ```

The source path replaces the five customer/identity/history packets using the
source snapshot unless historical identity/history packets are explicitly
retained with their original verified source IDs, hashes, scope and freshness.
Otherwise customer history is intentionally marked incomplete; complete
purchase/migration evidence is not derived from a current customer row. Other
packets are retained and must match the resulting canonical IDs and scopes.
If `cashPolicy` is present, its exact approved clock must be
`approved_successful_transaction_processed_at`, its `asOf` must equal the
refresh time, and its explicit gateway list must cover every successful
receipt/refund in the selected orders. This replaces the settlement packet,
but never creates independent reconciliation controls.

The output is still a disabled immutable bundle. Follow L22 for reviewed
registration, activation and separate publication/export. The source command
performs at most one bounded Supabase request, writes owner-readable output,
makes no retries, and cannot write to a database. The customer mode uses GET;
the new receipt and permission modes use read-only RPCs. The preparation command
is offline. See L24 for the exact inputs, signing-secret boundary and event wiring.

## Remaining implementation versus live configuration

These adapters remove hand-written customer joins and unsupported PostHog
identifier assumptions. They do not make every spreadsheet metric production
ready, and connected accounts alone do not settle field meaning.

- Historical Firebase/anonymous identity, analytics permission and removal
  evidence still need authoritative wiring. This adapter refuses to infer them.
- L24 wires Reserve/Style Game/Text Mully start producers and actual Storefront
  checkout paths to permission-checked capture and signed cart receipts.
  Permission issuance/cookie delivery, Text Mully activation/checkout,
  REST draft-order checkout and campaign authority remain unintegrated.
- Complete history/migration coverage, original-purchase handling for deferred
  commerce, the actual offer registry, independent control extraction and
  production-volume partitioning remain separate work. The new offer adapter
  consumes approved line-level attributes without guessing membership.
- Supabase/PostHog deployment secrets, warehouse source setup, source validation,
  publication and hosted tests remain approval-gated. No customer source read,
  paid hosted test, migration, source creation or deployment was performed here.

## Local verification

The complete local analytics suite passed 520 tests across 41 files, including
10 real PostgreSQL integration/concurrency tests against a disposable local
database. TypeScript, analytics ESLint, generated-SQL parity and diff checks
also passed. These are not live vendor or hosted results.

Tests exercise actual column names using synthetic values, exact identity
intervals, unknown/removed permissions, duplicate UID claims, nullable source
timestamps, missing/capped rows, bigint precision, byte budgets, wrong targets,
no retries, optional cash-clock mapping, and all configured PostHog ID fields.
The command test runs snapshot extraction against a mocked transport and passes
the result into the real offline refresh preparer. The SQL integration test
persists mapped customer/order relationships through the full report job while
leaving unsupported customer-history metrics null and warehouse exports empty.
