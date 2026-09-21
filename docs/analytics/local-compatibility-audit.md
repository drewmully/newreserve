# MyMully: local compatibility fix and remaining integration work

Reviewed and tested September 20, 2026. This is a local follow-up to the draft
analytics PR stack, not a deployment or a production-readiness approval.

## Bottom line

Do not deploy the existing stack as a finished pipeline. The local correction
removes a shared-wrapper regression and adds reusable receipt/worker database
adapters. Real source-to-schema mapping, scheduled processing, controlled report
publication and PostHog readback still need implementation and live validation.

The September 20 verification was local only; publication into the existing PRs
was authorized on September 21. No merge, remote SQL execution, source
subscription, scheduler activation or paid infrastructure is part of that scope.

## Corrected locally

- **Scheduled-job compatibility:** Separate the existing operational `withJobRun`
  contract from opt-in strict `withAnalyticsJobRun`. All 13 existing callers lack
  analytics completion evidence; they must not suddenly return failure merely
  because the wrapper changed.
- **Honest analytics status:** Legacy normal returns remain operational success
  but are marked analytics-unverified. Their operational watermark is not an
  analytics checkpoint. Strict jobs require explicit evidence and cannot erase
  a known incomplete result with a later success call.
- **Receipt persistence:** The HTTP handler now uses a reusable, validated RPC
  adapter and explicitly configured analytics database credentials. It cannot
  inherit the application's hard-coded production database fallback.
- **Worker persistence:** A reusable store binds claim, finish and fail to their
  SQL procedures. Malformed results fail closed; a lost finish response does not
  trigger an unsafe failure write.
- **Integration coverage:** The synthetic receipt-to-report test uses these same
  adapters against real local SQL. The Shopify fixture transformer and publication
  orchestrator remain test-only, not disguised live adapters.

The compatibility fix preserves legacy partial/skipped behavior; it does not
certify those jobs or repair every pre-existing upstream error path.

## Scheduled-caller audit

All callers below stay on the operational wrapper. This is a static code audit
plus wrapper regression tests, not execution of 13 real provider integrations.

| Existing job | Why a normal return is not analytics completeness |
|---|---|
| weekly-rollup | Catches individual section failures and can write the successful subset. |
| sizing-extract | Early-empty exits and unmatched customer identity require explicit coverage and resolution accounting. |
| subscribers-rebuild | Healthy polling and budget-limited streaming intentionally return before a bulk import finishes; partial bulk output is also accepted. |
| traffic-pull | GA4/PostHog errors are caught; another provider or an empty result can still return normally. |
| firestore-sourcing | Per-collection errors are recorded while other collections continue. |
| google-ads-spend | Missing-auth skip and a single search response do not prove campaign/account/day coverage; no result pagination is implemented. |
| junip-snapshot | A capped review fallback and nullable summary cannot prove full source coverage. |
| meta-ads-spend | Spend writes can succeed while a later ad-set snapshot write fails; positive-spend filtering does not establish verified-empty days. |
| cash-sheet-pull | Missing columns/auth and invalid date or money rows can be skipped. |
| plaid-pull | Pagination has a cap and depends on response totals; missing arrays/invalid IDs need explicit completeness handling. |
| orders-backfill | Orphan or invalid records can be skipped; current order totals and processed timestamps do not prove original purchase or cash settlement. |
| events-retention | A bounded batch can finish with backlog remaining; this is maintenance progress, not source certification. |
| events-reconcile | Bounded retry/customer sweeps cannot prove full coverage; some query/write errors are unchecked and Loop errors can be returned as data. |

No blanket `complete()` calls were inserted. Source-specific certification must
be designed around each source's actual guarantees, not around making status green.

## Verification

| Check | Result |
|---|---|
| Focused analytics suite | 227 passed across 17 files |
| Synthetic receipt-to-report flow | 7 passed, using real local SQL |
| New RPC adapter unit coverage | 22 passed |
| New HTTP handler/configuration coverage | 12 passed, mocked network transport |
| Job outcome and compatibility coverage | 15 passed |
| Focused TypeScript and lint | Passed |
| Generated SQL consistency and tracked diff whitespace check | Passed |
| Full application suite | 562 passed; 11 failed tests and 1 suite-load failure |
| Comparison to recorded baseline | Same 12 named failure entries; no new failures observed |

The existing failures cover blog routes, home document coverage, membership cart,
Mulligan UI/API, legacy analytics dispatch, email inbound/approval and the upgrade
modal suite load. They were not repaired or reclassified as successes.

No deployment build or production concurrency test was run in this follow-up.
Local PostgreSQL and mocked HTTP checks do not establish Supabase/PostgREST
authorization, live Shopify permissions, network behavior or PostHog correctness.

## What must happen next, in order

1. **Land the compatibility correction in the right PR.** Review/publish it into
   L02 before that early slice is merged, then propagate it through the stack.
   A correction only on the final branch would leave the intermediate merge unsafe.
   Receipt and worker adapters belong with L03/L04; integration tests/runbooks can
   accompany the final integration slice. Verify the updated PR heads and CI
   before merging; publication alone does not satisfy the live integration gates.
2. **Build real Shopify evidence mapping.** Convert real versioned webhook/API
   records into the existing schema with complete nested pagination, original
   purchase evidence, refund allocation, revision ordering and independent
   settlement evidence. Do not substitute the local fixture envelope.
3. **Build the production processor and publisher.** Add authorized bounded
   worker scheduling, source enrichment, recoverable candidate materialization,
   independent coverage/reconciliation, report-row generation, approval controls
   and transactional publication selection. The reusable RPC adapter alone does
   not perform these steps.
4. **Complete the other approved sources.** Google Ads, native PostHog events,
   identity/consent and journey instrumentation need real adapters and coverage
   controls for their metrics. Firebase is relevant only to the chosen identity
   evidence; not every commerce test depends on Firebase.
5. **Validate in an approved isolated environment.** Verify migrations, grants,
   real signed delivery, concurrent workers, retry/recovery and independent
   source totals. The user has authorized local tests only; a paid staging
   branch remains unapproved.
6. **Connect the reporting boundary to PostHog.** Verify supported tables/views
   or approved physical exports, restricted reader permissions and synchronized
   publication IDs/counts/totals. Access to the app alone does not do this.

## New configuration, not enabled

The receipt endpoint requires `LEAN_ANALYTICS_RECEIPTS_ENABLED=true`,
`LEAN_SHOPIFY_WEBHOOK_SECRET`, `LEAN_SHOPIFY_SHOP_DOMAIN`,
`LEAN_ANALYTICS_SUPABASE_URL` and
`LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY`. All secrets must remain server-side.
The database URL/key names are deliberately separate from the existing app.
Missing analytics configuration fails closed, without falling back to production.

The strict job wrapper currently logs to the legacy job-run client; a future
analytics runner must explicitly bind logging to its approved environment.
No analytics worker schedule or source subscription was introduced here.
