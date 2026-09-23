# L09: native-event normalization, sessions and checkout diagnostics

Adds a logical-view transform over read-only native-event inputs; no additional
event table or clone is created. Canonical occurrences use project/producer/
family/action identity, not order IDs. Unknown receipt times stay null. Anonymous
and non-buyer actions remain visible without inventing financial facts.

Sessions use observed, scoped session IDs. Approved coverage and grace determine
seven-day maturity. Checkout links come from independent corroborated checkout
or verified first-party context evidence, never timestamp proximity. Multiple
orders convert one session once. Unlinked orders remain in commerce totals.

Activation still requires a PostHog read adapter/view binding, verification of
native UUID/receipt fields, approved event-family schemas, source session IDs,
consent and independent completeness through the conversion window. Current
transforms intentionally leave unverified URL/campaign/device context null.
The final PostHog view and live journey reconciliation are not created here.
