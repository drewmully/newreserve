# Local receipt-to-report integration test

This test joins the analytics building blocks in a disposable PGlite database.
It does not configure a live pipeline, contact Shopify/PostHog/Supabase, use real
customer records, create a paid resource, or apply SQL to the existing database.

## Verified results

Verified locally on September 20, 2026:

- New receipt-to-report integration suite: 7 tests passed.
- Full focused analytics suite after the compatibility/RPC follow-up: 227 tests
  passed across 17 files.
- Focused analytics TypeScript check and lint: passed.
- Live services contacted by this harness: none.
- Paid branches created or production database changes: none.
- GitHub publication: authorized on September 21 as a PR-only follow-up.
  This does not authorize merge or deployment.

The full application suite was rerun after the compatibility follow-up: 562
tests passed, 11 tests failed, plus one suite failed to load. All 12 failure
entries match the recorded pre-analytics baseline by name, with no additions or
resolutions. The full suite is not green; this is not production sign-off.

## Run

From the repository root:

```sh
npm test -- --project api tests/api/analyticsLeanEndToEnd.test.ts
npx tsc --project tsconfig.analytics.json
npx eslint tests/api/analyticsLeanEndToEnd.test.ts
```

The existing analytics CI glob also includes this test.

## Connected flow

1. Create a fresh in-memory database and apply all six analytics SQL files.
2. Sign synthetic event bytes and run the existing receipt verifier.
3. Persist receipts and work intents through the reusable receipt RPC adapter
   and `lean_accept_receipt`.
4. Run `runAnalyticsWorker` through the reusable worker RPC adapter against the
   actual claim/finish/fail SQL functions using named SQL arguments.
5. Transform fixture evidence into commerce, ledger, and payment projections.
6. Deduplicate complete projections and insert actual fact rows transactionally.
7. Read the facts back from SQL and reconcile against a fixed fixture oracle.
8. Compute report rows, record test-only certification, and select the publication
   in a single local transaction.
9. Query the real `lean_analytics.store_daily` view using a restricted reader.

Each case starts with a new database. The harness never imports the application's
Supabase service client or reads database credentials. It rejects `fetch` calls.
The signed envelope is explicitly a local fixture format, not an implementation
of Shopify's webhook/API-to-evidence mapping.

## Synthetic example

The fixture buys two items at USD 10 each, receives a USD 2 discount, and later
has a USD 5 merchandise refund. Original purchase value and AOV are USD 18;
net merchandise sales on January 1 are USD 13. A separate, independently dated
USD 18 settlement appears as collected cash on January 2.

The fixture intentionally supplies no refund cash settlement: a refund ledger
entry is not automatically evidence of a bank movement. Customer acquisition,
spend, and attribution metrics remain withheld rather than invented.

## Failure cases

- Repeat delivery ID: one receipt and one work intent.
- Different delivery IDs for identical business evidence: one fact set, no
  duplicate sales.
- Invalid signature: no stored receipt or work.
- Incomplete line evidence: failed transformation, no candidate materialization.
- Stored purchase amount mismatch: no certification or report selection.
- Equal-and-opposite ledger corruption: component reconciliation blocks release.
- Reporting-currency corruption: source totals alone cannot approve release.
- Completion commits but its response is lost: retry processes only remaining
  work and does not duplicate facts.

## Deliberate limitations

This is a test harness, not a production job or release service. The source
adapter, evidence references, policy approvals, and non-applicability decisions
are synthetic. Fixture completeness is bounded by the test's explicitly supplied
events, not by independent discovery of live source history.

Separate HTTP handler tests now exercise disabled/missing configuration, HMAC,
size limits, successful persistence and database failure with mocked Supabase
transport. The integration harness itself still bypasses HTTP.

It does not test the deployed HTTP route, real Shopify pagination/permissions,
Supabase/PostgREST behavior, independent PostgreSQL connections, production RLS,
live scheduler wiring, or PostHog ingestion/readback. It does not replace the
existing release checklist or establish production readiness.

The local materializer rejects conflicting projections rather than resolving
real-world revisions. A production orchestrator must implement source revision
ordering, coverage tracking, authorized release controls, and durable recovery.
