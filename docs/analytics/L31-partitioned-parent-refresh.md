# L31 — bounded partitioned parent refresh (review only)

## What this implements

Explicitly approved discovery windows can now be collected into **one pinned parent**:
up to ten children, each retaining the existing 100-order / 25-discovery-page limit.
Children are immutable source pages, **not jobs or publications**. The existing observed
mapper and full-report graph consume the globally deduplicated source set, so the same
customer, orders/refunds and distinct counts are not summed from independently computed reports.

This is bounded source wiring, not full automatic spreadsheet completion, an unrestricted
history crawl, a live Shopify snapshot, independent reconciliation, certification or deployment.
All 17 evidence sections remain mandatory. Source packets not actually read are retained
verbatim with their existing provenance and freshness rules; collection never manufactures
controls, consent, historical identity or complete purchase history.

## Read-only preparation API

The existing command accepts `--collect-sources` with a new explicit envelope:

```json
{
  "kind": "mully-partition-collect-v1",
  "refresh": "<the existing fully reviewed RefreshInput object>",
  "collection": {
    "...": "<existing approved target, binding, reader controls and source bounds>",
    "maxOrders": 1000,
    "maxRequests": 20000,
    "maxBytes": 32000000,
    "timeoutMs": 120000,
    "partitions": [
      {
        "id": "approved-window-1",
        "history": [
          {
            "from": "2026-01-01T00:00:00Z",
            "until": "2026-01-02T00:00:00Z",
            "pageSize": 5,
            "maxPages": 20
          }
        ],
        "originalPurchases": "<optional L30 explicitly approved targets and policies>"
      }
    ]
  }
}
```

This is schematic, not a ready-to-run production input. The executable synthetic example is
`tests/fixtures/analyticsPartition.ts`; its transport never falls back to the network.
Ordinary collection is unchanged. Shared `discover`, `orderIds` or `originalPurchases`
fields are rejected in this envelope: each child owns its approved windows and optional
original-agreement targets. Collection additionally requires
`LEAN_PARTITION_COLLECTION_APPROVED=true`, all L29/L30 approvals and dedicated source credentials.
These environment gates are not a substitute for permission to run paid/customer operations.

`node scripts/analytics/prepare-refresh.mjs --collect-sources REVIEWED.json NEW_PRIVATE_DIRECTORY`
is the operator command **to review, not an instruction to execute without approval**.
Without the flag, collection input is rejected. It prepares the same five private files as L29.
`refresh-input.json` is a `mully-partition-prepared-v1` wrapper; offline preparation of it
reproduces the bundle exactly, without a source call. No preparation branch registers,
stages, enables, schedules, certifies, selects or exports anything.

### Budgets and source consistency

- At most 10 children, 100 declared order rows per child and 1,000 across the parent
  (overlap counts against declared capacity). Each child retains at most 5 windows /
  25 discovery pages, page size at most 5, with fixed existing Shopify queries.
- Source collection has **one** aggregate request reservation, UTF-8 byte counter and active
  aborting deadline. Child collectors cannot reset these. Worst-case reservations include
  nested original-agreement pages/final revision checks and eight bounded PilotSource reads
  per order. Existing child sub-budgets still apply; no larger-reader fallback.
- Actual PilotSource commerce must equal the fresh child document. PilotSource's existing
  financial/refund validations and final revision read are reused, not reinterpreted.
  Missing mapping authority still fails. Original-agreement targets remain at most 100
  across the parent and cannot be repeated across children.
- Saved source pages contain at most five orders / 4 MB each, at most 20 pages per child,
  and 32 MB aggregate. Owner staging also preflights every serialized RPC argument body
  against 8 MB; it never sends the complete source set in one RPC.
- The existing full input 8 MB, output 16 MB, 10,000 fact rows per domain / native events,
  100 replacements and absolute evidence expiry remain. Hitting a downstream cap fails
  the parent; the 1,000-order ceiling is not a promise that every 1,000-order source fits.
  No unrestricted-volume claim or production throughput benchmark is made.
- Each manifest seals child scopes, IDs/revisions, full source-page hashes, explicit
  owner assignment and the assembled evidence digest. Exact same-content/revision overlap
  is deduplicated by the named owner. Conflicting body/revision, missing/new IDs, duplicate
  child rows, wrong page identity, changed bytes or changed headers fail closed.
- Collected order links / checkout / optional replacements are composed globally. A reviewed
  order link or checkout row outside the parent's selected inventory is rejected, not dropped.
  Nonempty reviewed replacements cannot be silently overwritten by original-agreement collection.

The saved source contract is **pinned**, not a second live vendor scan: later consumers read
only registered immutable pages. Changes to Shopify after capture are not claimed to be
detected or absent. New source data requires a newly reviewed, newly captured parent.
There is no claim of cross-window vendor snapshot isolation.

## Separate disabled owner registration / staging

Review/apply forward migration `036_partitioned_refresh.sql` only under the normal deployment
approval process. Existing migrations are not edited. In local tests, the ordered loader adds
036 after 035; both the PGlite and real PostgreSQL loaders include that sequence.

The explicit owner entry point is `registerPartitionRefresh` in
`src/lib/analytics/partitionRegistration.ts`. Supply a trusted **owner-capable** RPC adapter,
the approved project URL/ref, the prepared bundle and `collected-sources.json.pages`.
It validates the entire page set before any RPC, calls `lean_refresh_register` for version 2,
then `lean_partition_stage_page` once per page. It returns `registered_disabled`, never enables.
The runtime `service_role` cannot register/stage or write/read the backing table directly.
No HTTP endpoint or CLI branch silently acquires owner privileges.

Registration is atomic for the one parent/base/full/spend graph. Page staging is immutable
CAS, intentionally paged rather than one oversized transaction. Equal replay is accepted
only while staging is disabled/unexpired. A partial staging failure leaves disabled state;
runtime reports remain blocked until the exact complete set is present. There are no child
history jobs, no child reports, and no partial selected reports.

Operator activation remains a separate existing approval workflow: project limit, parent queue,
base/full and any spend dependencies. This document does not execute or newly authorize it.

## Runtime and final commit

The existing refresh queue routes the parent through spend (if configured), one global base,
then one global full computation. `lean_report_inputs` verifies the complete parent before
returning a compact descriptor; `lean_partition_page` checks that descriptor's input hash,
enabled/expiry state and each page's actual bytes/hash. It does not repeatedly rehash all
32 MB once per page. The TypeScript consumer reassembles/validates every child before mapping.

Both commit RPCs lock parent state, project limit, queue and all saved pages; full commit
also retains the existing full lease/base-publication fences. Full content/ID/revision and
expiry/kill checks run inside the transaction. Invalid output rolls back the full candidate
and facts together. The global base is a private prerequisite, not a selected report.
Existing certification/selection gates remain untouched.

Equal completed result replay is an immutable no-op, not a new publication or expiry
extension. Changed result replay is rejected. Expired registration/staging or a not-yet-
completed expired parent cannot publish; the existing 90-second new-claim guard remains.

## Local verification and limits

`analyticsLeanPartitionCollection.test.ts` exercises the actual CLI (>100 orders and offline
replay), global budgets/deadline, independent evidence preservation, scope/digest and
same-content ownership checks. `analyticsLeanPartition.test.ts` exercises actual migration,
CLI-file-to-disabled-registration/page-CAS, paged runtime reads and global full consumers
on a reusable synthetic 101-order fixture. It includes cross-child customer deduplication,
original-sale/refund facts, conflicts, missing/extra pages, forged revisions, unchanged-head
tamper, replay, expiry, kill, fact overflow, rollback and least-privilege checks.

The combined local analytics suite passed **857 tests across 56 files, zero skipped**.
This includes 42 partition-specific collection/database tests and **24 real PostgreSQL
tests**, ten newly added for this parent path. The real PostgreSQL checks use separate
connections and a disposable loopback database: 101 orders/one customer/refunds/replay,
disabled page CAS with a measured lock timeout, final-commit locks on pages/parent/stop
controls, stop-before-commit and both lease expirations, missing-page/evidence rejection,
fact overflow and late-domain transaction rollback. Other SQL tests use PGlite.
TypeScript, full analytics lint, generated SQL parity and whitespace checks passed.

These checks establish synthetic/local database behavior, not concurrent production
verification, live source correctness or a production throughput benchmark. No live
source calls, hosted activation or remote deployment were performed to validate this
implementation.

Still unavailable: authoritative SMS event-time/session/permission bridging; historical
identity and complete-purchase-history feeds; independent controls for every covered scope;
gateway reversal/chargeback authority; verified profileless downstream deletion. Those
source facts are not supplied by partition assembly. Larger-than-bounded partitions,
snapshot-consistent vendor reads, automatic approvals/staging and production throughput
verification also remain outside this chunk.
