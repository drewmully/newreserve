# Application-owned ads ingestion

Recommendation against main `dcd796839eae56b95874e883b20cc91d42770c0f`.
This is a concrete implementation plan, not a deployed service or an activation
request. No provider, database, credential or schedule operation was performed.

## Decision

Move source acquisition into the existing application cron routes and
`public.job_runs`. Keep PostHog a downstream reader. A failed PostHog import
must not stop new Google or Meta source snapshots.

## Fix the current reader separately

The parent's Oct8 metadata-only diagnosis found a present preflight mismatch:
only `SHOPIFY_SUBSCRIPTIONS_APP_CLIENT_ID.updatedAt` changed, from
`1788106447316` to `1791498210160`; its ID remained `RC9PAKXcDDlbI2P4`.
All three approved Google capability metadata pins remained unchanged. This
explains the current whole-inventory mismatch, not the exact response that
caused an earlier held wake.

The prospective credential reader should still list the complete Production
inventory, verify the exact project/team and refuse duplicate or missing target
keys. It should compare metadata and value hashes for its three approved
capabilities, not a digest of unrelated project environment entries. Retain the
fixed origin, production target, exact environment IDs/versions, source/grant/
policy checks, four-GET-per-wake budget, RAM-only handling and child-code hashes.
Runtime scope checks remain required; dropping the whole-inventory digest must
not permit a different grant, account, source, project or child program.

This is a revised reader and authorization binding for prospective work. Do not
edit an old intent or held receipt, clear its lock, replay its capture, or pretend
the existing held run was repaired. The parent owns its separate disposition.

## Acquisition cadence

Start with **hourly source polling**, independently for each provider, and
repeated reconciliation of closed days. Thirty-minute polling can be a later
bounded setting after observing actual provider responses and job duration.
Neither interval promises that the provider has produced new data.

Intraday performance needs a separate, explicitly provisional report. Changing a
cron expression cannot safely turn the existing closed-day report into one.
Do not call a reconciled closed day permanently final; later snapshots can revise
it. Keep original source timestamps and revision history.

## What actually blocks this today

| Current code | Consequence |
| --- | --- |
| `metaSourceIngestion.ts:156-175` names one job and one generation per yesterday's NY date. `meta_source_ingestion.review.sql:23-48` makes that name unique and checks the same fixed date. | An hourly schedule alone would return duplicate-attempt failures. A failed attempt can also consume that date. Later revisions cannot be stored under a new generation. |
| `metaSourceIngestion.ts:84-88` waits for the complete two-day Pacific query window. The hourly normalizer rejects open windows and ambiguous DST days. | This is correctly bounded closed-day ingestion, not intraday performance. It cannot be advertised as such. |
| `google-ads-spend/route.ts:29-33,36-61,96-132,145-169` uses a user-agent authorization fallback, OAuth-only credentials, v17, rounded cents, a PostHog event mirror and HTTP200 for a failed `withJobRun` result. | Do not merely increase this old cron's frequency or switch its API-version string. It is not the validated source/report path. |
| `googleSpendSource.ts:20-66,69-153` already supports the v25 reader, service-account or refresh-token authentication, exact micros, account checks and bounded pagination. `googleSpendCheck.ts:150-169` captures independent controls. | Reuse these readers. Do not move service credentials or native API calls back into Computer. |
| `googleAutomaticCapture.ts:75-125` wraps those readers in automatic-cycle policy and report construction. `saved_marketing_report.review.sql:37-49` reads only accepted Google cycles and a narrow set of Meta ingestion generations. | App-owned source ingestion needs its own job-backed saved input, not a fabricated automatic-cycle claim. Source availability must be separate from destination import acceptance. |
| `googleSpendCheck.ts:150-158` requires a nonempty Google campaign set and matched delivery counts. | A genuinely empty Google cost day needs a tested empty-cost/control case. Do not invent zero clicks or impressions from absent rows. |
| `supabaseService.ts:57-140` records job starts before work and records failures, but preserves arbitrary caller error text. `/api/admin/cron-logs` reads Firestore, not these Supabase jobs. | Reuse the durable job log, add safe structured outcomes, and expose those jobs to the existing MyMully admin identity. The current cron-log screen is not ads-source health. |

These are verified code gaps. No new live access check was made, so this plan does
not claim that any credential is missing, expired, or lacks account access.

## Smallest implementation

Use two independent source workers behind the existing Google and Meta cron
routes. Each invocation processes one bounded provider/date job, then exits.
No standing full-build operation, workbook, sales controller, source export
observer or Computer task is in this path.

Keep two fixed provider settings rows, initially disabled. Their allowed cadence,
lookback and per-attempt bounds are checked before job reservation or HTTP. An
authorized MyMully admin can pause them and see their scope; activation remains
an explicit operating change. This replaces session-owned execution, not the
existing Google grant or its held cycle.

1. **Reserve work in `job_runs`.** A unique provider/account/date/UTC-slot name
   consumes that attempt before HTTP. A slot permits one attempt, not an unlimited
   retry loop. Preserve old daily names and old held-cycle records unchanged.
2. **Capture and validate.** Google reuses the v25 readers and independent cost
   controls. Meta reuses the three-GET hourly reader and the independent
   campaign/account reconciliation. Preserve existing byte, page and deadline
   bounds initially. Providers run in separate invocations so their deadlines do
   not compete inside one 120-second function.
3. **Commit one immutable revision.** Meta gets a new generation per successful
   job, not an overwrite of `meta_ingest_daily_<date>`. Google gets a small
   job-backed snapshot record containing its original base, independent controls,
   capture metadata and packet hash. Do not insert it into `google_auto_cycles`.
   Registration verifies the running job, fixed account/date, actual receipt
   correspondence and once-only commit, as the Meta wrapper already does.
4. **Read latest successful source revisions.** Extend the existing saved
   marketing reader to these explicitly enabled app-owned records. Retain its
   historical Google-cycle fallback without changing any cycle or grant.
   Do not require PostHog's observer to accept the source before it is reportable.
5. **Export independently.** Keep the current aggregate route and full-refresh
   PostHog resources for closed days. A shorter acquisition cadence does not make
   the current six-hour PostHog refresh faster. Change that setting separately,
   if desired, after checking actual supported scheduling and import duration.

Suggested first due-work policy: refresh D-1 hourly after its source window is
closed; revisit D-2 through D-7 in bounded daily correction jobs. Process one job
per invocation rather than adding an unbounded seven-day loop. This seven-day
window is a product choice, not a guarantee that all later adjustments fit it.
An admin can request an older bounded correction through the same worker.

### Exact files to change in the implementation pass

| Change | Files |
| --- | --- |
| Strict source-only Google branch, leave legacy mirrors out of the new path | `src/app/api/admin/cron/google-ads-spend/route.ts`; new `src/lib/analytics/googleSourceIngestion.ts` |
| Slot/date planning and revision IDs for the existing Meta worker | `src/lib/analytics/metaSourceIngestion.ts`; its existing cron route only for wiring |
| Two disabled provider settings, once-only slot claim, verified registration, bounded retry metadata and independent Google snapshots | One new forward SQL migration, e.g. `sql/analytics/marketing_source_jobs.review.sql`. Reuse `job_runs` and the existing Meta packet store; do not replay earlier migrations. |
| Admit the new source records without borrowing Google import authority | A new forward replacement of `lean_saved_marketing_read(text)` in that migration. Preserve bearer/source audience, finite scope, hashes, privacy and current account constraints. |
| MyMully health and bounded retry actions | New `src/app/api/admin/marketing-sources/route.ts`, using existing `requireAdmin`; small safe projection/parser beside the source workers |
| Schedule | Only the Google and Meta entries in `vercel.json`, coordinated with the parent. No traffic entry changes. |
| Proof | Focused worker, SQL idempotency and authenticated-admin tests; one fake-source application-to-registration test per provider, then an explicitly authorized production canary |

This is not a one-line cadence patch. Implementing only a generic planner or an
unmounted helper would not meet the app-owned operating requirement, so no such
runtime patch is included in this preparation.

## Provisional intraday reporting

After the source workers are independent, add an explicit `provisional` mode
rather than weakening existing closed-day guards.

- Reuse provider transport, parsing and pagination code. Keep separate validation
  of `window_start`, `window_end`, account timezone, capture time and completeness.
- Google account-local day is NY; Meta account-local day is Pacific. Preserve
  those clocks. Do not add mismatched local-day totals or prorate a daily amount.
  A combined partial NY window needs corresponding complete hourly buckets from
  both sources. Otherwise show separate provider values only.
- Put provisional rows in separate report resources. Leave the accepted
  `marketing_daily`/`marketing_totals` closed-day meaning unchanged.
- Track source capture time, reported period, latest successful revision and
  latest failed attempt independently. A fresh request does not prove fresh
  provider data. Missing, incomplete, zero and stale are different states.
- A new revision may go down as well as up. Keep its predecessor and amount delta.
  Supersede only after validation; retain the last successful snapshot on failure.
- Do not infer conversions, attribution, ROAS or customer counts from spend.
  Provider freshness and late-revision claims require the parent's official
  documentation research; no latency or cost promise is made here.

## MyMully owns diagnosis and repair

Use the current Firebase admin allowlist via `requireAdmin`. Do not expose cron,
provider, service-role or reporting bearer secrets in a browser.

The authenticated health response should report, per fixed account: configured
mode, last scheduled attempt, last successful source capture, report date/window,
last successful packet hash, consecutive failures, safe failure category,
next eligible retry, source age and downstream import status separately.
Never return raw `job_runs.error`, receipt bodies, token values or arbitrary
provider error messages.

Use stable categories such as `configuration_missing`, `authentication_denied`,
`rate_limited`, `provider_unavailable`, `timeout`, `incomplete_pages`,
`schema_changed`, `control_mismatch`, and `commit_unconfirmed`. Record the failed
stage before collapsing its public message. Meta currently collapses all capture
failures to `meta_source_refused`, which is safe but not sufficient for repair.

For 429, timeouts and temporary server failures, persist a bounded next eligible
attempt and honor provider retry metadata when supplied. Do not hot-loop. For
authentication or schema failures, stop automatic retries and show the exact
nonsecret action MyMully must take. An uncertain database commit is resolved by
reading the job/generation first, not by capturing again.

The admin repair action chooses an approved provider/date, records the admin UID
and reason, and requests the same worker within its limits. It cannot delete a
failed attempt, clear an unrelated hold, choose arbitrary URLs/accounts/SQL, or
turn on ads. This removes Computer from routine diagnosis and repair.

Credentials stay in MyMully's server-side configuration. Prefer its existing
service-account Google path and fixed account/manager binding over a new personal
refresh-token dependency. Meta's source worker already uses the application
Marketing API token. The application must validate required configuration and
account metadata without returning secret material. Credential renewal or
revocation still requires an authorized MyMully owner; it cannot be silently
repaired by retries.

Code must allow only OAuth token exchange, fixed Google read-only GAQL search and
Meta account/Insights GETs. Google code currently requests the `adwords` scope,
so that scope string alone is not proof of read-only account privileges. MyMully
must give the principal the least required account access and verify the actual
Meta token permissions. No campaign/ad/budget/audience/email mutation is needed.

## Acceptance and untouched work

Tests must prove duplicate slots do no HTTP, a failed slot does not consume the
entire future day, ambiguous commit reads before retry, revisions retain original
clocks, mismatched controls never supersede a good snapshot, and admin responses
cannot reflect secrets. Existing closed-day tests must still reject intraday
input; separate tests admit only the new provisional contract.

First prove source persistence without a PostHog read. Then prove the report reads
that saved revision while destination refresh is paused. Finally observe one
natural downstream import. Those are separate outcomes, not a multi-step
Computer-controlled capture lease.

Stage the work in this order:

1. Review the narrow credential-reader pin change and bind a fresh prospective
   invocation. This removes unrelated environment churn as a new failure cause;
   it does not resume the old hold.
2. Ship the two app-owned source workers, registration migration and admin health
   route disabled. Do not alter traffic, current Google grants or Computer task
   history. No schedule increase yet.
3. Run one authorized source-only canary per provider and verify saved packet
   correspondence and job outcome, without requiring a PostHog observer.
4. Enable the bounded hourly schedules and correction policy after those checks.
   Retire the old Computer-owned acquisition schedule through the parent's
   explicit cutover, without deleting its evidence.
5. Adjust downstream PostHog refresh independently and verify a natural import.
   Add provisional intraday resources only after their separate window/control
   contract passes. Do not describe either change as webhook-like freshness.

The existing held Google cycle, grants, accepted snapshots, current delivery
scope and all ordinary production sources remain untouched. Any cutover of the
Computer-driven schedule or extension beyond the current finite delivery expiry
is a later explicit operating change, not part of this offline plan.
