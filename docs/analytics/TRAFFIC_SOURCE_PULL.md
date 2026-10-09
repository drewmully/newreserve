# Existing website aggregate ingestion

`GET /api/admin/cron/traffic-pull` already runs daily at 12:30 UTC and upserts
`public.traffic_pulls` on `pull_date,source,metric`. This change repairs that
existing path. It adds no table, schedule, tracker, browser permission, B5 report,
Shopify dependency or full-report requirement.

## Recorded page-view and add-to-cart counts

The event query now uses `traffic-filtered-utc-v2` and stores five event rows per
closed UTC day. The original visitors, accounts_created and purchases definitions
are unchanged. It adds:

- `page_views`: `countIf(event='page_view')`, recorded page-view events. This is
  not unique pages, people or SDK-native sessions.
- `add_to_cart_events`: `countIf(event='add_to_cart')`, recorded add-to-cart
  events. The existing batch emitter can emit one event per item. This is not
  unique carts, units added, successful checkouts or session conversion.

Both reuse the existing events source, six filters and UTC query window.
`add_to_cart` joins the query's fixed event allowlist; no new event is captured.
The same request returns the additional columns, so the route still makes two
PostHog requests, one event aggregate and one independent native aggregate.
Native query, classification, version, SDK and v3 permission behavior are
unchanged. The parser requires exactly five nonnegative safe-integer event
counts. Old or truncated responses fail instead of defaulting missing fields to
zero. Complete empty responses still produce observed zeros.

Event-row provenance adds `pageViewsBasis='recorded_page_view_events_not_unique_pages'`
and `addToCartBasis='recorded_add_to_cart_events_not_carts_or_units'`. Every newly
captured event row has the v2 version and new query/response hashes; untouched
v1 history is not relabeled. These remain recorded-event observations, not
deduplicated canonical actions or paid-order evidence.

## Basic native-session adapter

The route also stores `metric='native_sessions'`, one additional PostHog row per
closed UTC day. It counts existing SDK-native sessions starting that day with
exactly one native event at the source session start, an SDK-shaped UUID and all
six existing filters known true on that entry. It does not count the manual
`session-...` namespace, infer identities, join orders or create source events.
This is a basic filtered source observation, not the workbook's permission-bound
`measured_sessions`, a unique-person count, conversion or attribution.

The new query groups existing `sessions.session_id` and `$start_timestamp`, joins
the native event on **both** `$session_id` and the exact source start timestamp,
and returns daily counts only. No time-only association is made. A unique entry
with a known false filter is excluded. Missing or multiple start entries,
non-SDK IDs, and unique entries with unknown filter results and no known false
filter remain unclassified. They are not assumed permitted or excluded.

The row's `raw` provenance includes:

- `version='traffic-native-sessions-utc-v1'`, UTC bounds/capture and proof hashes.
- `nativeSessionsBasis='sdk_uuid_starts_with_one_six_filter_true_entry'`.
- `nativeInventory`, `excludedNativeSessions`, `unknownNativeSessions`.
- `classification='partial_source_filter_classification'` when any unknown
  remains, otherwise `complete_source_filter_classification`.
- `permissionBasis='existing_source_aggregate_not_v3_permission'` and
  `provesMeasuredSessions=false`.

The value is the known included count even when classification is partial.
Consumers must display that state and unknown count, not relabel it as a complete
eligible-session population. A zero with unknown entries means no classified
positive entries, not no traffic. These are source-filter classifications, not
consent determinations. This adapter uses the authorized existing aggregate
reporting scope; it does not enable or bypass the separate v3 choice, policy or
retention rules. It introduces no raw-event copy or new retention setting.

The original three event definitions remain unchanged in the five-metric v2
query. Native sessions use a second independent request through the same bounded reader.
Each request is fresh, has a ten-second deadline, a 64-KiB response cap and the
same fourteen-day limit. No retry or polling is added. A native failure keeps
all five valid event metrics, writes no native zero, sets
`posthog_native_error` and returns an operational error. Conversely, valid
native rows survive an event-query failure. Older rows are not refreshed by a
failed read. `posthog_rows` counts the five event rows per day;
`posthog_native_rows` counts the additional native rows. GA4 is unchanged.

### MyMully operating handoff

This uses the existing deployed cron, route, credentials and `traffic_pulls`
table. No Computer session, finite session grant or new operator service is
required for recurrence. The existing 12:30 UTC schedule performs both PostHog
queries for the last fourteen closed UTC days. Maintain this module and its
focused test in the repository.

For native-source acceptance, run exactly the query generated by
`trafficNativeSessionsQuery(from, until, process.env)` for one closed UTC day
with the existing private configuration. Use the existing query API body
`{query:{kind:'HogQLQuery',query},name:'traffic-native-sessions-utc-v1',refresh:'force_blocking'}`.
Do not log its rendered filters. Require fresh complete response columns
`day,native_sessions,excluded_native_sessions,unknown_native_sessions`, valid
nonnegative integer counts and no more than one row for that day. Native source
SQL acceptance is separate from the synthetic tests; a provider schema error
must not be described as a zero session count.

After release, one authorized `GET /api/admin/cron/traffic-pull?days=1` covers the
most recently closed UTC day. Read back its exact job and six PostHog metric
rows. Require five event rows and one native row, valid provenance,
matching native response/query hashes and a capture inside the job interval.
Inspect unknown counts even when the HTTP request succeeds. Check the next
natural 12:30 UTC run before claiming recurrence verified for this addition.
Use the existing CRON_SECRET bearer and MyMully's ordinary deployment/monitoring
process; do not publish secrets or replay an ambiguous invocation.

Run the changed-behavior test with
`npm test -- --project api tests/api/analyticsTrafficSourcePull.test.ts`.
Rolling back the page/cart extension restores the previous four-metric caller,
three event rows plus one native row. Already retained page/cart rows keep their
version/capture time and must not be presented as newly refreshed. No v3 flag,
grant, SQL or schedule change is needed.

## Original event adapter

The SDK explicitly disables automatic `$pageview` and the current tracker emits
`page_view`. The PostHog reader now uses that event. `account_created` and
`purchase` retain their existing event names. Their metric names remain
compatible with the table. The original definitions remain deliberately limited:

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

For this v2 extension, the changed query is generated by
`trafficPosthogQuery(from, until, process.env)`. Use the existing private config
and query body `{query:{kind:'HogQLQuery',query},name:'traffic-filtered-utc-v2',refresh:'force_blocking'}`.
Expected columns, in order, are `day,visitors,accounts_created,purchases,page_views,add_to_cart_events`.
Only aggregate counts and safe proof hashes should be retained, never rendered
filter values. The native query is unchanged and does not need another schema
campaign solely for this extension. Offline tests do not claim actual new counts.

After release, invoke the authenticated endpoint once with `days=1`.
Read back `public.job_runs` for that exact run and `public.traffic_pulls` for the
closed day and `source='posthog'`. Require five event rows with matching v2 version,
scope and proof hashes; compare values with the actual fixed aggregate source
query, plus the separate native row. Job metadata should show `posthog_rows=5`
and `posthog_native_rows=1` for one successful day. Check both the endpoint result
and source-specific errors, not `status`
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
