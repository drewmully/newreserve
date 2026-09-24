# Bounded fresh-source preparation (not automatic full refresh)

The existing `prepare-refresh.mjs` command now has an **explicit, default-off**
collection mode. It reads a reviewed, bounded order inventory and assembles the
supported facts directly into the real disabled refresh bundle. It is not a
scheduler, registration step, activation, reconciliation approval or publication.
No source calls were used to test this change.

## Exactly what is collected

| Read | Result | What it does not establish |
|---|---|---|
| Fixed Shopify order query, explicit order GIDs, bounded line pages, revision recheck | Fresh retained order documents; `orderIdentities` packet | Complete order inventory, historical purchase coverage or independent monetary controls |
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
skipped only for guest-only inventories. A nonempty unique inventory is required.
The total streamed response-byte and elapsed-time limits apply across all
requests, in addition to each existing adapter's own limits. No retries,
redirects, generic URL/table/query input, production-key fallback, or partial
fallback to an old source packet are allowed.

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

**Still required engineering:** automatic order inventory/partition planning
beyond the explicit 100-order pilot; durable resumable multi-partition collection;
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
