# Lean analytics: L01a contracts and test foundation

This is the first implementation slice of L01 in the **MyMully Lean Analytics
Pipeline PR Plan**. It does not complete L01 and does not deploy anything.
PostHog remains the agreed analytics destination. The physical staging/sync route
will be verified separately; existing operational Supabase tables must not be
overwritten or repurposed merely because a logical name matches.

## What this PR implements

- `src/lib/analytics/lean-contracts.json` pins the ten core logical table
  contracts from the [lean schema workbook](https://docs.google.com/spreadsheets/d/1irN9OS5z6nJOU46jeAFnwv4h6oFJC5m-gkSGzrxFREA/edit).
  Field names, logical types, nullability, composite keys, field approval status,
  semantic rules, publication gates and open decisions are retained.
- Pure shape validators check explicit fields, nullability, conservative wire
  types, per-batch composite-key uniqueness and one expected publication.
- Synthetic fixtures and dedicated CI run without Supabase, Shopify, Firebase,
  PostHog credentials or customer records.
- No application entry point imports the validator. No migration, scheduled
  job, webhook change, backfill, new source connection, API call, email or
  advertising conversion is introduced.

Workbook field-level proposals remain identifiable as proposals. Customer
acceptance of recommendations is not presented as approval of every field,
business rule or production release.

## Representation choices (not new business semantics)

- Every declared field must be present; unknown values use explicit `null` only
  where the workbook permits it. Missing is not coerced to zero or false.
- Decimals are exact decimal **strings**, never JavaScript floats. Precision and
  scale follow each logical DECIMAL type. No arithmetic or FX conversion occurs.
- UTC timestamps use `YYYY-MM-DDTHH:mm:ss[.ffffff]Z`; dates are validated calendar
  dates. These checks do not establish New York reporting-day alignment.
- INTEGER uses safe JavaScript integers; an adapter must reject or explicitly
  handle larger values rather than silently rounding.
- ENUM currently checks nonempty strings only: the workbook mixes closed lists,
  examples and approval-dependent vocabularies. Each owning adapter must pin and
  enforce its reviewed vocabulary. No enum set is guessed from prose.
- Currency checks validate uppercase three-letter syntax, not ISO membership,
  USD compatibility or exchange-rate evidence. Timezone recognition does not
  approve a source timezone for reporting.
- Error reports include only known field names, row indexes and error codes,
  never input values or unknown property names.

**Passing this validator does not certify a metric.** It does not check source
coverage, enum membership, currency policy, identity permission, cross-table
foreign keys, financial arithmetic, status transitions, completeness or any
semantic gate preserved in the manifest. An empty batch is shape-valid but says
nothing about whether the source is genuinely empty.

## How to test this PR

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test -- --project api tests/api/analyticsContracts.test.ts
npx tsc --project tsconfig.analytics.json
npx eslint src/lib/analytics/validate-contract.ts tests/api/analyticsContracts.test.ts
npm test
```

The dedicated GitHub Actions check runs the focused tests, typecheck and lint with
read-only repository permissions and no service secrets. The full repository
suite is a separate regression check; pre-existing failures are reported in the
PR rather than suppressed or represented as passing.

Review the manifest against the linked workbook, especially the nullable order
identity/session links, independent sales/cash timestamps, exact financial
precision, publication-aware keys and explicit unknown amounts. The fixture
builder validates shape, not realistic end-to-end commerce behavior.

## Next PRs and their tests

| Slice | Scope | Required evidence |
| --- | --- | --- |
| L01b | Restricted physical staging, publication metadata, least-privilege PostHog exposure and read-only agent query boundary | Inspect deployed Supabase schema and writer ownership first; apply additive migrations to a disposable database; assert keys, permissions, rollback and a PostHog non-production smoke query. Do not collide with native PostHog `sessions` or operational `public.customers`. |
| L02 | Truthful ingestion outcomes and checkpoints | Mock missing auth, verified empty results, failed pagination, partial writes and schema drift; incomplete runs must not advance success. |
| L03–L04 | Durable receipt, retries and safe replay | Crash, duplicate-delivery, overlapping-worker, timeout and response-loss tests; replay cannot trigger billing, fulfillment, email or ad-conversion sends. |
| L05–L06 | Shopify orders/items/offers, ledger and payments | Recorded/synthetic source fixtures for nested pagination, live/backfill overlap, revisions, cancellations, renewals, partial refunds and delayed payment; reconcile independent source keys and amounts in an approved test environment. |
| L07 | Customer identity and full-history anchors | Conflicting IDs, permission/removal, migrations and returning-customer tests; verify approved Firebase/Supabase evidence without altering operational customer IDs. |
| L08–L09 | Collection, sessions and verified checkout links | Separate Text Mully, Style Game and **Reserve reveal → checkout → paid order** journeys; consent, tampering, late events, dedupe, nullable links and seven-day maturity boundaries. |
| L10–L11 | Spend and first-party attribution | Downward spend revisions, missing account/day vs zero, source units/timezone, future touch rejection, explicit unattributed renewals and approved lookback boundaries. |
| L12 | Reporting and query contracts | All 24 workbook join contracts, fan-out traps, zero denominators, publication/model consistency, permitted cuts and metric-specific readiness. |
| L13 | Domain-by-domain release | Independent reconciliations, reviewed backfill limits, candidate rejection, stale last-good output, atomic selected-publication behavior and rollback before customer-approved activation. |

Meta and subscription extensions remain conditional. Missing Firebase or ad
access does not block unrelated commerce fixtures. Domain-specific validation
must land alongside each adapter, not be deferred entirely to L13.

## Access and release boundary

Supabase access is required to verify the existing integration path before
deployable storage changes are finalized. It is not required for this pure
contract/test PR. The Supabase management connection is not itself a read-only
database credential for PostHog; provisioning that connection requires separate,
explicitly approved scoped configuration.

The remaining L01 work includes independent source/account/date/history
expectations, access allowlists, publication controls and the warehouse smoke
test. No live integration or metric is certified by this PR. Customer review and
release authorization remain required. Rollback is a code revert; this PR
creates no persistent data to remove.
