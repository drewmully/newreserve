# Observed aggregate delivery, not a certified publication

This read-only adapter serves only existing completed 041 saved spend observations:
`store_daily` and `acquisition_daily`. It does not build reports, call Shopify or
Google, select publications, or write the five `lean_export` tables. Missing
product, cohort and funnel domains are explicitly unavailable; no rows are made up.

The first delivery scope is the three saved Google-account snapshots for
September 21–23, 2026. Spend is **observed_unverified**, stale, selected-account-only,
not proof of complete store advertising spend. Every nonspend metric stays null.
Amounts are exact decimal strings. Campaign buckets are existing opaque aggregate
keys, not customer/order/account IDs. No raw snapshot inputs, cursors, source IDs,
customer identity, contact information, or credentials leave the endpoint.

## Owner installation (separate from implementation)

1. Apply `043_observed_report_delivery.sql` to the isolated pilot only.
2. Fill `approvalRef` and `actorRef` in `observed-reports-scope.json` with the actual
   instruction and executing owner. Validate the three exact completed snapshot
   hashes. The template expiry is September 26 at 08:00 UTC; registration permits
   at most 24 hours from registration. No scope is automatically installed.
3. As owner, bind the JSON parameter:
   `select public.lean_observed_reports_register(p_scope => $1::jsonb);`
   Registration is disabled by default and exact-replay-only. It freezes a hash
   of the validated aggregate projection. Runtime cannot register or change it.
4. Verify disabled read rejection, then owner enables just this scope:
   `update lean_private.observed_report_delivery set enabled=true where scope_id='mymully-observed-spend-delivery-20260925';`
5. Install the standalone package on an unaliased isolated Preview using
   `vercel deploy --prebuilt` (parent-owned action). The package contains only
   the function and fixed routing, no website, crons, source operators or build
   dependencies. Its runtime is Node 24. The checked-in Next route delegates to
   the same tested handler but is 404 outside the exact Preview guard.

Required server environment:

| Name | Value |
|---|---|
| `VERCEL_ENV` | `preview` |
| `VERCEL_GIT_COMMIT_REF` | `review/analytics-initial-validation` |
| `LEAN_ANALYTICS_PIPELINE_PROJECT_REF` | `xeqlgxvrhgwwudyqtnun` |
| `LEAN_ANALYTICS_SUPABASE_URL` | `https://xeqlgxvrhgwwudyqtnun.supabase.co` |
| `LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY` | Existing isolated server credential, never PostHog |
| `LEAN_OBSERVED_REPORTS_ENABLED` | `true` only for approved delivery; default off |
| `LEAN_OBSERVED_REPORTS_SCOPE_ID` | Exact registered scope ID |
| `LEAN_OBSERVED_REPORTS_SECRET` | New dedicated random bearer, 32–512 characters |

No Google/Shopify credential or existing pilot flag is needed or changed.
GET `/api/analytics/reports/observed`, with
`Authorization: Bearer <dedicated report secret>`, has no query/body/selector.
One bounded, nonredirecting RPC reads the immutable allowlist. Response limit
1 MiB / 7 dates / 1,000 acquisition rows; upstream timeout 15 seconds. Responses
are `Cache-Control: no-store`. Disabled/wrong environment 404, wrong auth 401,
input selector 400, non-GET 405, DB kill/expiry/mutation/transport failure 503.
No data or exception details are returned on failure.

## PostHog Custom REST source

Parent configures **Custom**, using its `manifest_json` plus secret `auth_token`
contract. Both single-page GET streams use the same fixed URL and dedicated
Bearer secret; their Records JSONPath is `store_daily` or `acquisition_daily`.
No Postgres login or Supabase key is provided to PostHog. Do not enable a schedule
or claim live freshness from these historic observations. Preserve the readiness
and stale columns in downstream use; do not cast nulls to zero. The coverage
object identifies unavailable domains but is not itself a report row.

The new registry has RLS and no table access for PUBLIC/anon/authenticated/
service_role. Only service_role can execute the fixed read RPC. Owner-only
registration and enable/disable preserve a separate output kill switch. Reads
pin completed input/result hashes, validate the exact spend-only columns and
compare the frozen projection hash. Existing reports remain unchanged. Scope
execution expiry is not source-data deletion and not snapshot freshness.

## Smoke and stop

Check unauthenticated 401, enabled preview authenticated 200, exact three dates,
all nonspend nulls, decimal spend strings, stale/observed labels, zero provider
requests; reconcile returned rows to the three private stored reports. A changed
snapshot or report must fail closed. Verify PostHog sync and row/type/readiness
preservation before claiming successful delivery. Local tests use synthetic
reports, not live source validation.

Stop immediately by setting this registry row `enabled=false` (or the dedicated
flag false / rotating only this dedicated secret). This blocks future reads,
not data already copied by PostHog; remove downstream source/tables separately
if needed. Leave `lean_posthog_reader` NOLOGIN. No managed `net` ACL workaround,
DB credential sharing, Google/Shopify disablement, or production change is needed.
