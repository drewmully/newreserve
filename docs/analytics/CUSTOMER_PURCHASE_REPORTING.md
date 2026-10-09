# Selected purchase customer reporting

`prepareSalesEventWindowReport` now returns an aggregate `customerReport` in
`sourceBinding`. `prepareSalesEventWindowRegistration` exposes that same
report alongside its disabled registration arguments. The existing source
validator and customer consumer run before the summary.

The summary contains no order IDs, customer IDs, contacts or per-person
chronology. It does not add an endpoint, database table, source read or
activation flag. Registration's SQL payload and digest are unchanged.
Existing `store_daily.new_customers` still uses the original paid-window
composition. This summary does not promote another metric.

## Read the denominator

Every row names the eligible purchase-order denominator for its independently
complete paid-date window. First-observable and returning purchase-order
counts describe classified orders, not distinct customers. A customer's
first and later purchase on the same day count as two orders but one customer.

`observedCustomers` counts distinct customers only when every selected
eligible order has a validated customer conclusion. It can be known while
the new/returning split remains unresolved.

`newCustomers` reuses the existing first-purchase composition.
`returningCustomers` is the distinct observed customer count minus that
new-customer count, and remains null whenever the new count is unresolved.
A returning purchase with a prior eligible witness before the report date
does not require an exact first-purchase date.

A same-day prior witness alone cannot establish whether a customer was
acquired that day. Unknown history stays unresolved. Missing customer
projection is not a guest customer or zero customers.

The independently controlled empty paid window can report zero customers.
Missing source evidence cannot. Non-null counts remain `observed_unverified`.
They describe the retained capture, not current store-wide coverage.

## Reporting and acquisition

The summary is available to the existing report-preparation and disabled
registration callers. It is not a new persisted workbook resource. The
existing workbook `new_customers` field still needs the existing registered,
completed full-build and destination selection.

The summary can distinguish acquisition from returning purchases in a
bounded, independently controlled window once its customer source is
supplied. It is not an email audience or a campaign-send approval.
Acquisition cost still needs compatible spend; channel credit still needs
attribution. Cohort repeat rate, maturity and revenue LTV are separate, and
remain unavailable here.

## Current input boundary

The retained `financial-02` input contains two selected September 30 orders
under `financial_no_geo`. That projection does not provide customer IDs.
The separate historical September 29 customer proof cannot fill this gap,
and neither sample proves current whole-store coverage.

The existing read-only path can acquire a same-revision
`financial_customer_id` original for each selected order, then call
`readCustomerScopedPurchases` for those actual customer IDs. It must finish
and recheck each complete current Shopify membership, or refuse above
100 orders per customer or at a transport limit. It must not overwrite the
original financial-only documents or silently accept changed revisions.

That collection still needs the parent's exact bounded operating approval.
Collection is not production admission. A selected-order acquisition alone
also does not establish the independently complete paid-date denominator
required by the existing event-window reporting path.
