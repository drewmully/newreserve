# L02: truthful shared ingestion status

The existing shared `withJobRun` now requires explicit completion evidence before
writing `status=ok` or a watermark. It reports missing auth, partial data, schema
drift, failures and unverified legacy callbacks distinctly in metadata, using
existing database status values. Failed status persistence itself fails loudly.

This deliberately fails closed for existing callers that do not yet certify
pagination, writes and schema. Their work still runs; their job result becomes
`ok:false` / `unverified`. It is not safe to infer success from a normal return.
Before merging, review every scheduled caller and its dashboard/alert consumers.
Do not add blanket `complete()` calls merely to turn monitoring green.

This PR changes runtime status semantics if merged. It does not enable a new
schedule. Existing credential-less or partial jobs are not silently suppressed.
Production alert delivery and source-specific completion integration remain
release gates; the later source adapters produce explicit evidence.

Tests cover all incomplete outcomes, verified empty, successful checkpoint,
thrown partial writes, and database status-write failure without service access.
