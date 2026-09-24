# Native offers, late updates and operational health

This change continues the existing spreadsheet-scope PR; it does not deploy or
activate anything. The contract remains the
[MyMully workbook](https://docs.google.com/spreadsheets/d/1irN9OS5z6nJOU46jeAFnwv4h6oFJC5m-gkSGzrxFREA/edit?gid=103#gid=103).
Its core scope is ten fact domains, native/logical events and five reports,
not one independent pipeline for every explanatory tab.

## Native offer membership

The fixed Shopify query now retains each line discount allocation's application
type, order-local index, target type and discount code when applicable. Shopify's
[DiscountAllocation](https://shopify.dev/docs/api/admin-graphql/latest/objects/DiscountAllocation)
links the actual allocated amount to its originating
[DiscountApplication](https://shopify.dev/docs/api/admin-graphql/latest/interfaces/DiscountApplication);
[DiscountCodeApplication](https://shopify.dev/docs/api/admin-graphql/latest/objects/DiscountCodeApplication)
provides the applied code.

`prepareMullyRefresh` automatically maps positive line allocations into
`order_item_offers`, using `membership_basis=source_line_discount`. An optional
approved line-attribute registry can add business-specific memberships; it is
not a prerequisite for native discounts.

- Discount codes use shop-scoped hashed IDs; the new membership rows do not
  export raw codes. This is pseudonymization, not a guarantee against guessing.
- Automatic/manual/script applications lack a proven cross-order ID here.
  Their IDs deliberately remain order-scoped, rather than merging by title.
- Multiple offers on a line are memberships, not multiple sales. Existing
  store/product revenue totals remain unchanged.
- Zero allocations do not establish membership. Missing selected fields,
  partial lines, invalid/negative amounts, currency mismatches, unknown types,
  duplicate allocations and conflicting application identities fail closed.
- Previously retained orders lacking the new query fields need a fresh,
  authorized source snapshot. Missing fields are not interpreted as no offers.
- Offer output retains source hashes and mapping version. A source hash proves
  which input was used; it does not independently prove freshness/completeness.

## Independent metric checks

The candidate report builder no longer applies browser-event checks to unrelated
financial metrics. Commerce, cash and product totals still require their own
independent reconciliation, coverage, currency and graph checks, but missing
session/identity evidence no longer suppresses otherwise supported amounts.

Spend requires compatible account scope. New-customer/cohort calculations still
require temporal identity/history; funnels and attribution require their
applicable event, session and lineage checks. Missing evidence stays null or
unavailable, not a fabricated zero. Whole-publication certification/release
remains strict and operator-only; this does not create automatic partial release.

The workbook's collected cash is customer receipts minus cash reversals under
its approved lifecycle/clock policy, not bank deposits or fee-net payouts.
The existing successful Shopify sale/capture/refund adapter supports a scoped
policy. Completeness across gateways, chargebacks and independent cash controls
still needs actual source integration; connecting a bank is not inherently
required by this workbook.

## Update-time inventory

History windows now accept `scanBasis: "created_at" | "updated_at"`; omission
preserves creation-time behavior. Shopify's
[orders query](https://shopify.dev/docs/api/admin-graphql/latest/queries/orders)
supports the update filter, paired with the documented
[UPDATED_AT sort key](https://shopify.dev/docs/api/admin-graphql/latest/enums/OrderSortKeys).

An update scan can discover a recently refunded or changed order even when its
creation predates the scan. The reader verifies actual `read_all_orders` scope
for every update-scan invocation, because restricting access to recent purchases
could silently omit older changed orders.

Creation and update windows may overlap each other. Same-basis overlapping
windows are rejected; downstream commerce deduplicates source revisions rather
than double-counting purchases. An order changing between listing and hydration
fails the page instead of accepting inconsistent observations.

Migration 027 persists the immutable scan basis and validates selected-clock
bounds and sort order across durable page boundaries. Invalid pages roll back
without advancing cursors. Existing jobs remain creation-time jobs; changing
their basis requires a new registration.

This is a bounded scan capability, not an installed scheduler or a claim that
watermark overlap/replay, deletions, late-arrival completeness or production
backfills are solved. Update clocks locate changed orders; financial amounts
still use their own source-effective dates.

## Read-only health

Migration 028 adds an operator-owned monitor target with explicit expected
candidate/export ages. Targets start disabled. Runtime can read health but
cannot configure targets, activate work, certify reports or export data.

`GET /api/analytics/ingest/health` uses a separate secret and fixed environment
scope. It accepts neither request-selected projects/shops nor query/body input,
returns `Cache-Control: no-store`, and exposes aggregate status without customer
rows or credentials.

| Configuration | Meaning |
|---|---|
| `LEAN_ANALYTICS_MONITOR_ENABLED=true` | Explicitly enables the route; otherwise 404 |
| `LEAN_ANALYTICS_MONITOR_SECRET` | Separate server-only secret of at least 32 characters |
| Existing pipeline project, Supabase URL/service key and shop settings | Exact fixed database/shop target |
| Private `refresh_monitor_targets` row | Operator-approved cadence, export expectation and enablement |

Health detects missing configuration/work, disabled refresh, exhausted budgets,
expired work, ambiguous leases, blocked runs, exhausted history/full-build
attempts, stale candidate source vintage, mixed/missing selections, stale
selected publications, missing/stale exports and export/selection mismatch.
A new completion timestamp or re-export does not reset an old source vintage.

HTTP 200 means the configured database-side checks pass. Unconfigured, disabled,
attention or unavailable states return 503 after authentication.
`posthogReadbackVerified` remains false: a database export is not proof of
PostHog synchronization. No monitor schedule, third-party check or alert
destination is installed by this change.

## Installation and verification boundary

For an explicitly approved isolated installation, apply the existing ordered
migrations through 028 before deploying the updated runtime or registering
update-scan jobs. Migration 027 adds the basis column and replaces registration,
read and commit functions together; migration 025 remains unchanged.
Do not modify scan basis on existing jobs.

Local verification: 547 tests across 42 files, zero skipped, including ten real
PostgreSQL integration/concurrency tests on a disposable loopback database.
TypeScript, ESLint, generated SQL parity and whitespace checks passed.
Vendor responses are synthetic; this is not a real-source end-to-end result.

New regressions cover native/stacked offers and unchanged monetary totals,
malformed evidence, domain-specific withholding, old purchases in update
windows, missing full-history permission, out-of-order page rollback, immutable
scan scope, monitor permissions/auth, stale source vintage despite re-export,
and configured healthy/unconfigured/stale states.

## Still unfinished

The permission-decision authority's issuance/cookie/revocation/erasure lifecycle;
actual Text Mully activation/checkout and REST draft-order linkage; verified
historical identity/purchases/migrations; authoritative campaign receipts;
unsupported original purchases and complete cash lifecycle; independent
source-total extraction; unattended fresh-evidence collection, volume
partitioning, watermark scheduling, retention cleanup and alert delivery
remain engineering/integration work. These are not erased by passing local
tests or by existing account connections.

Hosted migrations, secrets, isolated real-source reconciliation, release,
PostHog view/source installation and synchronization/deletion verification
remain separately approved operational steps. No hosted resource, deployment,
paid test, schedule or customer source read was performed for this update.
