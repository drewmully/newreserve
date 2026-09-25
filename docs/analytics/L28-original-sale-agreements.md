# Original Shopify purchase and financial history

This revision derives replacement orders from Shopify's immutable sales
agreements instead of treating present-day, edited line totals as the original
purchase. It supplies the existing full-build replacement and deferred-order
paths; it does not certify source coverage or run anything against a customer
account.

## Source and mapping

Shopify documents [sales agreements](https://shopify.dev/docs/api/admin-graphql/latest/interfaces/SalesAgreement)
for order placement, edits, refunds and returns, and immutable allocated amounts
on [sale records](https://shopify.dev/docs/api/admin-graphql/latest/interfaces/Sale).
The fixed query uses Admin API `2026-07`, one agreement per outer page and
100 sales per nested page. Both cursor chains, duplicate IDs, the requested
order and its revision are checked. A final order revision read is required.
The operator sets a total request budget of 2–100, including that final read.
Each response has a one-megabyte limit and a 15-second timeout. There is no
redirect, retry, arbitrary GraphQL or fallback admin credential.

The mapper requires exactly one original `OrderAgreement`, explicit merchandise
classification, retained-source evidence and approved financial clocks.
Original quantity and before-tax merchandise amounts come from that agreement.
Current SKU, product and shipping metadata are not labelled historical; these
fields remain null on this path. All original agreement sale amounts must
reconcile to Shopify's original order total.

The first exact full-payment point establishes the original paid time. A later
edit collection does not move it. Missing payment timestamps, crossing the
original total without exact equality, changes before full payment and incomplete
transaction lists fail. An authorization is not counted as a second payment.

The supported [sale actions](https://shopify.dev/docs/api/admin-graphql/2026-07/enums/SaleActionType)
map as follows:

| Source action | Treatment |
|---|---|
| Original purchase | Original basket, with separate gross, discount and tax ledger slices at approved paid time |
| Later product purchase | New ledger movement; does not rewrite original basket |
| Product return | Signed net merchandise refund plus tax at approved agreement time |
| Product price/discount update | Signed gross/discount adjustment, preserving net merchandise arithmetic |
| Shipping, duty, adjustment and fee | Explicit non-merchandise components, with separate tax |

Later lines not present in the original basket remain unallocated, not linked
to a fabricated purchase line. Product financial metrics are intrinsically
withheld if that day's merchandise allocation is unresolved, even if a caller
supplies a passing allocation flag. Independently supported store totals can
remain available. Non-USD values retain their currency and do not receive
invented USD conversions. Transactions remain unsettled until separate approved
cash evidence is provided.

## Refresh integration

`MullyRefreshInput.originalPurchases` contains the explicit order GID, retained
agreement document and approved mapping policy for each replacement. Preparation
matches every document to the supplied Shopify order revision, derives the
replacement packet and adds revision-bound deferred orders so the ordinary
snapshot mapper does not reinterpret edited lines. Packet lineage includes the
source-document digest and oldest agreement capture time.

Preparation rejects duplicate orders, empty or oversized input, existing
nonempty replacement packets and existing deferred-order inventories rather than
silently replacing independently reviewed evidence. Existing proofs and other
control packets are unchanged. Current edited-line discounts are not reused as
original-purchase offer memberships.

`read-shopify-agreements.mjs INPUT OUTPUT` provides explicit acquisition into
a private 0600, no-overwrite file. Input fields are `kind=shopify-agreements-v1`,
`shop`, `approvalRef`, `orderGid`, `sourceUpdatedAt` and `maxRequests`.
It requires `LEAN_SHOPIFY_AGREEMENTS_READ_APPROVED=true`, an exact
`LEAN_SHOPIFY_SHOP_DOMAIN` and `LEAN_SHOPIFY_ANALYTICS_READ_TOKEN`.
Its result is `snapshot_only`, never enabled or registered.

## Explicit remaining boundaries

This is not an all-financial-cases implementation. Unsupported gift card, tip,
additional fee and unknown sale types; after-tax discount allocation; ambiguous
payment ordering; cancelled/test orders; nonintegral unit-price reconstruction;
and original product/offer metadata still require authoritative mappings.
Gateway chargebacks and their reversals are not sales agreements and are not
invented here. Source completeness and independent accounting controls remain
separate requirements.

The mapper does not create SMS/session links, identity history, consent,
historical completeness, independent expected totals, retention rules or
PostHog deletion verification. Local success must not be described as a live
end-to-end pipeline test or permission to merge/deploy.

## Verification

Synthetic tests cover the actual reader and command, nested pagination,
revision checks, budgets, malformed responses, no-retry behavior, exact
credential selection, private output, original amounts after refunds/edits,
new-line allocation withholding, signed price changes, unsupported cases,
refresh preparation and the actual full report builder.

The combined local revision passed 728 tests across 52 files, with no skips,
including ten disposable PostgreSQL integration/concurrency tests. Analytics
TypeScript, ESLint, generated SQL parity and whitespace checks also passed.
This test record includes the separately gated source collector described in
[L29](L29-fresh-source-collection.md), not a live vendor run.
