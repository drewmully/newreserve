# Bounded fresh-source preparation (not automatic full refresh)

The existing `prepare-refresh.mjs` command now has an **explicit, default-off**
collection mode. It reads explicit reviewed IDs or discovers a bounded inventory
inside the approved `refresh.history` windows, then assembles the
supported facts directly into the real disabled refresh bundle. It is not a
scheduler, registration step, activation, reconciliation approval or publication.
No source calls were used to test this change.

## Exactly what is collected

| Read | Result | What it does not establish |
|---|---|---|
| Fixed Shopify order query, explicit or bounded-discovered order GIDs, bounded line pages, revision recheck | Fresh retained order documents; `orderIdentities` packet | Complete purchase history or independent monetary controls |
| Fixed Supabase customer fields for the freshly read Shopify customer IDs | Current snapshot retained for audit and adapter validation | Historical Firebase ownership, analytics permission or purchase history |
| Optional fixed checkout-receipt RPC for freshly read cart tokens | Signed/authority-validated `checkout` packet | Identity matching by email, phone, timing or guessed consent |
| Optional bounded draft-receipt RPC plus Shopify `DraftOrder.order` query | Verified draft-to-order checkout facts | Invented joins for drafts without an explicit Shopify order relation |

The collector replaces **only `orderIdentities` and, when selected, `checkout`**.
The other 15 evidence sections must come from their existing reviewed sources.
If checkout collection is off, all 16 other sections are retained. Missing
receipts stay missing. A successful collection does not mark coverage complete.

In particular, `identity`, `currentlyPermitted`, `removedCustomers`,
`customerHistory`, independent `proofs`, `externalControls`, `dateCoverage` and
`cohortCoverage` retain their original payload, capture time, hash and source
reference. Bindings only lose sections actually replaced. Preflight rejects
missing, stale, future, tampered or non-independent retained control packets
before any read. All 17 sections and all normal refresh checks are required
again after assembly. No current customer row can refresh a permission decision
or launder stale historical evidence.

## Reviewed input

Use the existing `RefreshInput` as `refresh`; adapter-owned packets may be
absent because the collector will read them. Its original expiry remains an
absolute upper bound. Collection updates `asOf` and `readyAt` to actual local
capture/completion times but **never extends `expiresAt`** or changes retained
evidence timestamps. Every retained packet must remain fresh through expiry.

```text
{
  kind: "mully-collect-v1",
  refresh: RefreshInput,
  collection: {
    approvalRef: actual reviewed read approval,
    projectRef: exact approved Supabase project reference,
    shop: exact approved *.myshopify.com domain,
    orderIds: ["gid://shopify/Order/<actual-reviewed-id>", ...],
    // OR discover: true, with orderIds omitted (never both)
    entities: ["mully", ...], // reviewed actual customer entity values
    checkout: true or false, // explicit; no default
    draftJourney?: { from: UTC timestamp, until: exclusive UTC timestamp },
    maxOrders: 1..100,
    maxLinePages: 1..20,
    maxRequests: 1..500,
    maxBytes: 1024..8000000,
    timeoutMs: 1..120000,
    binding: {
      sourceId: unique non-colliding source ID,
      schemaVersion: reviewed schema version,
      maxAgeSeconds: 1..604800
    }
  }
}
```

The worst-case request reservation is
`orders × (maxLinePages + 1) + 1 + checkout?1:0 + draft?2:0`.
The extra Shopify request checks order revision; the customer read can be
skipped only for guest-only inventories. Explicit IDs must be nonempty and unique.
The total streamed response-byte and elapsed-time limits apply across all
requests, in addition to each existing adapter's own limits. No retries,
redirects, generic URL/table/query input, production-key fallback, or partial
fallback to an old source packet are allowed.

## Optional bounded automatic discovery

Replace `collection.orderIds` with `collection.discover: true` to use the existing
approved `refresh.history` windows. No new URL, query, time range, cursor or
history-feed registration is accepted. The command remains read-only and
default-off; it does **not** invoke `historyFeed` or its mutating RPCs.

- At most five windows, 25 reserved pages, and 100 reserved source rows across
  all windows; page size remains 1–5. `maxOrders` can narrow the distinct-order
  limit further. Overlap is allowed only between different scan bases.
- The fixed creation/update query checks actual token scopes before each
  window. Old creation windows and all update scans require `read_all_orders`.
- Budget reservation adds one scope request per window plus all reserved
  inventory pages, and uses `min(maxOrders, reserved rows)` for order hydration.
  All actual bytes, requests and elapsed time share the collection limits.
- A nonterminal cursor when the budget ends is an error, never a truncated
  ready bundle. Duplicate/cyclic/out-of-order pages and inconsistent overlapping
  revisions fail closed. A terminal empty scan records zero observations, not
  independently verified zero sales.

The sealed manifest records target, approval, original capture, page/cursor
lineage, windows, normalized order IDs/timestamps and SHA-256 digest. Hydrated
orders must match the listed revisions. It is retained in `collected-sources.json`
and the immutable `commercePolicy.sourceInventory`; the digest is included in
the audit. Offline replay validates the digest and approved history scope.

**Later consumer enforcement:** the runtime still reads its own history jobs.
Before mapping or publishing, `runObservedReportJob` requires the complete
deduplicated ID/creation/revision inventory to equal the prepared manifest,
including any deferred orders. Added, missing, conflicting or revised sources
block the build and require fresh preparation; equal replay remains idempotent.
No agreement mapping or financial eligibility policy is changed.

Forward migration `035_discovery_inventory_fence.sql` adds a database completion
trigger as defense in depth. A mismatched source inventory rolls back the entire
`lean_report_finish` transaction, including any facts/reports inserted before
the completion update. It creates no jobs, permissions, activation or selection.
Its application requires separate approval; local tests do not deploy it.

This fence applies to discovery manifests. The legacy explicit-ID mode remains
unchanged and does not acquire an implied full-window inventory guarantee.
Neither mode supplies source snapshot isolation or fresh independent controls.

## Gates and invocation — approval required, not executed here

Set both `LEAN_REFRESH_SOURCE_COLLECTION_APPROVED=true` and
`LEAN_MULLY_SOURCE_READ_APPROVED=true` only in an approved environment. Required
target and dedicated source-credential settings:

- `LEAN_MULLY_SOURCE_PROJECT_REF`
- `LEAN_SHOPIFY_SHOP_DOMAIN`
- `LEAN_MULLY_SOURCE_READ_KEY`
- `LEAN_SHOPIFY_ANALYTICS_READ_TOKEN`
- For either checkout mode: `LEAN_CHECKOUT_CONTEXT_SECRET` (32+ characters) and
  `LEAN_POSTHOG_PROJECT_ID` matching the reviewed policy.

Use narrowly scoped, read-only source credentials; the client cannot prove
server-side key privileges. Keys belong in secret storage, never JSON or Git.
This implementation does not provision credentials, RPCs or grants.

```sh
node scripts/analytics/prepare-refresh.mjs --collect-sources reviewed-collection.json new-private-output
```

Without the flag, preparation remains offline and rejects a collection envelope.
The old `mully-source-v1` offline envelope and standalone
`read-mully-source.mjs` remain supported unchanged.

Successful output is a new owner-only directory containing five owner-readable
files, assembled before the directory is exposed:

- `refresh-bundle.json` — the existing disabled bundle, ready for separate review.
- `analytics-events-view.json` — diagnostic only; no materialization.
- `refresh-input.json` — assembled input, replayable through offline preparation.
- `collected-sources.json` — retained source documents/snapshots.
- `source-collection-audit.json` — target, approval, capture times, digest,
  observed request/byte counts, replaced/retained section names and false
  activation/completeness indicators.

Existing output is refused before source reads. Source or final validation
failure exposes no partial output bundle. Treat the output as customer data:
review and retain it only in approved private storage; never commit it.

## Remaining engineering and source dependencies

**Still required engineering:** partition planning beyond the bounded 100-order
pilot; durable resumable multi-partition collection and global atomic assembly;
separate approved orchestration/scheduling; integration of additional supported
readers into this mode. Shopify cash, original-sale agreements, offers, Google
spend and PostHog behavior are not newly collected by this command. The existing
commerce/spend/behavior runtime jobs remain separate and unchanged; this does
not claim their snapshots are transactionally identical to preparation.

Collection mode rejects an `originalPurchases` option instead of silently
dropping it. Agreement-derived replacements must first be assembled through the
separate reviewed `mully-source-v1`/`prepareMullyRefresh` path, then supplied as a
reviewed `replacements` packet and matching `commercePolicy.deferredOrders` in
the collection input's `refresh`. Those inputs are retained unchanged and must
pass their normal freshness checks. Other unknown collection-envelope options
are also rejected; this mode is not a superset of the offline source envelope.

**Still required source facts:** fresh independent reconciliation extracts and
coverage authorities, reviewed customer permission/removal timelines,
historical identity/complete purchase history, campaign/attribution/session
coverage, SMS event-time/session/permission linkage, and authoritative financial
adjustment/chargeback inputs. Merely having connected accounts does not supply
those facts. Existing journey-permission reads remain an explicit separate path;
this collector does not re-stamp or infer that authority.

**Still unverified:** real target schemas/RPC deployment and dedicated read-key
permissions, customer-specific volumes and limits, source reconciliation, and
any live run. No deployment, hosted read/write, schedule, paid test, deletion or
external mutation is authorized or performed by this local implementation.

## Combined local verification

The collector adds 48 synthetic tests covering the actual preparation command,
private output, replay, dedicated credentials, fixed targets, retained evidence,
source failures and global budgets. The combined revision with original-sale
agreements passed 728 tests across 52 files with zero skips, including ten real
disposable PostgreSQL integration/concurrency tests. Analytics TypeScript,
ESLint, generated SQL parity and whitespace checks passed. No customer source
calls were used.

The subsequent discovery change adds 42 tests covering pagination/limits/replay,
actual CLI subprocesses with a transport that cannot reach the network,
immutable registration, later consumer mismatches and database rollback.
The combined parent run passed **770 tests across 53 files, zero skipped**,
including 14 real disposable PostgreSQL tests. Four of those PostgreSQL cases
exercise equal inventory/idempotent replay and missing/new/revised inventories
with the application check deliberately bypassed: the database rejects the
entire publication, facts and reports without setting completion. The same
rollback boundary is also covered with PGlite. Analytics TypeScript, full
analytics ESLint, generated SQL parity and whitespace checks passed.
All vendor responses were synthetic; no customer records or hosted database
were used.
