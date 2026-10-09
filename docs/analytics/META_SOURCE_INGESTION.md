# Daily Meta source ingestion

The existing Meta cron runs once daily at 11:50 UTC in source-only mode:

`/api/admin/cron/meta-ads-spend?source_only=1`

This mode stores the previous New York day's independently reconciled Meta source packet in `lean_private.marketing_spend_days`. It does not require Google, B1, Shopify, a workbook or report activation. The saved packet remains `enabled=false`.

## Release order

1. Parent applies `sql/analytics/meta_source_ingestion.review.sql` once as the database owner. The executable migration checks the released P6 registrar body, adds one narrowly scoped unique index to existing `public.job_runs`, and adds one source-only service-role RPC. It creates no table and does not grant runtime access to the unrestricted owner registrar.
2. Deploy the code and the single existing Meta cron URL change. Keep `50 11 * * *`; no extra cron is added. Production must already have `CRON_SECRET`, `META_MARKETING_API_TOKEN` and `META_AD_ACCOUNT_ID`. The account must equal `2796962933960445` or its `act_` form after surrounding configuration whitespace is removed. Token bytes are not trimmed. Preview and non-main deployments refuse.
3. Let the next scheduled invocation acquire the next closed day. October 7 was already captured and accepted through the one-off operation. Do not invoke this route again for October 7 merely to test recurrence. If deployed in time, the first scheduled run is October 9 at 11:50 UTC for October 8.

The branch requires the exact bearer secret. A `vercel-cron` user agent alone is not authorization. It accepts no date, account, paging or query override.

## One consumed attempt per day

The existing `withJobRun` inserts `meta-source:<YYYY-MM-DD>` before any native request. The partial unique index covers only the new `meta-source:` names, so ordinary jobs remain repeatable. Duplicate, failed and ambiguous daily attempts cannot create a second claim or repeat a source capture.

The reader loads its own persisted running job and starts only within 90 seconds of that database clock. It then makes exactly three fixed Graph v25 GETs: account metadata, unfiltered account hours, and unfiltered campaign hours. Total capture is capped at 55 seconds and each request, including connection and body reading, at 15 seconds. The job's 90-second deadline also bounds registration.

Each raw response is limited to 1,000,000 bytes. The aggregate limit is 8 MiB, with an effective three-response ceiling of 3,000,000 bytes. There are no retries, redirects, page fetches or error-body logging. The reader refuses duplicate JSON members, malformed UTF-8, non-200 responses, provider errors, incomplete paging and row sentinels. Accepted maxima remain 48 account-hour rows and 1000 campaign-hour rows.

The unchanged hourly adapter derives the New York interval and both complete Pacific query dates. It retains the Pacific source timezone, reconciles account and campaign totals for every returned hour, and refuses unsupported DST query dates. Both native query dates are closed by 11:50 UTC.

## Persistence

The source-only service RPC `lean_meta_source_register(bigint,jsonb,jsonb,text)` binds the packet to its own running job, the previous New York date, the fixed account and deterministic generation `meta_ingest_daily_<YYYY-MM-DD>`. It checks ordered request clocks, fixed queries, complete response projections, native row correspondence, independent hourly totals, empty-state agreement and unchanged packet evidence digests.

The RPC calls the existing owner-only hourly registrar, reads back the exact stored packet and recomputes its PostgreSQL JSONB hash in the same transaction. The runtime compares the full returned packet before reporting `source_registered`. Registration is not source enablement, workbook acceptance or proof of attribution.

The native reader produces the receipts. The SQL checks their correspondence and job binding; it does not independently authenticate an external HTTP response supplied by a compromised service role. The bearer-authenticated route accepts no caller-supplied receipt or packet.

Successful projected receipts are retained in `job_runs.meta.meta_source_receipts`, with request clocks, fixed parameters, body sizes/hashes and typed source rows. Raw provider bytes, access tokens, business names and paging URLs are not retained. The immutable P6 packet contains source/control rows and evidence references. Neither table gets a new automatic deletion policy.

A native complete `data: []` response from both independently queried scopes produces a persisted verified-empty packet. This fixes the absence of a daily source record when Meta is paused. It does not manufacture ad-set metrics or backfill the legacy tables.

## Existing legacy path

The old route body remains available without `source_only`, but the scheduled source-only branch never calls it. There are no legacy `public.marketing_spend_daily` or ad-set snapshot writes and no PostHog events from the new branch.

Actual October 8 readback showed the legacy job ran with zero rows, not a missing-auth skip. Its positive retained data ended September 11. The October 7 native capture then independently verified an empty source/control scope and was stored once by the parent. No second capture is needed to establish that result.

## Failure handling and checks

The daily attempt remains consumed after timeout, malformed response, failed registration or ambiguous completion. Inspect its fixed job and generation before any separately authorized remediation. Do not delete the job, reset its status, change its date, or automatically repeat the request. No catch-up or reconciliation controller is added.

A callback failure recorded by `withJobRun` returns HTTP 503, not a successful HTTP status. An unavailable or already consumed claim returns HTTP 409. Either outcome leaves the daily reservation intact.

Focused tests cover strict route authorization, the real route-to-RPC branch, bounded native transport, complete-empty persistence, refused replay, account/date/receipt correspondence and exact database packet/hash readback. The SQL/runtime test uses fake HTTP and PGlite with the actual released P6 registrar. It is not a native PostgreSQL concurrency or production execution claim.
