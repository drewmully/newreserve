# Customer-scoped purchase source

`readCustomerScopedPurchases` acquires a finite current Shopify order inventory
for one to four explicitly selected customer IDs. It does not need a whole-shop
040 import. It does not modify 040/041, register a run, create customer authority,
compute workbook metrics or write a destination.

The named source contract is `shopify-current-customer-orders-v1`. Its population
is **all currently observable Shopify orders associated with each exact selected
customer ID**, with no creation-date, paid-status or test/cancellation filter
that could hide relevant orders. Purchase clocks can precede order creation, so
a report cutoff must not be used as a creation-date filter here. The evidence
retains original creation, current revision and payment clocks separately.

## Actual acquisition

The input fixes current project `xnfjdbpjuaezxjgargto`, shop
`mullybox-store.myshopify.com`, actual app/installation IDs, the current project
authorization reference, customer GIDs and at least one known order anchor per
customer. The reference records existing authorization provenance; it does not
create a new permission register or grant historical browser consent.

The loader checks shop/app/installation and actual `read_orders`,
`read_all_orders`, `read_customers` and `read_products` scopes. It uses the fixed API version
`2026-07`. These checks happen again after hydration.

For each member it uses only `customer_id:<numeric ID>` with:

1. An exact `ordersCount`, bounded at 101. Approximate counts or more than 100
   orders refuse before hydration.
2. Up to four 25-order metadata pages. IDs, customer IDs, original creation and
   current revision must match the requested scope. Pagination must reach EOF,
   with no duplicate orders, repeated cursors or missing anchors.
3. The existing `readShopifyAnalyticsOrder` financial_customer_id hydration.
   Customer ID and revision are checked across nested pages and a final re-read.
   Every hydrated header must exactly match inventory.
4. A second count and full inventory scan. Its entire sorted ID/owner/creation/
   revision set must equal the first scan.

Membership is source-observed, not reconstructed from email, marketing flags,
Firebase sync status or missing fields. Null or omitted customer on a selected
member's order refuses; it never creates a guest.

## Reusing an existing cash-owned source

Optional `retained` documents carry their original `capturedAt` and `evidenceRef`.
They must be exact `financial_customer_id` documents for this shop and API, and
match the newly observed inventory revision and owner. The loader preserves their
capture/reference and does not hydrate them again. Missing customer, old revision,
extra records or incomplete lines fail; they do not trigger a silent refresh.
`documentDigest` hashes the canonical commerce document under this new contract.
It does not replace an upstream native `sourceSha256`, which may hash
`JSON.stringify` of the complete PilotSource. Preserve that original receipt
and identify it through the retained evidence reference.

If the cash source did not select customer, it cannot supply this evidence.
Coordinate the projection with its existing owner rather than duplicate reads.

## Returned evidence and limits

The result retains both inventory scans, current source documents and hashes,
actual capture clocks, query hashes and request/byte counts. The existing
`mapShopifyTransactions` supplies successful SALE/CAPTURE processing clocks,
preserving null clocks explicitly. Failure attempts and test transactions are
not successful payment evidence. A successful payment alone is not proof of a
fully paid, eligible purchase; the existing commerce mapper and actual per-order
decisions remain responsible for that determination. Edited orders are marked
for original-purchase review rather than silently treated as unedited history.

No financial ledger, settlement, browser/session record or revenue-LTV evidence
is requested. Documents can pass unchanged to the existing commerce mapper.

The operation has a 120-second absolute limit, a caller expiry at most 15 minutes
away, at most 1,250 requests, 64 MiB response/output limits, an 8 MiB per-response
limit, and at most two line pages/500 lines per order. Callers may lower request
and byte budgets. Any source error, drift, budget exhaustion or nonterminal page
returns no evidence packet. There is no retry, truncation, split-member behavior,
database call or background continuation.

The output says `pagination: exhausted_and_rechecked`, not whole-store or
all-time completeness. It is not an atomic Shopify snapshot. It makes no
claim about deleted orders, old ownership intervals or migration coverage, and
always has `productionAdmission: false`. No existing completed-generation field
is populated.

## Using the approved Shopify-only definition

For an already approved Shopify-only, currently observable order population,
an actual successful run supplies that population's selected-customer inventory,
not merely the first recent order. Its documented limit is not a new request for
proof that no deletion or migration ever happened. A concrete conflicting owner,
missing anchor, changed revision or known missing original needs resolution.
Hypothetical migrations or the store-wide count of two over-limit customers do
not establish a problem for these selected members. Their counts come from the
actual per-customer count and pages.

The packet still needs parent-reviewed integration before customer metric
admission. It is deliberately not accepted as an existing 040/041 generation or
converted into `migrationsReconciled:true`. Current source ownership is not
historical browser consent. Full-month cohort membership, horizon/grace and
report-wide denominators cannot be claimed from four selected customers alone.

## Private validation

Synthetic transport fixtures exercise the real acquisition path, pagination,
existing hydration and transaction parser, plus handoff to the existing commerce
mapper. They cover exact 100 versus 101 orders, missing/changed ownership,
revision and membership drift, refused incomplete pagination, purchase clocks
before original creation, retained-source reuse, successful payment clocks,
privacy projection, access checks and budgets. No provider was called.
