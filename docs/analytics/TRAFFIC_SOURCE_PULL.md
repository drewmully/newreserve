# Existing website aggregate ingestion

`GET /api/admin/cron/traffic-pull` already runs daily at 12:30 UTC and upserts
`public.traffic_pulls` on `pull_date,source,metric`. This change repairs that
existing path. It adds no table, schedule, tracker, browser permission, B5 report,
Shopify dependency or full-report requirement.

## What changed

The SDK explicitly disables automatic `$pageview` and the current tracker emits
`page_view`. The PostHog reader now uses that event. `account_created` and
`purchase` retain their existing event names. The three metric names remain
compatible with the table. Their meaning is deliberately limited:

- `visitors`: distinct source `distinct_id` values on filtered `page_view` events.
  This is not a verified unique-person or eligible-native-session population.
- `accounts_created`: recorded `account_created` events, not a customer register.
- `purchases`: recorded `purchase` events, not paid orders or a conversion rate.

The reader reuses the fixed six-rule private configuration and its reviewed
digest. It admits only known-true filter results, using the existing native
reader's null and type handling. Missing email passes the five negative email
predicates; malformed person values or missing/malformed host do not become a
pass. No filter value, contact property, event row or identifier is exported or
stored. The SQL query and key are not logged. Each stored row's `raw` field holds
the version, UTC scope, capture clock, source response/query hashes, filter digest
and explicit event-count basis, not the source response itself.

The endpoint accepts only `days=1` through `days=14`, default fourteen. It queries
closed UTC days with an exclusive end, never the still-open current day. One
PostHog request has a ten-second deadline, 64 KiB response cap, a fifteen-row SQL
sentinel and at most fourteen grouped daily rows. Columns, row types, duplicates,
dates and nonnegative safe-integer counts are checked. Cached, asynchronous,
truncated, malformed and failed responses are refused. A successful exhausted
empty response writes explicit observed zeros for the requested dates. A failed
read writes no PostHog zero rows and leaves older stored rows untouched.

GA4 remains optional when unconfigured. A configured provider failure now marks
the operational job as an error and returns HTTP 503. Valid rows from the other
provider still persist. Provider response bodies are not reflected in the job log
or HTTP response. `job_runs.analytics_outcome` remains operational/unverified,
not certified analytics completion. Stored older rows do not become fresh merely
because a job returned. Use `raw.capturedAt` and the job result together.

The route requires the existing `CRON_SECRET` bearer. A spoofed `vercel-cron`
user-agent alone is no longer authentication. The schedule itself is unchanged.

## Operator inputs and live acceptance

Existing server configuration required for the PostHog branch:

- `LEAN_POSTHOG_PROJECT_ID=353503`
- `LEAN_POSTHOG_QUERY_READ_KEY`, the already verified dedicated query key
- `LEAN_POSTHOG_TEST_ACCOUNT_FILTERS`, the retained private six-rule JSON whose
  canonical digest is `61504f7e32de2ff2d4197a26e25ba57f412891b9c03e6d27b3ef7568e3829819`
- Existing Supabase service configuration and `CRON_SECRET` for this route

No generic key fallback is introduced and no new credential is requested. The
parent operator stages or verifies existing values without exposing them. This
aggregate path does not require, create or infer a v3 visitor grant.

After release, the parent invokes the authenticated endpoint once with `days=1`.
Current provider counts and this new aggregate query's live response are not
claimed as verified by the offline tests. The emitter repair is supported by
the exact released application code; the real ingestion below is acceptance.
Read back `public.job_runs` for that exact run and `public.traffic_pulls` for the
closed day and `source='posthog'`. Require three rows with matching version,
scope and proof hashes; compare values with the actual fixed aggregate source
query. Check both the endpoint result and source-specific errors, not `status`
alone. Then observe the next natural 12:30 UTC run with its later capture clock
and closed-day rows before claiming recurrence verified for the repaired code.
Do not replay an ambiguous invocation automatically.

The previous public table mixed older definitions and open-day observations.
This repair overwrites only its bounded closed-day window and marks those rows
with the new version. It does not certify or relabel untouched historical rows.
GA4 and PostHog are separate sources, not additive unique-person populations.
The existing weekly consumer's cross-source arithmetic is outside this repair.

## Separate forward v3 lane

The read-only inspection at `2026-10-08T16:58:54.114183Z` found no v3 policy,
visitor grants, native receipts or source report operating grants. Enabling an
owner policy only makes the existing optional choice available; it does not
grant consent. The visitor must actually press Allow on
`/analytics-session-preferences`. Only a later independently verified native
session starting within that choice's finite interval can qualify. No SDK reset,
historical grant, replayed choice or old Reserve-consent upgrade is allowed.

That forward permission lane is not a prerequisite for ingesting the existing
bounded aggregate event observations here. These observations do not establish
individual consent, lawful-collection conclusions, paid conversion or B5 metric
acceptance. Any source-policy activation remains a separate parent operation.
