# Optional order-time shirt-size evidence (local implementation)

This is a private, explicit opt-in dimension of an existing order item, not a new
sales pipeline, live collection approval, current fit profile, or fulfillment
claim. No jobs, feeds, hosted writers, public reports, or customer joins are enabled.

## Supported path

1. After **separate exact approval for live collection**, select
   `projection: "financial_no_geo_order_size"` on the existing
   `readShopifyAnalyticsOrder` / `readPilotSource` reader. Preserve the sanitized
   returned document durably, then supply its real reference as `evidenceRef`.
   Synthetic tests use injected fetch; no live source has been exercised.
2. Supply `PilotPolicy.orderSize`:

   ```ts
   orderSize: {
     policyRef: "approved-policy-reference",
     productSemantics: {
       "123": "requested_box_top_size",
       "456": "purchased_shirt_variant",
     },
   }
   ```

   IDs here are illustrative numeric product IDs, **not approved catalog entries**.
   The product mapping is explicit; SKU, product title, customer address, and
   current profiles are never used to infer shirt size.
3. For offline composition use
   `buildCommerceCandidate(records, scope, { orderSizeSidecar: true })`.
   The optional result `order_item_sizes` sits **beside**, not inside, the ten
   existing `facts` tables. Direct `mapPilotSource` accepts the same explicit sink
   option as its fifth argument. Without it, a size policy fails closed.
   Existing latest-revision selection also selects the size evidence; it never
   carries a known size forward over newer missing evidence.
4. Only after a separate reviewed installation of optional migration
   `046_order_item_sizes.sql`, an owner can persist the companion in the **same
   explicit SQL transaction** as the already-approved fact write:

   ```sql
   BEGIN;
   -- Existing approved fact/publication write, unchanged.
   -- It must create the referenced order_items in a candidate publication.
   SELECT lean_private.write_order_item_sizes(:publication, :size_rows::jsonb);
   COMMIT;
   ```

   The placeholders are not an executable production load. Roll back the entire
   transaction on any error; never commit facts separately and claim atomic size
   persistence. The writer validates exact fields, enum/source consistency,
   publication, nonblank evidence/policy references, and composite item/publication
   FK. It is insert-only, not an evidence-rewriting upsert. An empty sidecar needs
   no call. SQL errors must not be exposed as raw diagnostics.

Standard hosted writers remain unchanged and size-off. They do not transport this
sidecar; `mapPilotSource`/candidate sink guards stop accidental silent dropping.
The historical bridge reports unsupported mapping rather than adopting a size
projection. Activating any runtime integration needs a separately approved exact
change. No environment fallback selects size collection.

## What the evidence means

| Product policy | Accepted source | Meaning / limit |
| --- | --- | --- |
| `requested_box_top_size` | Exact `Top size` line custom-attribute key | Requested box top size (GiftModal's subscription-line key). Does **not** establish which shirt was purchased or shipped. |
| `purchased_shirt_variant` | `LineItem.variantTitle` snapshot, only if the whole trimmed title is a canonical size | Purchased shirt variant evidence, only for explicitly approved shirt products. Never proves fulfillment. The attribute alone cannot supply this meaning. |
| Unmapped/deleted product or non-merchandise item | None | Unsupported; no catalog/profile fallback. |

Values normalize by trimming and uppercasing to **XS, S, M, L, XL, XXL, XXXL**
only. No `2XL` aliases, free-text interpretation, or token extraction from
`Blue / XL`/other composite titles. No `ProductVariant.selectedOptions` lookup.
The [2026-07 Shopify LineItem reference](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/LineItem)
defines `variantTitle` as the order-creation snapshot; current variant/profile
fields are not purchase evidence.

| `size_status` | Retained value / behavior |
| --- | --- |
| `known` | One canonical value from the policy's selected source. Repeated identical attributes agree. |
| `missing` | Selected field was projected but has no size (e.g. empty attributes or null title). |
| `invalid` | Approved attribute has non-enum/free-text value or a malformed field. Valid + invalid duplicates remain invalid. |
| `conflict` | Multiple different canonical `Top size` values, or both supported attribute and title signals disagree. Value null; no winner is guessed. |
| `unsupported` | Product semantics unsupported, or selected title is noncanonical/composite. Value null. |
| `projection_absent` | Explicit size projection/selected field is absent. Value null and source `none`; never treated as “customer had no size.” |

Conflict between valid attribute values takes precedence over invalid duplicates.
Only the policy's selected source can produce a known size; a missing/invalid/
unsupported selected source is never filled from the other channel. When both
channels have valid but different sizes, conservative conflict treatment withholds
the dimension without changing financial facts. Every row carries semantics,
source channel, policy reference, sanitized-source reference, and `order-size-v1`.
Malformed or unsanitized retained size documents fail closed rather than retaining
unapproved content in a diagnostic.

## Privacy and compatibility boundaries

- Shopify `customAttributes` has **no key-filter argument**. The opted-in request
  transiently receives the broad attribute response in memory. Every response page
  is immediately projected to enum/status evidence for exact `Top size`; unrelated
  keys, invalid/free-text values, raw titles, and unrequested line fields are
  discarded before returning a retainable document. The opt-in also positively
  selects the fixed financial field shapes at the root and every nested object
  (product, money, allocation, transaction, count, and page metadata), and rejects
  objects masquerading as selected scalars. No raw error body is logged.
  This transient upstream exposure still requires separate live approval.
- `financial_no_geo` query and output are unchanged. With no size policy, no new
  result keys appear. Monetary formulas, quantities, refunds, AOV, reports, all ten
  mandatory contracts, and legacy dynamic `jsonb_populate_recordset` writers are
  unchanged. The companion has its own SQL constraints, not new mandatory fields
  in `lean-contracts.json`.
- The composite `(order_item_id, publication_id)` FK ties private size rows to
  existing order items. The table has RLS and no public/anon/authenticated/service
  grants; its invoker function is owner-only. It is not in any reporting view.
- Adding nullable columns to `order_items` would change full-row `to_jsonb` hashes.
  This companion avoids that: local tests compare the actual saved SQL044 input
  and digest before/after046 **and after inserting companion evidence**.
- The historic exact sample schema allowlist remains **21 private tables**.
  Optional046 makes that schema **22**; the old exact gate must reject it.
  Future packaging/installation requires a newly reviewed schema allowlist and
  explicit approval. No historical approved SQL, frozen records, sample digests,
  or sample load is changed, opened, or replayed.

## Local checks

`tests/api/analyticsLeanOrderSize.test.ts` covers source sanitization/pagination,
canonical enums and withheld outcomes, policy semantics, default shape/money
parity, latest-revision selection, ordinary-writer rejection, real local SQL
roundtrip and rollback, enum/provenance/FK/ACL failures, 21→22 schema opt-in, and
the saved044 hash compatibility boundary. These are synthetic PGlite tests, not
evidence of live Shopify values, deployed SQL, customer approval, or production
PostgreSQL execution.

The independent `analyticsLeanSizeProjectionPrivacy.test.ts` adds an adversarial
response with unrequested root and nested fields. It reproduced the initial
retention defect and now verifies that those fields are absent while financial
amounts, product references, and canonical size evidence are preserved.

The combined local review passed 138 tests in UTC across the size, independent
privacy, history, mapping, selected-order, financial, and reporting suites.
The 50 affected size, privacy, and history tests also passed in
America/Los_Angeles. Analytics TypeScript, affected-file lint, and whitespace
checks passed. No source collection, hosted execution, schema installation,
sample replay, or deployment was performed for these checks.
