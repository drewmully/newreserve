# Sales, product and refund refresh scope

This note covers the existing commerce path at base
`e97cd1e461749a3fdca6f225c0804fbad4481dde` and the accompanying synthetic
history regressions. It does not authorize a source read, production install,
sample replay, job, merge, deployment or reporting release.

## Reuse the existing path

- **Collection:** `runHistoryJob` and `runShopifyHistory` retain bounded source
  pages and advance a durable cursor only after the entire page succeeds.
  `readPilotSource` obtains the financial projection, original shipping lines,
  referenced refunds and revision comparisons.
- **Composition:** `buildCommerceCandidate` selects the newest retained revision
  of each source order, rejects same-revision or policy conflicts, and calls
  `mapPilotSource` plus the existing store/product formulas.
- **Persistence:** `runObservedReportJob` reads completed retained inputs and
  atomically persists candidate facts and reports. It does not certify coverage,
  select a public reporting vintage or require another formula framework.
- **Webhook runtime:** `runShopifyPipeline` is a different existing entry point.
  Its current source call does not accept a projection option, so it still uses
  the standard query. Do not assume scheduling that entry point inherits the
  bounded history operator's `financial_no_geo` setting.

## Minimum scope for a future production observed refresh

The completed frozen26 sample and its test-only classification are not authority
for a new cohort or the whole catalog. The following items belong in the exact
future activation package, not in new speculative infrastructure.

- **Inventory:** name the shop, finite half-open source interval, scan basis,
  maximum orders/pages and resumable run. A creation-date cohort is not a complete
  financial reporting day. An update-date scan can find refunds on older orders;
  the existing reader requires actual all-order access for that scan.
- **Source minimization:** keep the fixed `financial_no_geo` projection in every
  resumed history invocation. It excludes customer, address, cart and arbitrary
  custom-attribute fields. The separate size opt-in must not silently broaden it.
  The webhook receipt and its current standard source query have a broader
  payload, requiring a separately reviewed minimization/activation choice.
- **Financial inputs:** retain original line quantity, SKU/product references,
  gross price, discounts, successful transaction references and clocks, original
  shipping, tax/duty totals, refund membership and exact refund components.
  Preserve source revision comparisons and every nested pagination bound.
- **Policy:** carry the applicable order eligibility, product classification,
  original-purchase and refund clocks from the approved scope. Do not generalize
  a single-product test policy, substitute current customer profiles, or infer
  bank settlement from a successful payment transaction.
- **Coverage evidence:** separately enumerate the expected source keys and
  component totals for the frozen selected set. Candidate output cannot certify
  its own completeness. Whole-day or whole-store reporting additionally needs
  evidence accounting for every relevant original purchase and later movement.
- **Delivery:** label the result as a selected-order/selected-source observation,
  retain stale and unverified status, and keep unsupported domains null.
  Production installation, scheduled execution, certified selection and PostHog
  delivery remain separate exact actions.

## Supported behavior and explicit stops

The current pilot mapper supports its bounded paid, unedited, tax-exclusive USD
merchandise cases. It preserves later refunds on the refund ledger date without
rewriting original purchase value, order counts, units or AOV.

The mapper stops for unsupported edits without original evidence, tax-inclusive
mapping, unknown/non-merchandise classification, non-USD pilot inputs, unexplained
fees/tips, incomplete connections, excessive cumulative refunds, mismatched or
missing refund sets, unproven refund transactions, refund adjustments/duties,
unexplained totals and source-revision drift. These are not silently excluded
orders, zero values or coverage approvals.

## Synthetic acceptance added here

Five new cases in `analyticsLeanHistory.test.ts` exercise:

- **Late refund composition:** two purchases of the same SKU plus two later
  refund records preserve 40.000000 original merchandise sales, four gross
  purchased units, two orders and 20.000000 AOV on the purchase day. Each later
  refund day has -10.000000 sales and no new purchases; payment processing
  crossing New York midnight does not move the refund ledger clock.
- **Replay and source immutability:** duplicate/newer/older retained inputs
  compose identically without double counting or mutating the supplied evidence.
- **Unknown SKU:** a missing SKU stays in its own unknown bucket rather than
  adopting another order's SKU.
- **Cumulative limits:** separate quantity and amount cases reject refunds that
  exceed the original purchase.
- **Missing/conflicting evidence:** a missing refund or conflicting equal
  revision rejects the build instead of dropping the movement.

The focused history, financial and reporting suites pass 52 tests in both UTC and
America/Los_Angeles. Analytics TypeScript and affected-file lint pass. These are
synthetic, network-blocked checks, not a replay of the real 26-order validation
or proof of live production coverage.
