# L06: exact financial movements and independent cash

Adds workbook-shaped sales-ledger and payment normalizers. Exclusive allocation
slices must sum exactly to an independent movement total; source IDs determine
idempotency, not delivery IDs. Refunds remain signed movements on their own
effective date. Coherent reversals preserve history and cannot reverse one entry
twice. Unallocated merchandise stays in store totals, not certified SKU metrics.

Cash requires a successful eligible transaction AND explicit approved settlement
evidence. Authorizations, voids, failed/pending transactions and order-paid events
are not cash. Unknown FX stays null. Sales and cash use independent source clocks.

No actual Shopify transaction/gateway history is fetched in this slice. The live
source adapter must construct these evidence envelopes from authoritative sale,
discount, refund, tax, shipping and settlement records. Bind and reconcile
source IDs, component totals, parent transactions and original purchase evidence
before activation. Review settlement-clock policy and adjustment eligibility.
The tested financial transformation is not a settlement certification.

## Follow-up source adapter

L14 adds a read-only Shopify transaction reader and source-shape payment mapper,
including negative refund transactions and validated parent links. It leaves all
cash-settlement fields unproven and does not manufacture sales-ledger allocations
from payment totals. See [L14 mapping and tests](L14-shopify-source-mapping.md).
The source reader is implemented but has not been called against the customer
store; component-level sales/refund mapping and settlement validation remain open.
