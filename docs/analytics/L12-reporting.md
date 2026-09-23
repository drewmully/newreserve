# L12: five reporting projections and bounded query boundary

Pins all five view field contracts, all 21 metric definitions and all 24 join
rules from the workbook. Implements exact-decimal store, acquisition, product,
funnel and cohort projections plus compatible optional delivery ratios.
Definitions remain proposals until explicit customer approval.

Ledger, cash, purchase values, items, spend and customer credits are aggregated
independently. Gate failures return null rather than fabricated zero. Cohort LTV
includes original prepayment sale/discount ledger once, then eligible in-horizon
adjustments, never adding the purchase snapshot again. Immature full cohorts are
withheld rather than survivor-selected.

The query builder accepts only five allowlisted reporting views, bounded dates,
one publication/definition/model and supported dimensions. It emits parameterized
SELECTs, not arbitrary SQL, raw identity queries or unrestricted joins. Monetary
ratios use explicit six-decimal truncation toward zero; approve this display
policy or change it before release.

## Remaining certification boundaries

Input certification must establish uniqueness, complete independent coverage,
source keys, parent relationships, original/adjustment lineage and all applicable
join conditions. Preserving 24 documented rules is not proof every condition has
been exercised live. Optional subscription joins are not implemented. The next
release-control slice installs selected-publication views and rejection checks.

No PostHog production view, query role or agent connector is provisioned here.
Before release compare each supported metric to independently extracted source
totals for an approved period and test denied raw access with the actual reader.
