# Automatic Shopify processing: merge and activation checklist

This update belongs to existing PR #159. It completes the automatic
webhook-receipt-to-observed-report path for the supported Shopify subset,
disabled by default. It does not certify the full workbook or activate any
customer infrastructure. A code merge and a live deployment are separate gates.

## Implemented path

```text
HMAC-verified Shopify receipt -> durable queue
  -> authenticated worker claims one fenced lease
  -> fixed read-only Shopify queries hydrate the parent order
  -> referenced refund and source revision checked
  -> immutable source and approved policy retained
  -> candidate orders/items/sales ledger/payments + daily report committed
  -> newest successful order snapshot selected in observed_order_daily
```

No per-order registration is needed for this path. An operator approves the
shop, order-created-at window and catalog policy once. Refund receipts hydrate
their parent order, not an order mistakenly identified by the refund ID.
The source must have caught up with the event before it is retained.

The worker uses a 120-second lease, a 60-second overall Shopify-read deadline
and at most five attempts. Safe failure codes, exponential retry delays,
immutable retained evidence and an atomic finish prevent duplicate writes.
Older revisions never replace a newer head; conflicting data at the same
revision is blocked. Counts-only health, visibly stale output and operator-only
audited retry make failures observable without leaking payloads.

## Merge gates and order

- Review and merge the stack bottom-up, #146 through #159. Each PR currently
  targets its predecessor. After each merge, retarget/rebase its successor onto
  main and rerun checks; merging #159 into #158 alone does not put it on main.
- Use the latest `Analytics contracts / contracts` check for each updated head.
  It runs generated-SQL checks, all analytics tests, TypeScript and ESLint.
  This PR additionally runs four multi-connection tests on disposable PostgreSQL
  17 in CI; local verification also exercises PostgreSQL 18.
- Review the migration and role changes together, particularly migration 017's
  prevention of the legacy worker consuming the same queue. SQL files are
  operator-applied, ordered and not rerunnable.
- Keep receipt, pipeline and dispatch flags unset/false. No cron is added and
  no database scope is enabled by a migration. Review-branch Vercel guards
  remain present; main's existing deployment behavior is unchanged.
- Full-application test failures must be compared with main, not hidden behind
  the scoped green gate. See the PR verification record for actual results.

## Local tests

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test -- --project api tests/api/analyticsContracts.test.ts tests/api/analyticsLean
npx tsc -p tsconfig.analytics.json
npx eslint src/lib/analytics src/app/api/analytics/ingest src/app/api/_lib/supabaseService.ts tests/api/analyticsContracts.test.ts tests/api/analyticsLean*.test.ts scripts/analytics/*.mjs
node scripts/analytics/generate-staging.mjs
node scripts/analytics/generate-reporting-sql.mjs
git diff --exit-code -- sql/analytics/001_staging.sql sql/analytics/014_reporting_views.sql
```

The real concurrent suite is opt-in locally. It accepts only loopback hosts,
the dedicated database `analytics_test_pipeline`, and user `fixture_owner`.
It resets that fixture database's analytics schemas/functions and fixture
reader roles. Use a disposable PostgreSQL cluster with no customer data.
Set `LOCAL_POSTGRES_TEST_URL` to that fixture connection before running the
same suite; otherwise its four tests are explicitly skipped. The CI service
supplies this automatically. Its fixed fixture password is not a deployment
credential.

Coverage includes signed receipt intake, duplicates, source reads, sale/refund
mapping, HTTP processing and health, database permissions, atomic rollback,
lost responses, delayed source visibility, stale owners, revision ordering,
unsupported catalog entries, dead-letter recovery, policy/window staleness,
concurrent claims/completions and lock-order compatibility.

## Activation checklist: not executed

Start with an isolated environment and separately approve any hosted cost.
The code is ready to be exercised, but real credentials, provider permissions,
customer policy and Supabase-to-PostHog readback are not proven by local tests.

### Database and configuration

1. Approve the exact isolated target, shop, date window, supported product IDs,
   eligibility/source decision and sale/refund clock policy.
2. Inspect existing objects/roles, then apply migrations 001, 003, 004, 013,
   014, 015, 016 and 017 in order. Do not replay them blindly.
3. As database operator, insert one `lean_private.pipeline_scope` row:
   `shop`, exact `project_ref`, `enabled=false`, `from_time`, exclusive
   `until_time`, approved `policy`, real `approval_ref` and `actor_ref`.
4. The policy shape is:

```json
{
  "decision": {
    "eligibility": "eligible",
    "commerceSource": "storefront",
    "acquisitionEligible": false,
    "approvalRef": "<actual eligibility and source approval>"
  },
  "productClasses": {
    "<approved numeric Shopify product ID>": "merchandise"
  },
  "financialApprovalRef": "<actual financial-policy approval>",
  "saleClock": "paid_at",
  "refundClock": "refund_created_at"
}
```

These are required reviewed decisions, not recommended defaults. In particular,
do not classify the entire catalog, all business channels or acquisition history
by copying the example. Unknown/deleted products fail closed.

Configure the application secret store, never Git or chat:

```text
LEAN_ANALYTICS_SUPABASE_URL=https://<exact approved project ref>.supabase.co
LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY=<key for that target only>
LEAN_ANALYTICS_PIPELINE_PROJECT_REF=<same approved project ref>
LEAN_ANALYTICS_PIPELINE_SECRET=<dedicated random secret, at least 32 characters>
LEAN_SHOPIFY_SHOP_DOMAIN=<approved shop>.myshopify.com
LEAN_SHOPIFY_ANALYTICS_READ_TOKEN=<dedicated authorized read token>
LEAN_SHOPIFY_WEBHOOK_SECRET=<secret of the approved webhook subscription>
LEAN_ANALYTICS_RECEIPTS_ENABLED=false
LEAN_ANALYTICS_PIPELINE_ENABLED=false
```

Unlike the single-order pilot, this automatic path can later target an explicitly
approved production project. It has no production fallback. The exact URL/ref,
database scope, HTTP authentication and separate enable flags are required.
Never reuse the operational admin token simply because it is available.

### First live test and dispatcher

After separate approval, enable only the isolated receipt route and database
scope/pipeline route. Register approved Shopify topics (`orders/paid`,
`orders/updated`, `orders/cancelled`, `refunds/create`) at
`/api/analytics/ingest/shopify`. No subscriptions are created by the code.
Validate with an approved source order/event; do not generate a real purchase.

Call `POST /api/analytics/ingest/process` with the dedicated bearer secret and
no query parameters. One call handles at most one receipt. `GET` on the same
route and authentication returns counts only, with `Cache-Control: no-store`.
Compare the receipt, retained source, four fact tables and observed report
against independent Shopify evidence, then repeat the delivery and dispatch.
No duplicate facts/current report should appear.

Only after the manual isolated run succeeds, an approved process supervisor
may run `node scripts/analytics/dispatch-pipeline.mjs`. Its environment also
needs `LEAN_ANALYTICS_DISPATCH_ENABLED=true`,
`LEAN_ANALYTICS_RUNNER_ORIGIN=https://<approved deployment>`, and the same
pipeline secret. Optional interval is 60–3600 seconds, default 60.
`--once` performs one dispatch plus health check and exits nonzero on failure
or unhealthy health counts. Without it, calls are sequential with the interval
between attempts; this is conservatively around one receipt/minute per process,
not a high-volume throughput guarantee. No supervisor or schedule is installed.

Route `analytics_dispatch_unhealthy` and `analytics_queue_health` with
`healthy=false` to an approved alert destination, and monitor process liveness
and webhook delivery independently. Dead records, expired leases or a queue
age of 15 minutes mark dispatch health unhealthy. An empty queue does not prove
Shopify delivered all events. Alert transport and hosting are operational
bindings to approve, not external resources created by this PR.

### Failure recovery and stop

- On a storage `503`, assume the write could have committed. Inspect health and
  retry after the lease expires; do not create a replacement receipt.
- Investigate `invalid_receipt`, `source_unavailable`, `mapping_rejected`,
  five-attempt dead work, same-revision conflicts and visibly stale output.
- Only a database operator can call
  `lean_pipeline_retry(work_id, refresh, approval_ref, actor_ref)` for dead work.
  `refresh=false` preserves its source/policy; `true` archives the old snapshot
  to the audit table, clears the source and adopts the currently approved
  policy/window for another read. Completed snapshots cannot be replayed.
- Changing scope policy/window needs a new approval reference and makes
  incompatible existing output stale. It does not reclassify historical orders
  automatically. A later identical-source/same-revision event does not replace
  a prior head; historical policy recalculation requires a separately reviewed
  rebuild/release, not bypassing immutability.
- Stop the dispatcher, set the database scope `enabled=false`, and disable the
  HTTP pipeline flag. In-flight finishes are blocked by the database flag.
  Decide separately whether receipts should continue to queue or the webhook
  subscription should be paused; disabling receipt intake returns 404.
  No cleanup/delete of customer records is part of this procedure.

## Reporting boundary

`lean_analytics.observed_order_daily` contains daily rows for each latest
successful order snapshot. Readers receive only that view through non-login
group `lean_observed_reader`; no login or PostHog source is provisioned.
Require `pipeline_stale=false`, and always retain the
`certification=unverified` and `coverage=webhook_observed_only` labels.
The older report-row `is_stale` flag alone is not this pipeline's health gate.
Never sum historical publications or call the observed subset full-store sales.
Verify view compatibility and read-only privileges in the actual PostHog source
before enabling any query/sync; if physical exports are required, review that
boundary before activation.

The supported subset remains fully paid, unedited, tax-exclusive, eligible USD
merchandise with approved product classifications and bounded component counts
described in L15. Unsupported, cancelled or test orders fail closed and keep
the shop stale for operator review; they are not silently omitted as zero.
Cash settlement, customer/acquisition, spend and attribution remain withheld.
Full historical coverage/backfill reconciliation, settlement and other source
adapters, journey instrumentation and independent certified release for all
21 workbook metrics remain outside this observed-commerce implementation.
