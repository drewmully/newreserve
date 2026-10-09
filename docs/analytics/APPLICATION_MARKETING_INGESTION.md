# Application-owned Google and Meta refresh

Implemented against `31e1707c241f3119ddf5c0befec7efcaf342db2a`. This change is
default-disabled and unscheduled. It does not activate a provider, change a
credential, repair an old Google hold, or change a PostHog source.

## What runs

Two independent application workers collect validated closed-day source data.
They write `public.job_runs` and immutable revisions in
`lean_private.marketing_source_jobs`. Meta also writes the existing disabled P6
packet store. PostHog reads saved sources independently of acquisition.

The fixed scopes are Google account `4335795219`, manager `9552995078`, and Meta
account `2796962933960445`. The project is `xnfjdbpjuaezxjgargto`, shop
`mullybox-store.myshopify.com`. Routes cannot accept other accounts, URLs,
credentials, SQL, grant IDs, or source rows.

| Mounted route | Authentication | Work |
| --- | --- | --- |
| `GET /api/admin/cron/marketing-source/google?lane=primary` | Exact existing `CRON_SECRET` bearer | One due Google D-1 hourly slot |
| `GET /api/admin/cron/marketing-source/meta?lane=primary` | Same strict cron authentication | One due Meta D-1 hourly slot after its Pacific query closes |
| Same provider paths with `?lane=correction` | Same | One due date among D-7 through D-2, each at most once successfully per NY day |
| `GET /api/admin/marketing-sources` | Existing Firebase `requireAdmin`, revoked-token check and admin allowlist | Safe source health, no provider call |
| `POST /api/admin/marketing-sources` | Same admin authentication | Bounded retry or pause for one provider |

All workers require Production/main. The server requires the fixed Supabase URL
and existing service-role key. Both provider settings rows start with
`enabled=false` and `report_enabled=false`. Neither HTTP route can enable them.
`source_expires_at` starts null. An owner must bind a finite source expiry before
enabling acquisition. Claims require at least 90 seconds remaining; commits check
both the job deadline and source expiry before and after final writes. The
overnight cutover uses the exclusive boundary `2026-10-21T23:15:00Z`.

Old `google-ads-spend`, `meta-ads-spend?source_only=1`, traffic and other cron
entries stay unchanged. The automatic Google grant, cycle, observer, holds and
Computer credential reader are not used or modified.

## Due work and limits

Primary and correction are separate lanes. An hourly primary invocation cannot
also complete six correction dates. A later schedule should invoke primary
hourly and correction at least six times per day for each provider. Separate
hourly correction invocations are a simple option. Failed correction jobs can
consume additional invocations; the schedule is not a completion guarantee.

The database consumes one provider/date/slot attempt before HTTP. It serializes
claims per provider but does not make Google wait for Meta. Each slot allows
at most two attempts, including admin retries. The current invocation captures
only one date. No unbounded catch-up loop runs inside a function.

| Bound | Google | Meta |
| --- | --- | --- |
| Native access | v25 fixed service-account reader | v25 fixed Graph reader |
| Requests per capture | Seven POSTs: two token exchanges, two metadata reads, two independent campaign reads, one customer control | Three GETs: metadata, account hours, campaign hours |
| Duration | 60 seconds | 55 seconds |
| Per-response timeout | 15 seconds | 15 seconds |
| Aggregate native body limit | 8 MiB | 8 MiB, with 1,000,000 bytes per response |
| Pagination | One complete campaign page, up to 10,000 rows per pass | Complete EOF, up to 48 account hours and 1,000 campaign hours |
| Job deadline | 90 seconds, including registration | Same |
| SQL RPC transport | 10 seconds and 8 MiB per response | Same |

Exceeding a bound refuses the snapshot. It does not silently paginate, truncate,
retry HTTP, switch credentials or fall back to legacy ingestion.

The correction range is D-2 through D-7. Admin retry also stays within the last
seven closed NY days. This is a bounded product choice, not a promise that
providers stop revising data after seven days. Older corrections need a separate
implementation/operating decision.

The NY day must be closed. Meta also waits for both queried Pacific dates to
close. Existing ambiguous DST-window rejection stays in place. No intraday
report is produced. A recent API response does not guarantee newly updated
provider metrics.

## Registration and revisions

Google uses the existing native reader and independent controls. A new
empty-cost adapter accepts complete, genuinely empty campaign/customer
responses, but leaves clicks and impressions null. The old automatic-cycle
control export still rejects empty campaign evidence as before.

The SQL registrar checks its own running job, account/date, capture clocks,
native request URLs, queries, response counts, byte bounds and correspondence
between native projections and the submitted packet. Meta reuses the released
daily validator's receipt-to-packet checks with the new job's date and identity.
The old daily registrar is unchanged.

Successful Google records use the explicit `app_google_v1` kind. Their evidence
names the real `marketing_source_jobs` row, not a fabricated automatic cycle or
spend registration. A local validation copy adapts the derived manifest ID to
the existing Google report validators; it is never stored as a spend-job claim.
Successful Meta records use `app_meta_v1` and generation
`meta_ingest_app_<job_id>`. P6 rows remain disabled.

Completed application records are immutable, including their receipts and
hashes. A later successful revision may increase or decrease spend. A failed
revision cannot replace the last good one. This migration does not delete
historical data or introduce a retention purge. Operators must monitor storage;
the seven-day work/read range is not a seven-day retention policy.

OAuth response bodies and assertions are never retained. Receipts contain safe
native projections, original clocks, body hashes and byte counts, not a claim
that the full raw HTTP body was archived.

## Commit ambiguity and retry

There is no provider retry within an invocation. Transient errors record a
provider-wide retry time of at least 15 minutes. A numeric or HTTP-date
`Retry-After` up to one day extends that time on throttling and transient 5xx
responses, and applies to admin retries too.
A larger deferral sets `rate_limit_manual`; the admin retry endpoint cannot
clear it. The operator must investigate before an owner changes that setting.
Oversized numeric deferrals also hold rather than overflowing to a shorter retry.
An error body is read only within the existing deadline and aggregate byte
budget, with a 16 KiB parsing ceiling. Only exact Meta error codes 4/17 and
documented Google quota enums/canonical status classify non-429 throttling.
Unknown messages are not searched or retained. A quota/overload classification
does not prove exhaustion of a daily quota or explain a historical failure.

Missing credentials, authentication failures, schema changes, incomplete pages
and control mismatches stop scheduled attempts for that provider. Admin retry
records a UID and a short reason after the operator fixes the cause. It still
obeys enabled state, date limits, rate limits, active leases and slot budgets.

If commit transport fails, the worker reads the same job once and compares the
exact packet and digest. A matching committed row means success. Otherwise it
holds that consumed source attempt, returns HTTP503 and never recaptures in the
same invocation. A later scheduled claim also holds an expired running attempt.

For an expired packet-absent application attempt, explicit admin retry locks the
provider, verifies that the packet still does not exist, records
`admin_confirmed_no_commit` on the original row, and only then considers another
bounded attempt. It neither deletes the row nor reuses its token. This action
has no authority over an automatic Google hold or journal.

Pause prevents later claims and commits once the provider lock is acquired.
It does not erase saved reports or claim to cancel a network request already in
flight. Function and lease deadlines bound that in-flight work.

## Saved reporting

The forward wrapper around `lean_saved_marketing_read(text)` first delegates
the existing bearer and finite consumer scope. No new bearer or Vercel
environment variable is added. The prior function remains owner-only.

With `report_enabled=true` for a provider, the wrapper compares the latest
successful application capture with the legacy source and uses the newer
original capture clock. With application reporting off or no successful app
revision, the legacy behavior remains. All stored hashes are checked. A
malformed selected source fails closed rather than silently becoming zero.

The existing marketing resources, null ratios and historical snapshot meanings
stay unchanged. This change does not expand the current consumer's lookback,
expiry, audience or disabled-P6 opt-in. A one-day reader still serves one day
even though correction jobs retain older revised snapshots. Consumer expiry
still closes reporting. The independently bound source expiry stops source jobs;
the overnight cutover binds both to the same exclusive Oct21 boundary. Pausing or
expiring acquisition does not delete retained historical data.

The current PostHog refresh schedule is unchanged. Source success is not import
acceptance. Admin health always reports `downstreamImport: "not_observed"`.
Actual downstream freshness requires the destination's jobs and whole-table
readback. No alert, email or delivery observer is added.

## MyMully diagnosis and repair

Use a current Firebase admin ID token with the mounted admin route. Never put
provider, service-role, cron or reporting tokens in a browser.

Health returns enabled/report-enabled state, latest attempt state and safe error
code, blocked category, retry time, source expiry, last successful report date/hash, original
source/control clocks, and downstream status. It does not return receipt bodies,
lease tokens, raw `job_runs.error`, or provider error strings.

Example request bodies, sent through the existing authenticated admin session:

```json
{"action":"pause","provider":"meta","reason":"investigating account access"}
```

```json
{"action":"retry","provider":"google","date":"2026-10-07","reason":"credential rotation verified"}
```

Use an actually eligible date; the example is not a standing instruction to
recapture Oct7. Reasons allow 3 to 120 ASCII letters, digits, spaces, underscores,
dots and hyphens. Do not include secrets or customer data.

| Safe category | Operator action |
| --- | --- |
| `configuration_missing` | Check the application-owned environment keys below. No fallback is attempted. |
| `authentication_denied` | Check provider account membership and credential validity; rotate using normal secret management, then request one bounded retry. |
| `rate_limited` | Wait until `retryAfter`. Retry cannot bypass it. |
| `rate_limit_manual` | Investigate the longer provider deferral before an owner changes the blocked setting. |
| `provider_unavailable`, `timeout` | Wait for the retry time. Last good source remains reportable. |
| `schema_changed`, `incomplete_pages`, `control_mismatch` | Inspect code/provider changes privately. Do not raise bounds or suppress controls just to make the job pass. |
| `unsupported_window` | Preserve the DST/closed-window refusal; this implementation does not make up a converted daily amount. |
| `commit_unconfirmed` | Inspect the same job readback first. Use admin retry only for an expired packet-absent application attempt. |

Google uses existing generic `GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64`,
`GOOGLE_ADS_IMPERSONATE_EMAIL` and `GOOGLE_ADS_DEVELOPER_TOKEN`. Meta uses
`META_MARKETING_API_TOKEN` and the fixed `META_AD_ACCOUNT_ID`. Supabase uses
`SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`, plus `SUPABASE_SERVICE_ROLE_KEY`.
No new key is introduced. Provider permissions should permit the listed read
operations only; this code contains no campaign/ad/audience mutation endpoint.
Credential validity and effective provider access were not tested by this local
implementation.

Rotating a credential that a separate active Computer authorization pins can
invalidate that authorization. Coordinate its prospective replacement rather
than modifying an old authorization, receipt or held lock. The separately
prepared capability-pinned Computer reader is not installed by this change.

## Later cutover

These are operating steps, not actions performed by the patch:

1. Install this one forward migration in the normal provider-owned transaction,
   omitting only its outer `BEGIN`/`COMMIT` if the migration tool owns the
   transaction. Verify both settings rows off, new table/helper ACLs, exact
   function bodies, and the unchanged legacy reader behavior.
2. Release the mounted code while it remains off and unscheduled.
3. Confirm existing application credentials and fixed accounts through the
   approved secret-management path. Authorize the provider settings and actual
   first closed-day source canary separately.
4. Enable one provider's source setting, run its new primary path once, and
   verify its `job_runs`, immutable packet, receipts/digest and disabled P6 row
   where applicable. Repeat independently for the other provider.
5. Enable application source admission with `report_enabled` only within the
   existing or explicitly renewed finite marketing consumer scope. Read the
   fixed report route, then verify a natural downstream import separately.
6. Add the explicit primary and correction schedule paths above. Disable old
   overlapping acquisition schedules only as part of that approved cutover.
   Do not edit the unrelated traffic schedule or old Google cycle history.

No hourly schedule, source activation, database migration, production canary or
destination reconfiguration is part of the local implementation's proof.

## Focused checks

`analyticsLeanMarketingSource.test.ts` exercises both fake-native captures,
registration calls, no-HTTP skips, failures, rate-limit metadata, ambiguous
commit readback, auth/secrecy and genuine empty Google semantics.
`analyticsLeanMarketingSourceRoutes.test.ts` checks the mounted route guards.
A dedicated CI step runs `tests/analytics/marketing-source-jobs-sql.cjs`
separately from Vitest to bound memory. It applies the actual new
migration to PGlite, uses the released P6 registrar and legacy reporting reader,
and drives the new worker through real claim/commit/read functions.

The SQL fixture demonstrates ACL/default-off behavior, independent storage,
immutable/idempotent commits, finite consumer scope, real report normalization,
nonstarving correction selection, expired ambiguity, retry limits and last-good
preservation. It does not prove native PostgreSQL concurrency, provider account
access, installed credentials, deployment or destination imports.
