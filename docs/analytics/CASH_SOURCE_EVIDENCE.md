# Cash source admission for full workbook reports

`prepareCashSourceRefresh` adds independent cash-day checks to the existing
`RefreshInput → prepareRefresh → runFullReportJob → lean_full_finish` path.
It does not read a provider, register a job, install SQL, activate a schedule,
certify a publication or deliver a report.

The existing cash mapper and `FullBuildEvidence.settlements` stay unchanged.
Use independently evidenced settlement/effective timestamps, or the existing
`collection.cash` option only with its actual approved successful-transaction
clock and gateway policy. An approval-reference string does not authenticate
that decision. This module does not approve `processedAt`, generate a
chargeback, infer gateway completeness or treat bank payouts as customer cash.

## Call contract

Call `prepareCashSourceRefresh(refresh, controls, binding)` before sealing or
registering a new full refresh. `refresh` is the existing reviewed `RefreshInput`,
including valid settlements, payment reconciliation and date-coverage packets.
`controls` is a separately extracted `CashSourceControls` object:

- Exact project, shop and one to 31 New York report dates.
- Distinct source ID and evidence reference, capture time and complete-through
  time. The complete-through time must reach the next New York day before a
  day is admitted.
- References to the applicable cash-clock and transaction-lifecycle decisions,
  an explicitly complete gateway inventory and an independent-extraction claim.
- For each day, independently expected normalized payment IDs, signed USD total,
  completeness and explicit verified-empty status. These values must not be
  generated from the settlement rows being checked.

`binding` is a new reviewed evidence binding with `sourceId`, `schemaVersion`,
`approvalRef` and `maxAgeSeconds`. Its ID must match the control source and
must not reuse an existing binding. The existing intake and refresh checks
validate it and refuse a run that outlives the evidence.

The result contains the normal `refresh` and `bundle`, plus a private `audit`
and retained original coverage/control input. Save all of them with the existing
source evidence. Pass the normal bundle to the existing reviewed registration
mechanism only after its separate operational approval. Never patch an already
sealed or registered bundle in place.

One coverage row carries optional private `cashSourceAdmission` metadata. The
normal intake and refresh digest bind it. Coverage composers must preserve
optional fields by spreading existing rows rather than reconstructing them.
`buildFullReports` rechecks the actual final payment set after merging base,
replacement and settlement payments, before calculating reports. Extra or
changed cash cannot bypass the day controls. The registered evidence reference
is preserved for the SQL finish guard.

No HTTP route or environment flag prepares these controls automatically.
Registration, runtime availability and canonical full-workbook delivery remain
separate reviewed integration and activation steps.

## What changes

Only the cash flag in the date-coverage packet can be narrowed. A matching
control cannot turn an upstream false flag into true. Payments, their authority,
independent payment proofs, other metrics' gates, source read windows and
existing policy remain intact.

Missing, stale, future, incomplete or same-source controls, unknown gateways,
non-USD cash, pending/failed source states and a day-key or day-total mismatch
withhold cash. Missing settlement authority, duplicate settlement IDs or
malformed scope/control input fail preparation. An empty day can yield zero
only when upstream coverage and independent lifecycle evidence are complete,
the expected and actual cash-key sets are empty and the separate control
explicitly verifies zero. Other missing evidence stays null.

The original refresh must pass its original binding lifetimes before any
rebinding. The composite coverage packet also retains the oldest source/control/
coverage capture time. Its reference binds the old packet, settlement packet and controls.
Changed controls change the immutable refresh digest and job IDs. A repeat of
identical inputs is deterministic. No new capture time makes old evidence fresh.

The preparation audit is preliminary and says `finalPaymentSetChecked: false`.
The consumer checks every final cash-eligible payment, including base and
replacement rows, against the controlled settlement set. A mismatch withholds
cash rather than publishing untested amounts or a verified-empty zero.

The existing full builder still requires the independent payments proof and
valid parent order/payment graph. This admission is necessary evidence, not
sufficient certification. Reports retain `observed_unverified` and stale
markers until the separate publication process establishes otherwise.

## Existing warehouse candidates

The reviewed `analytics_analytics.transactions` metadata describes an order-level
physical table: order dates/statuses and order/refund totals. The supplied
metadata has no gateway, transaction currency, processed/settled timestamp,
parent payment or dispute/chargeback fields, and no declared primary/unique
constraint. Its writer is not established. Do not map its order total or
`order_date` to collected cash.

The related staging order view uses order creation time for both its order date
and update clock and omits available paid/currency/refund/update fields. Neither
relation proves transaction-lifecycle completeness. This is a source assessment,
not a request for a bank feed. No warehouse-row parser is added.

## Acceptance boundary

Synthetic tests exercise the existing real full builder and runtime finish
payload, signed chargebacks with separate source evidence, cash versus sales
dates, extra base/replacement cash, same-total/wrong-day rejection, verified zero,
original-binding expiry preservation, immutable replay and metric-specific
withholding. They do not prove actual source authority,
live financial totals, installed runtime availability, persistence or delivery.

The remaining source binding is concrete: identify the payment/gateway source
with stable transaction/order/parent IDs, status/kind, signed amount/currency
and the approved effective-time authority; provide independent complete
gateway/lifecycle coverage and day controls for the selected window. If the
existing successful Shopify transaction clock is chosen, bind its actual
approval and gateway list and separately resolve dispute/adjustment coverage.
Do not infer these fields from paid order flags or absent dispute records.
