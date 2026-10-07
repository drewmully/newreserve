# Customer-scoped purchase consumer

`consumeScopedCustomerPurchases` converts an explicitly bound source packet into
selected-order customer conclusions. It does not create a customer generation,
customer table rows, daily new-customer counts or an nCAC denominator.

## Input and integration

The input is `{ packetJson, binding, targets }`. Preserve the original UTF-8
packet bytes. `binding.packetSha256` hashes those exact bytes; `sourceDigest`
uses the source contract's canonical JSON digest. The binding also fixes
project/shop, original capture clocks, current processing-authorization
reference, app/installation, identity receipt and operation-binding hashes.

The event-window preparation caller must derive each target from its own exact
retained commerce document:

```ts
{
  orderGid: document.order.id,
  customerGid: document.order.customer.id,
  createdAt: document.order.createdAt,
  updatedAt: document.order.updatedAt,
  documentDigest: evidenceDigest(document)
}
```

The caller supplies the immutable source binding selected for that input. The
consumer verifies structure, hashes and scope, but cannot authenticate a
caller's self-consistent JSON. Production registration must bind the actual
packet and binding digests to the actual source/admission context. An HTTP
caller must not choose an arbitrary packet or substitute another owner.

The event-window preparation integration must call this consumer for covered
selected orders and return its result alongside the full-builder result. It
must preserve the exact packet/binding/result digests in the disabled prepared
input when supplied. An uncovered order cannot be passed as covered; the
consumer refuses rather than returning a fabricated guest or silently dropping
the target.

This selected-order result must not turn on the full builder's customer gate,
set `storeDaily.new_customers`, set nCAC, or populate `customerGeneration`.
The rest of the event-window commerce calculation remains independent.

## Existing business definition

The definition is
`current-observable-shopify-merchandise-first-purchase-v1`.
It uses the existing paid clock and these retained classification facts:

- Product `8501257044160` is merchandise.
- Complete, unedited annual-access-only orders for product `8501257175232`
  are not merchandise purchases.

`SCOPED_CUSTOMER_BUSINESS_EVIDENCE` pins the exact existing merchandise receipt,
annual-access approval and activation readback. These are historical
classification evidence. They do not renew the expired exclusion operation,
transfer the old Sep30 source inventory/approval, or prove that a particular
order received a database terminal-exclusion audit.

No other product is classified through titles, SKU, shipping requirements or a
null product ID. Back 9 Legacy remains unresolved here. Mixed annual-access
and merchandise lines are not silently treated as annual-only.

The existing commerce mapper validates original amounts, line completeness,
test/cancellation state and full-payment clocks. It is used without a
financial/refund ledger. Its internal `acquisitionEligible=false` input is not
a new-customer exclusion. The consumer selects first/new/returning from
eligible paid merchandise purchases, not that flag.

## Conclusions

Each selected order has one of four statuses:

- `returning` means an earlier eligible purchase is demonstrated.
- `first_observable` means this is the first eligible purchase in the member's
  complete current observable Shopify inventory.
- `unresolved` means its own eligibility or an earlier purchase remains
  unresolved.
- `not_eligible` means it is a known exclusion or has no successful purchase
  payment.

The output includes exact source and target digests, current owner/revision,
original document capture, paid clock and, where known, a prior eligible
order witness. The exact first eligible order/time can remain null for a
demonstrably returning order. Unknown older product classes cannot erase a
positive prior-purchase witness. They can prevent an exact first date.
Unclassified later purchases do not change a proven earlier first purchase.

The selected source is frozen at its actual capture. This is not a new source
freshness claim and does not reopen its acquisition deadline.

## Examples and boundaries

A known earlier eligible purchase can prove that a selected order is returning
even when older unresolved classifications leave its exact first purchase and
cohort date unknown. Another selected order can be first-observable when its
complete customer inventory has no earlier eligible purchase. A subsequent
annual-access-only order is not a merchandise repeat. Actual customer-linked
identifiers and purchase chronology belong in private evidence, not this guide.

The consumer rechecks both complete inventory scans, member/order limits,
source owners/revisions, document digests, original retained-receipt captures,
payment summaries and the fixed source query hashes. It rejects changed,
missing, duplicated or uncovered targets and altered business-definition
pins. It emits no raw commerce lines, transaction arrays or contact data.

Current ownership is not a historical original-ownership interval, browser
permission or proof that no deleted/reassigned order ever existed. The result
does not relabel selected rows as a completed 040/041 import and does not set
`migrationsReconciled`.

All production, whole-day, cohort, LTV and browser-permission flags remain
false. A selected returning conclusion is not a horizon-specific cohort repeat
rate. LTV and cohort maturity remain separate.

## Focused proof

The focused test file covers positive returning with unknown first, annual
exclusion, actual paid clocks, incomplete/changed inventories, privacy shape,
tampered target and source bindings, unknown earlier versus later classes,
partial payments and scope expansion refusal.

To include the genuine private pair fixture, set
`LEAN_TEST_SCOPED_CUSTOMER_PACKET` to the exact retained packet file. That test
pins file SHA256
`e8683aaf7d01b4ed887aff0720c69697029f1ad2ad570138ace7bdf47c2d7714`.
Without that private file only the genuine-fixture case is skipped. No provider
is called by either the test or the consumer.
