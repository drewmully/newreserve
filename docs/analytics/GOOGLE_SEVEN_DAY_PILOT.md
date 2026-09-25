# Seven-day Google source-import pilot (not activated)

This supplement automatically selects the next **already approved, explicitly
registered** account/day. It does not keep replaying one deployment run ID,
create unapproved dates, or require a daily deployment. After the fixed manifest
is exhausted or expires it stops. It stores private, immutable source bases;
it does not certify coverage, publish a five-domain report, or write PostHog.

## Small independent dependency

Apply forward `038_google_spend_pilot.sql` after existing `019_spend_jobs.sql`.
It does not require 025–037, history jobs, Shopify policy, or the seventeen
full-report evidence packets. 038 is reserved after the later stack's 037;
do not rename it to an already allocated number or rewrite 019.

019 stays byte-identical. Its claim and finish are renamed to owner-only
`lean_spend_claim_019` / `lean_spend_finish_019`. New public wrappers preserve
ordinary saved-job behavior, but additionally fence pilot members. Runtime
cannot invoke the renamed originals or register/change pilot scopes.
`runGoogleSpendJob` and the source mapper remain unchanged.

Both claim and finish lock the parent then the child and check the parent kill
switch, absolute expiry and due time. Only the earliest unfinished day may be
claimed, once. Failed or abandoned attempts block later dates for review;
lease expiry is **not** permission to retry. Completion rechecks the captured
original lease and parent expiry after its write and rolls back on expiry.
As with other PostgreSQL functions, these checks cannot police an owner who
intentionally holds an outer transaction open arbitrarily after the function
returns. Runtime uses individual RPC transactions.

## Proposed scope — approval template, NOT an installed manifest

- Project: `xeqlgxvrhgwwudyqtnun` only.
- Google account: `4335795219`; manager: `9552995078`.
- Report dates: September 24–30, 2026.
- Due times: 13:00 UTC on each following day, September 25–October 1.
- Hard stop: `2026-10-02T00:00:00Z`.
- Five campaign pages/day; one source attempt/day; no automated restatements.
- Up to seven Google/OAuth requests per attempt (one token, one account
  metadata, five pages), **49 across seven dates**, excluding database RPCs
  and scheduler HTTP invocations.
- Eight MiB per source response, 32 MiB across an attempt; 65-second shared
  aborting invocation deadline, 90-second function runtime. SQL also enforces
  its original 120-second lease and manifest expiry. No retry on partial read.

The source reader independently checks that the requested day has closed in
both New York and the actual account timezone. The date is an explicit provider
report date, not a claim of user-timezone attribution or final settled spend.
These daily imports **do not** issue the separate `FROM customer` totals-control
query used in the earlier three-day check. They are not newly reconciled or
certified daily financial reports.

### Exact operator registration

First obtain the actual recurring-read/cost approval and actor reference. Supply
a JSON object with exactly these fields; blank references must not be replaced
with invented approval:

```json
{
  "pilotId": "approved-unique-pilot-id",
  "projectRef": "xeqlgxvrhgwwudyqtnun",
  "accountId": "4335795219",
  "loginCustomerId": "9552995078",
  "maxPages": 5,
  "expiresAt": "2026-10-02T00:00:00Z",
  "approvalRef": "",
  "actorRef": "",
  "days": [
    {"runId": "approved-unique-sep24", "date": "2026-09-24", "dueAt": "2026-09-25T13:00:00Z"},
    {"runId": "approved-unique-sep25", "date": "2026-09-25", "dueAt": "2026-09-26T13:00:00Z"},
    {"runId": "approved-unique-sep26", "date": "2026-09-26", "dueAt": "2026-09-27T13:00:00Z"},
    {"runId": "approved-unique-sep27", "date": "2026-09-27", "dueAt": "2026-09-28T13:00:00Z"},
    {"runId": "approved-unique-sep28", "date": "2026-09-28", "dueAt": "2026-09-29T13:00:00Z"},
    {"runId": "approved-unique-sep29", "date": "2026-09-29", "dueAt": "2026-09-30T13:00:00Z"},
    {"runId": "approved-unique-sep30", "date": "2026-09-30", "dueAt": "2026-10-01T13:00:00Z"}
  ]
}
```

Use a bound JSON parameter as the existing schema/function owner:

```sql
select public.lean_spend_pilot_register($1::jsonb);
```

Registration atomically creates the immutable manifest, memberships and saved
jobs **all disabled**. Duplicate IDs, malformed/zone-less timestamps, unordered
dates/due times, over-seven days, more than five pages, missing approval, expiry
in the past or more than fourteen days away all fail. Retrying registration
does not replace an old manifest. Do not grant registration to runtime.

Read back exact fields and disabled states. Test disabled/auth-negative HTTP
before enabling. Only after separate activation approval, one owner transaction:

```sql
begin;
select pilot_id from lean_private.spend_pilots where pilot_id=$1 for update;
update lean_private.spend_jobs j set enabled=true
  from lean_private.spend_pilot_days d
  where d.pilot_id=$1 and j.run_id=d.run_id;
update lean_private.spend_pilots set enabled=true where pilot_id=$1;
commit;
```

The operator must assert the returned parent and job counts against the reviewed
manifest before committing. For emergency stop, set the one parent `enabled`
to false. Disabling linearizes against an in-progress SQL finish via its parent
lock; it cannot undo an already committed base. Re-enabling never resets
attempts or expiry. Do not reset attempts/leases/base after failure; review and
authorize a new explicit scope if a retry is necessary.

## Runtime installation is separate from activation

New actual Next handler: `POST /api/analytics/ingest/spend/advance`.
No body or query parameters; no caller-selected run/date/account. Set:

```text
LEAN_ANALYTICS_SPEND_PILOT_ENABLED=false
LEAN_ANALYTICS_SPEND_PILOT_ID=<exact registered pilotId>
LEAN_ANALYTICS_SPEND_PILOT_SECRET=<new dedicated secret, at least 32 characters>
LEAN_ANALYTICS_PIPELINE_PROJECT_REF=xeqlgxvrhgwwudyqtnun
LEAN_ANALYTICS_SUPABASE_URL=https://xeqlgxvrhgwwudyqtnun.supabase.co
LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY=<approved isolated key>
LEAN_GOOGLE_ADS_AUTH_MODE=service_account
LEAN_GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64=<approved dedicated value>
LEAN_GOOGLE_ADS_IMPERSONATE_EMAIL=<approved subject if used>
LEAN_GOOGLE_ADS_DEVELOPER_TOKEN=<approved dedicated value>
```

Account/manager come from the registered immutable rows, not fallback environment
values. Preserve the original eight unrelated runtime switches OFF in this new
deployment, including `LEAN_ANALYTICS_SPEND_ENABLED`; the three earlier frozen
single-day deployments are not a scheduler. The attached isolated function
package also hard-pins Preview, branch `review/analytics-initial-validation`,
the exact project/DB URL and shop; no website or cron is packaged. It uses the
actual NextRequest/NextResponse and exact compiled handlers, not handler shims.
Build: `node build.cjs`, Node 24, no dependency install/network/build-time reads.

Only after approval turn the new pilot switch on and configure **one external
scheduler** able to send an authenticated POST to the fixed isolated deployment
origin. Do not assume Vercel Preview supports the existing production cron.
Example intended cadence: seven invocations at the listed due times, no automatic
HTTP retry/catch-up, hard stop at expiry. This repository does not install a
scheduler, credential or deployment. A missed tick may process only the oldest
pending due day on the next invocation; it does not fan out or skip a failed day.

HTTP: disabled 404, invalid auth 401, missing secret 503, body/query 400.
Authenticated results: `not_due`, `busy`, `complete`, `expired`, `disabled`;
source failure/block/lost lease is 422; redacted storage/config failure 503.
No source rows, identifiers or raw errors appear in the result, only state and
completed row count. The scheduler must alert on failure/blocked/expired rather
than treating every HTTP 200 as a new import. Inspect each saved base/attempt
through an authorized operator readback; do not enable a public report.

## Before claiming automatic operation

1. Review the exact commit and run local contracts, including actual PostgreSQL.
2. Apply only the approved migration, register and read back the disabled scope.
3. Install the isolated function package and prove default-off/auth/destination.
4. Activate the exact manifest and new flag, separately authorize/install the
   scheduler, then verify a real due invocation and no-read replay.
5. Confirm seven attempts maximum, stop/alert behavior and scheduler termination.

The local tests cover synthetic transport into real PostgreSQL, simultaneous
workers on separate connections, lease/absolute expiry during writes, parent
and child kill switches/locks, rollback, immutable registration, wrong targets,
due-date ordering, replay and one-attempt failure stops. No hosted installation
or scheduler proof is implied by those tests.

The parent reports that the app-matched Shopify signing secret has now been
installed in the isolated Preview, with its switches still OFF. This local
Google work does not independently verify that binding or activate Shopify;
the broad approved pipeline/catalog policy is still missing. PostHog remains
NOLOGIN pending the platform-owned inherited `net` permissions fix. This pilot
does not solve those facts or the seventeen full-report evidence requirements.
