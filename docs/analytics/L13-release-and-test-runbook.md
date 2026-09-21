# L13: release controls, backfill checkpoints and test runbook

This draft completes the planned core PR split, not production integration.
Live adapters, journey instrumentation, scheduler bindings and customer policy
approval remain implementation work. No migration, source subscription, live
backfill, production setting or warehouse connection has been applied.

## What this draft adds

- Independent source key-set and exact-amount reconciliation helpers, graph
  checks, explicit external-control evidence and policy approval gates.
- Candidate-only mutations: certified/rejected publications and their facts,
  reporting rows, coverage and certifications are immutable to ordinary DML.
  Fact-write transactions lock the publication row against certification races.
- Five generated physical reporting views over precomputed report rows. Each
  domain selects one certified publication, preserves a stale last-good result,
  and supports audited compare-and-swap selection or rollback.
- A bounded, resumable backfill runner and atomic PostgreSQL page/checkpoint
  function. Stored pages are restricted raw staging, not certified facts.
- Explicit null-input checks for the earlier worker's lease functions. Apply
  the stack's final SQL files together; do not deploy the earlier snapshot of
  the worker migration independently.
- Isolated PostgreSQL tests for actual DDL, role restrictions, immutability,
  selection, rollback, staleness, checkpoint conflicts and null-token fencing.

## Boundaries that must not be mistaken for certification

`certifyCandidate` is an operator-facing helper, not an authenticated release
service. Its approval/evidence strings must resolve to real independently
reviewed records; they are not cryptographic attestation. Required tables are
chosen by the approved metric/domain dependency matrix, never by an untrusted
request. All ten table arrays must be supplied, but an independently scoped
commerce publication need not classify every order's attribution.

Graph checks do not replace native-event temporal, consent, lineage or campaign
controls. Seven named external controls require independently reviewed evidence,
including justified non-applicability. Do not set these to true by default.
An approved orchestrator must also validate coverage for every independently
registered account/date/history scope, not merely compare the rows it happened
to fetch. Reconciliation must use appropriate currency/component-separated
amounts and source IDs, not self-derived totals or a net total hiding offsets.

The generated SQL has no automatic migration runner. A trusted operator can
insert certifications/select publications, and the database owner can bypass
ordinary safeguards. Restrict and audit that identity. Runtime service_role has
no grant to select a release or replay work. No reporting reader is provisioned;
the test-only reader grant is not production authorization.

The five views read precomputed reporting rows rather than calculating directly
from source tables. Report computation and insertion, independent certification,
and selection must be orchestrated as a controlled release with one frozen
candidate. Prepare evidence and report rows first, lock the publication against
writers for final validation, then certify and select transactionally. Do not
allow a gap where facts change after validation but before certification.

PGlite executes PostgreSQL locally but does not prove multi-connection behavior,
Supabase/PostgREST permissions, network ambiguity or PostHog sync semantics.
Verify these in an approved staging environment.

## Local verification

```sh
npm ci --ignore-scripts --no-audit --no-fund
node scripts/analytics/generate-staging.mjs
node scripts/analytics/generate-reporting-sql.mjs
git diff --exit-code -- sql/analytics/001_staging.sql sql/analytics/014_reporting_views.sql
npm test -- --project api tests/api/analyticsContracts.test.ts tests/api/analyticsLean
npx tsc -p tsconfig.analytics.json
npx eslint src/lib/analytics src/app/api/analytics/ingest src/app/api/_lib/supabaseService.ts tests/api/analyticsContracts.test.ts tests/api/analyticsLean*.test.ts scripts/analytics/*.mjs
npm test
```

The focused checks are the new analytics gate. Full-repository results must be
compared to the recorded baseline; the original repository already has failures.
Neither a green focused suite nor a successful preview build is end-to-end
production sign-off.

## Before merging any runtime-sensitive slice

- Review the stack in order, starting with L01a/L01b. Rebase or retarget each
  successor onto main after its predecessor is merged, then rerun checks.
  Do not merge the tip into its predecessor and assume it reached main.
- Incorporate the local L02 compatibility correction before merging that slice.
  The audit found 13 legacy callers: retain their operational wrapper and use
  the separate strict wrapper for new analytics jobs. Legacy success and
  watermarks are not analytics evidence. See the local compatibility audit;
  do not add blanket success calls or deploy the old draft's global behavior.
- L03 remains disabled unless its new flag is enabled. Confirm bad HMAC,
  oversized requests and missing configuration do not invoke business effects.
- Review SQL collision behavior, source ID conventions, metric decisions,
  privacy rules, financial allocations and dependency gates with MyMully.

## Staging acceptance sequence

1. **Access and isolation.** Reconfirm the accepted MyMully access and intended
   project at execution time. Provision an approved isolated database. Inspect
   existing schemas and server role before manually applying 001, 003, 004,
   013, 014, 015 in order. These SQL files are not rerunnable migrations.
2. **Live bindings.** Implement/review the Shopify API-to-evidence mapping,
   Google Ads client/account metadata, native PostHog reader/logical event view,
   identity source and worker/scheduler wiring. Add Reserve, Style Game and
   Text-to-Mully callers only after consent/session/context rules are approved.
   Firebase is needed only if the approved identity evidence requires it.
3. **Privacy and access.** Verify anonymous/authenticated app users cannot read
   private facts, identity, receipts or backfill pages. Give a dedicated reader
   only approved reporting views, not public/service-role credentials. Test
   identity withdrawal and deletion propagation before behavior activation.
4. **Receipts and workers.** Use test fixtures with valid/invalid signatures,
   duplicate deliveries, changed-payload collisions, out-of-order updates,
   concurrent workers, lease expiry and a lost completion response. Confirm
   exactly one durable intent/fact set and zero business-side effects.
5. **Commerce and finance.** Cover multi-page orders and nested lines, original
   discounts, split refunds, cancellation, test orders, non-USD, gift cards,
   separate authorization/capture/settlement, chargebacks and reversals.
   Reconcile source keys and amounts independently by currency and component.
6. **Identity and journeys.** Test anonymous-to-known and cross-device mapping,
   conflicts, historical boundaries, opt-out, signed checkout tampering/expiry,
   durable business-action dedupe and an analytics outage that does not block
   checkout or SMS. Verify real preview events in the correct PostHog project.
7. **Spend and attribution.** Verify every expected account/date, Google campaign
   pagination, account timezone/currency, revised spend and verified empty days.
   Test direct/unattributed/pending separately, known customer history, approved
   lookback/grace windows and first-customer credit exactly once.
8. **Reporting.** Reconcile all 21 workbook metrics and all 24 join rules against
   a signed-off fixture workbook. Check ledger/cash/purchase clocks, null versus
   zero, fan-out, mature session denominators, full-month cohort maturity and
   optional click-definition compatibility. Test native event lineage controls.
9. **Backfill and release.** Approve source/date/history scope and cost/rate
   limits. Run a small bounded staging backfill, kill/restart it, overlap live
   ingestion and confirm no gaps/duplicates. Reject a deliberately bad candidate,
   retain stale last-good results, select a good candidate, then rollback.
10. **Warehouse readback.** Establish the approved read-only PostHog connection,
    verify that its actual connector supports the selected-view layout, and
    compare publication IDs, counts and sums after sync. If it requires physical
    exports instead of views, implement that reviewed boundary before release.
    Connect the bounded query layer and test rejection of unsupported cuts.

Only after all applicable evidence is reviewed should MyMully authorize merges,
production migrations, subscriptions, schedules, backfills and publication.
Meta and subscription extensions remain conditional, not silently enabled.
