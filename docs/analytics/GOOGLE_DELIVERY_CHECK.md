# Optional Google delivery control

The existing read-only Google check can now compare clicks and impressions as
well as cost. This fills a diagnostic gap for the workbook's optional CTR, CPC
and CPM. It does not add columns to the five reports or enable a production job.

The private scope must explicitly set `includeDeliveryMetrics: true`. Its
approval must cover the two additional fields in the independent customer/day
query. Omitted or false preserves the exact cost-only query and result shape.
The existing enable flag, auth, account/date scope and request/page/byte/deadline
limits are unchanged. No additional request is made.

Every requested day must match between the campaign rows and the separate
customer/day response for cost, clicks and impressions. Only then, with USD and
New York metadata, the checker calls the existing `deliveryMetrics` formulas on
all rows. It computes ratios of sums, not averages of daily rates. Count inputs
must be nonnegative safe integer strings. Missing days/counts and empty monetary
bases are unknown, never zero delivery evidence. Explicit zero counts remain
valid, with null ratios for zero denominators.

Read `delivery.state` and `delivery.metrics` for this optional comparison.
The existing top-level `state` and CLI exit code still describe the cost check
only. A matching cost result can coexist with withheld delivery metrics.

This is a bounded Google-only source diagnostic. `metricAcceptance` remains
false. Source authenticity, independent expected inventory, optional-route
approval, immutable report selection and destination reconciliation remain
separate. Do not use this result as an all-marketing rate, a campaign report,
a missing-day certificate or evidence of ongoing operation.
