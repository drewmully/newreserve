# Registered Shopify history jobs

This PR wires the L17 reader to a private, immutable database registry and
`POST /api/analytics/ingest/history`. It adds no schedule and starts no job.
Apply migration 018 only to an approved isolated database first.

## Registration and activation

An approved database operator inserts `lean_private.history_jobs` with the exact
target project, shop, half-open creation-time window, page size (1–5), maximum
page count (1–2,000), evidence reference and actor. It defaults to disabled.
Changing a scope requires a new run ID and approval; only `enabled` can be
toggled without replacing the scope. This registry is separate from webhook
processing, so activating webhooks does not implicitly authorize history.

After approving the source scope, spend and target, set the explicit analytics
database URL/service credential and Shopify domain/read token. Set
`LEAN_ANALYTICS_PIPELINE_PROJECT_REF`, `LEAN_ANALYTICS_HISTORY_RUN_ID`,
`LEAN_ANALYTICS_HISTORY_SECRET` (at least 32 characters), and
`LEAN_ANALYTICS_HISTORY_ENABLED=true`. Enable that exact database job.
None of these actions is performed by this PR.

An authenticated empty-body POST reads at most one page. Repeat only after the
previous response or timeout; the next invocation re-reads the saved checkpoint.
The page budget is a hard stop, not a price guarantee. Provider/API work,
hosting, database compute and downstream sync costs need separate approval.
Disable either the environment flag or database job to stop subsequent work.

## Safety and recovery

Sources and checkpoint commit in one transaction. Concurrent dispatches may
make redundant read requests, but only one can win the page-number/cursor CAS.
Lost commit responses are resolved by the next registry read. Pagination loops,
cross-page duplicate order IDs, wrong-shop sources and out-of-window sources
fail closed. No source response or customer data is returned by the route.
Incomplete/budget-exhausted runs cannot be read through the downstream page RPC.
Keep retained sources private and apply the customer's approved retention policy.

`complete` means the bounded creation-time inventory finished. It does not mean
the financial-date report or full store is reconciled. No coverage certification,
publication selection, PostHog setup or recurring processing is included here.

## Local test acceptance

Exercise disabled/unauthorized routes, immutable scope, wrong targets, page
budgets, duplicate/cyclic pages, CAS retries, atomic rollback and hosted default
grants. Then test the actual source reader with synthetic GraphQL responses.
Hosted and real-customer end-to-end checks remain separately approval-gated.
