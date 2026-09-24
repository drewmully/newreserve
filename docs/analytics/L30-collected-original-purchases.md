# Explicit original-purchase collection during refresh preparation

This extends L29's **read-only, default-off** `prepare-refresh.mjs --collect-sources`
path. It does not activate or register a refresh, run history feeds, publish
reports, establish financial reconciliation, or complete the spreadsheet.
L29's restriction on preassembled `originalPurchases` remains: passing that field
on the envelope or `refresh` is rejected. The new exception is the explicit
**collection plan** below; it reads fresh documents instead of accepting a packet
and silently dropping or relabeling it.

## Approved input contract

In a `kind: "mully-collect-v1"` input, the optional
`collection.originalPurchases` object has exactly:

```json
{
  "maxRequestsPerOrder": 3,
  "orders": [{
    "orderGid": "gid://shopify/Order/1",
    "policy": {
      "decision": {
        "eligibility": "eligible",
        "commerceSource": "storefront",
        "acquisitionEligible": true,
        "approvalRef": "REPLACE_WITH_REVIEWED_COMMERCE_APPROVAL"
      },
      "lineClasses": { "3": "merchandise" },
      "financialApprovalRef": "REPLACE_WITH_REVIEWED_FINANCIAL_APPROVAL",
      "saleClock": "paid_at",
      "changeClock": "agreement_happened_at"
    }
  }]
}
```

These are illustrative IDs, **not authority to run a source read**. Approve actual
targets and policies first. Targets must be a unique, nonempty subset of the
fresh explicit/discovered inventory, within `collection.maxOrders` (at most 100).
Even in discovery mode, original-purchase targets are explicit: edited flags do
not auto-approve financial treatment. Historical line IDs/classifications must
come from reviewed authority, not present-day product classes or inferred SKUs.

Enable `LEAN_SHOPIFY_AGREEMENTS_READ_APPROVED=true` in addition to L29's collection
and Mully read approvals. Reads use the same exact approved shop and dedicated
`LEAN_SHOPIFY_ANALYTICS_READ_TOKEN`; never fall back to a storefront/admin token.
Keep all existing project/target, scope, schema and expiry checks.

The supplied `collection.binding` **explicitly authorizes the new source ID,
schema version and freshness bound** for all newly collected sections, including
`replacements`; `collection.approvalRef` is the binding approval. It must not
reuse an existing evidence source ID. New financial provenance is not assigned
the old independent source's identity or independent-control flag.

## Empty-packet prerequisite and resulting evidence

Before any source reads, a `replacements` packet must already exist with an
actually empty array. The old packet must validate against its own approved
binding, scope, capture time, payload hash and schema, and remain fresh through
the absolute refresh expiry. Missing, stale, unbound or tampered empty evidence
is not accepted as an empty source result. Any nonempty reviewed replacement
packet or existing deferred-order set is rejected; mixed-source merging needs
separate review, not automatic overwrite.

For each approved target the collector:

1. Hydrates the Shopify order and checks its revision against discovery, if used.
2. Calls the existing fixed-query `readShopifyAgreements` with that exact revision.
   Outer agreement pages, nested sale pages and a final revision recheck all
   count. A changed source aborts; no retries or wider fallback.
3. Retains the full agreement document with its actual successful capture time.
   The generated source evidence reference hashes both the fresh order document
   and agreements. Caller-supplied source references are not accepted.
4. Reuses the same pure original-purchase packet preparation as
   `prepareMullyRefresh`, which calls the existing `mapShopifyAgreements`.
   Original paid-time, gross, discount, tax, quantity and refund/edit treatment
   are unchanged. Unsupported or missing authority still rejects.
5. Replaces only the validated empty `replacements` packet, recording the oldest
   actual agreement capture, a digest of the agreement documents and the mapped
   payload hash. Derives exact revision/reference-bound `deferredOrders`.

Order-identity/optional checkout handling remains as in L29. Every other evidence
packet keeps its original payload, hash, capture, scope, source record reference,
schema and binding authority. No identity history, permission, offer registry,
settlement, historical coverage or independent control is created here.

`collected-sources.json` now retains `originalPurchases` documents and policies;
the five private output files are published together only after validation.
`refresh-input.json` replays through the offline command without further reads.
The actual observed consumer must find every deferred order at the prepared
revision; the full consumer requires its matching replacement reference/revision
before claiming publication. Discovery's later whole-inventory fence remains in
force. Equal replay does not substitute mutable current-order totals.

## Shared read limits

`maxRequestsPerOrder` is an integer from 2 to 100 and includes the final recheck.
The global worst-case reservation adds
`target count × maxRequestsPerOrder` to all preexisting inventory, order-hydration,
customer and optional checkout/draft requests. It must fit `collection.maxRequests`
(at most 500). Actual requests share the same byte limit (at most 8 MB), active
deadline (at most 120 seconds) and fixed endpoint allowlist. Per-response and
nested-page limits of the existing agreement reader still apply.

Nonterminal pages at a budget, missing/revised targets, response overflow,
deadline expiry, capture-clock reversal and a late preparation success all abort
without a ready bundle. Raising one limit, omitting a recheck, restamping an old
packet or treating an unsuccessful read as zero is not a recovery path.

## Local verification and remaining boundaries

Synthetic tests exercise real adapters, the CLI subprocess, private atomic
outputs, offline replay, observed/full consumers, independent packet preservation
and source/binding/budget failures. No customer read or hosted mutation was used.
The agreement mapper's existing tests remain applicable; this change does not
add financial cases or modify its interpretation.

The parent combined run passed **805 tests across 54 files, zero skipped**,
including 14 real disposable PostgreSQL integration/concurrency cases. The new
agreement-collection suite has 36 tests, including five real CLI subprocess
cases and actual observed/full consumers with synthetic RPC transport.
Analytics TypeScript, full analytics and fixture lint, generated SQL parity and
whitespace checks passed. These results do not verify live Shopify behavior.

This is bounded source wiring, not unattended operation or production-volume
partition assembly. All 17 evidence sections are still required. Their remaining
source authorities/readers, verified SMS-to-session permission links, historical
identity/purchase coverage, independent controls, gateway chargebacks and verified
downstream deletion are not supplied by agreement collection.
