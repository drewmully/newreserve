# Fresh Google spend preparation

This additive tool prepares a new finite Google Ads account/day manifest. It does
not submit registration, load credentials, query a source, activate a job, change
a schedule or deliver data. The existing September 21–23 jobs and the 211-row
commerce sample are not inputs and must not be replayed.

## Existing code reused

- Migration `019_spend_jobs.sql` holds immutable account/day bases.
- Migration `038_google_spend_pilot.sql` supplies owner-only atomic registration,
  disabled-by-default jobs, one attempt per day, ordered advancement, leases and
  absolute expiry. Registration is not granted to the application service role.
- `googleSpendPilot.ts` and `googleSpendSource.ts` already bound source transport,
  verify actual account metadata, reject incomplete pagination and require the
  expected response field mask before treating an empty result as zero.
- `spend.ts` validates retained amounts. USD eligibility still requires actual
  USD and `America/New_York`; this tool does not convert currencies or daily
  timezone boundaries.

This patch installs no database objects and changes no scheduler, legacy spend
cron or PostHog feed. It adds an explicit fresh mode to the existing
`POST /api/analytics/ingest/spend/advance` route. The production installation of
019/038 is unverified here. An authorized operator must inspect dependencies
before any approved registration; do not install them on the assumption that
they are missing.

## Exact operator input

Create a private JSON file with all of these fields. There is deliberately no
working account/date/credential example. Synthetic accounts occur only in tests.

| Field | Required value |
|---|---|
| `version` | `1` |
| `projectRef` | Explicit approved 20-letter target project |
| `accountId`, `loginCustomerId` | Approved 10-digit Google account and manager ID, or explicit `null` manager |
| `approvalRef`, `actorRef` | References to the scoped approval and responsible operator |
| `revisionRef` | Fresh immutable revision reference, not an old job ID |
| `credentialBindingRef` | Non-secret reference to the operator's verified account/credential binding. No token, key or service-account JSON |
| `coverage` | `whole_account_campaign_day`. No sampled-campaign or whole-marketing claim |
| `sourceCurrency`, `sourceTimezone` | Expected actual account currency and IANA timezone, checked against source metadata before retaining a base |
| `preparedAt`, `freshnessCutoffAt`, `expiresAt` | Explicit UTC instants, at most millisecond precision. Preparation ≤ cutoff < expiry; expiry is within 14 days of preparation |
| `maxPages` | Integer from 1 to 5 per day |
| `maxRequestsPerDay` | OAuth + metadata + page budget, at least `2 + maxPages`, no more than 7 |
| `deadlineSeconds` | Per-advance deadline, 1 to 90 seconds, shortened to the manifest's absolute expiry |
| `days` | Independent approved inventory of 1 to 7 `{ "date": ..., "dueAt": ... }` objects, ordered by increasing date and UTC due time |

Each due time must be on or after the freshness cutoff and before expiry. The
source-account day and New York day must both be closed, matching the existing
reader. DST follows the supplied timezone rather than a fixed UTC offset.
Unknown fields, caller-supplied run IDs, duplicate dates and invalid bounds fail.
The inventory is supplied independently of returned rows, not inferred from them.

Run the offline compiler from the repository:

```sh
node scripts/analytics/prepare-google-spend.mjs /private/path/approved-manifest.json
```

Its JSON output says `prepared`, `registered: false`, `enabled: false` and
`publication: false`. It contains the canonical manifest, SHA-256 identity,
exact `lean_spend_pilot_register` argument and total source-request ceiling.
References in this input do not prove that approval or credential binding exists.
Keep the full canonical manifest with the approval; 038 stores the policy digest
in the generated pilot/run IDs, not the additional policy fields themselves.

Identical canonical input produces identical IDs. Existing 038 registration
rejects a duplicate rather than upserting or overwriting it. After an ambiguous
registration, an operator must compare the saved pilot and all jobs read-only.
Do not blindly resubmit or change the revision reference to get around a conflict.
Any changed policy creates new IDs and requires its own explicit approval.

## Bounded connection

`advanceFreshGoogleSpend` is an additive library entrypoint. It returns `disabled`
unless the caller explicitly passes `enabled: true`. It reuses the existing pilot
runner, accepts only this manifest's next run, verifies claim scope before source
calls and verifies metadata/evidence before the immutable finish call. Expiry
stops source calls and finish. A mismatched claim, failure or lost finish response
is not retried automatically.

The existing `POST /api/analytics/ingest/spend/advance` now calls this wrapper in
explicit fresh mode. Server configuration, not request content, selects the scope:

| Setting | Required binding for fresh mode |
|---|---|
| `LEAN_ANALYTICS_SPEND_PILOT_MODE` | `fresh`. Omitted mode preserves existing legacy behavior; unknown values fail closed |
| `LEAN_ANALYTICS_SPEND_FRESH_ENABLED` | Exact `true` opt-in, in addition to the existing pilot-enabled flag |
| `LEAN_ANALYTICS_SPEND_FRESH_MANIFEST_JSON` | Compact canonical JSON from the compiler's `manifest` field, without whitespace outside strings. For example, extract with `jq -cj .manifest prepared.json` |
| `LEAN_ANALYTICS_SPEND_PILOT_ID` | Exact generated pilot ID from that prepared payload, binding the full manifest hash |
| `LEAN_ANALYTICS_PIPELINE_PROJECT_REF`, `LEAN_ANALYTICS_SUPABASE_URL` | Exact approved manifest project and its existing analytics database URL |

The route still requires `LEAN_ANALYTICS_SPEND_PILOT_ENABLED=true`, the existing
32-character-or-longer `LEAN_ANALYTICS_SPEND_PILOT_SECRET` Bearer authentication,
and an empty body with no query string. It reuses `googleSpendAuthFromEnv` and the
existing secure analytics client; there is no new credential route. No caller can
supply an account, day, manifest or pilot in the request.

Fresh mode checks the opt-in, canonical manifest, hash-bound pilot ID, project
and database target before constructing credentials or a database client.
Missing/invalid fresh configuration never falls back to legacy. Expired manifests
return `expired` without either client construction or source calls. Errors remain
sanitized, and all responses use `Cache-Control: no-store`. The existing HTTP
65-second abort limit remains in addition to the manifest deadline and expiry.

No configuration was changed or deployed by this patch. The runtime owner still
must bind the reviewed values and existing secure credential route before an
approved attended invocation. Legacy mode and the separate ordinary spend route
do not gain these additional manifest checks. No recurring integration is claimed.

The source-call ceiling applies to this finite manifest under 038's one-attempt
rules. It includes OAuth and metadata, excludes database RPCs and is not a global
budget across other pilots, old crons or operators. There is no polling loop here.
The existing transport also limits each response to 8 MiB and each advance to
32 MiB. Actual source values and the database's own leases remain authoritative.

## Evidence and reporting

`inspectFreshGoogleSpend(manifest, retainedBases, asOf)` checks retained inputs
against the exact run/account/day and metadata. It returns `missing`, `not_due`,
`incomplete`, `stale`, `complete` or `complete_zero`. Identical duplicates count
once; conflicting immutable bases, unexpected runs, future capture times and
metadata mismatches fail closed. Captures before the cutoff/due time are stale.
At manifest expiry, previously complete results become stale for fresh reporting.
Missing, incomplete and stale inputs have no usable numeric amount.

`complete_zero` requires a complete retained reader base with no rows and
`verifiedEmpty: true`, plus the exact job evidence reference. A missing day, `{}`,
partial page or manifest assertion is not zero. The function cannot authenticate
an arbitrary JSON file as genuine source evidence. Its amounts are observations,
not numerical acceptance. Every result leaves independent reconciliation,
sales compatibility, certification and delivery explicitly `unverified`.

Before accepting spend, the source owner must reconcile actual retained amounts
to independent account/day controls, including genuine zero-day evidence and
source coverage. This tool does not implement a second collector for those controls.
Before MER or ROAS, the reporting owner must accept matching sales/attribution
coverage, dates and currency. Never divide sampled sales by whole-account spend.
PostHog delivery and destination readback belong to the delivery workstream.

## Remaining operator task

Have the advertising-data owner supply and approve the real finite input above,
the independent account/day controls and a named shutdown operator. Have the
existing runtime owner verify 019/038, review this patch on the release head and
bind the full manifest to an attended invocation. Only then include registration,
exact pilot/job enablement, one bounded advance, readback and shutdown in the
consolidated release decision. No new authorization is implied by this document.

Disable the fresh opt-in and the exact pilot/jobs to stop; keep mode set to `fresh`
so missing configuration cannot select legacy behavior. Verify the existing pilot
enabled flag is off on the serving deployment when ending the attended window.
Preserve retained bases and reconcile ambiguous outcomes read-only. New provider
revisions get newly approved IDs, never overwritten bases. Keep schedules, original
sample feeds and unrelated runtime scopes unchanged. Code review,
publication/deployment and live acceptance are still separate gates.
