# Private standing Google succession

This addition is default off. It does not install a schedule, register source jobs, obtain independent controls, create a destination, send alerts or establish production acceptance.

## What it changes

An owner-created policy admits a bounded inventory of distinct, already approved full runs. Each call to the existing authenticated `POST /api/analytics/ingest/full` claims one run and advances one existing `runFullPipeline` step. A completed run can replace the dedicated Google selection only after SQL rechecks the native account/day capture, complete independent cost and count controls, campaign keysets, unchanged formulas and saved result.

The policy-selected reader replaces per-run delivery environment bindings. The URL, separate bearer, one-row `google_account_daily` resource, 16 KiB response cap and 15-second read deadline stay unchanged. The optional Google output does not replace the five-family workbook.

The policy supplies account, manager, explicit closed-day range, finite authorization window, generation and step budgets, interval and freshness bounds. There are no operational defaults. Selection validity never exceeds one hour and can be shorter because of source, manifest or policy expiry. Policy ID and revision stay fixed across admitted generations.

Only one policy can be enabled. Every run is admitted once, source capture time and report `asOf` must advance, report dates cannot move backward, and claims serialize on the policy. A duplicate, stale result, failed step or ambiguous transport does not reset a completed run. A lost lease remains held for owner reconciliation. No retry or lease takeover is added.

Disabling a policy permanently revokes it and disables its current selection if the selection revision still matches. It does not restore a predecessor. A successor policy needs a distinct ID and fresh owner approval.

## Limits that remain

This is bounded succession over genuine owner-admitted runs, not an unattended producer of future evidence. Each new generation still needs the existing native source manifest, actual independent cost/count controls, retained commerce dependency, owner-only workbook registration, explicit dependency activation and owner-only enqueue. The runtime cannot invent fresh controls or register arbitrary future runs. If no new run is admitted, it returns `idle`; the current selection eventually expires.

The existing source-capture step is unchanged. With a saved native base it proceeds to reporting. Without one it uses the existing guarded Google capture path and its saved request/page/credential bindings. The native capture and independent controls must fall within the declared due time and `asOf`. A capture after `asOf` cannot be relabeled as earlier evidence.

Initial standing admission conservatively requires a nonempty complete account/day capture. A verified empty account day is not auto-selected by this addition. Existing fixed-run behavior remains available when standing mode is unset.

No Google or Meta connection is assumed to work. No customer, payment, consent, identity, sales, P1 or five-family calculation is changed. Missing customer or behavior evidence does not suppress a valid Google account aggregate. Existing P3 privacy/removal gates still apply.

## Required future settings

All values below remain unset. They are future approval bindings, not a request to activate now.

| Binding | Required explicit value |
|---|---|
| Owner policy | New policy ID/revision, approval reference and actor reference |
| Fixed target | `xnfjdbpjuaezxjgargto`, `mullybox-store.myshopify.com`, PostHog `353503` |
| Native scope | Google account and manager IDs, inclusive closed-day range |
| Authority | Finite `not_before` and `expires_at` |
| Budgets | `max_generations`, `max_steps_per_run`, `min_interval_seconds`; source manifests retain their own request/page budgets |
| Timing | `step_timeout_seconds` from 1 through 80, `selection_seconds` from 1 through 3600, `max_source_age_seconds` from 1 through 86400, `max_import_age_seconds` from 1 through 3600 |
| Current selector | Fresh singleton revision, or zero only after confirming absence |
| Destination | Exact approved dedicated source and table UUIDs for `google_account_daily`; existing three-resource observed delivery is not authorization for a new resource |
| New app mode | `LEAN_GOOGLE_STANDING_ENABLED`, `LEAN_GOOGLE_STANDING_POLICY_ID`, `LEAN_GOOGLE_STANDING_POLICY_REVISION` |
| Existing app gates | Production/main, full-enabled flag and separate full secret, existing fixed project/database/shop and native credential bindings |
| Delivery | Existing dedicated Google delivery flag/secret and account ID; leave `LEAN_GOOGLE_DELIVERY_RUN_ID`, `LEAN_GOOGLE_DELIVERY_RESULT_HASH`, `LEAN_GOOGLE_DELIVERY_DATE` and `LEAN_ANALYTICS_FULL_RUN_ID` unset in standing mode |
| Scheduling | Approved dispatcher, cadence, authority window and call budget. None is installed or inferred from `min_interval_seconds` |
| Monitoring | Existing monitor-enabled flag, separate monitor secret, dispatcher flag and approved origin; Google policy must remain bound |
| Alerts | Approved destination/webhook, approval reference and delivery test. Albert Tres Vilanova is interim owner, not an inferred recipient address or channel |

An 80-second maximum step leaves room below the unchanged 90-second route limit. The wrapper has an 85-second outer bound, uses abortable database requests and cancels native requests. Cancellation cannot undo a provider or database commit; ambiguous work remains held.

## Owner-only registration and checks

`sql/analytics/google_standing_operation.review.sql` is a raw review migration, not a fresh-catalog installer or activation wrapper. It creates three empty RLS tables and nine functions. It requires the existing P3 selector and runtime roles to be owned/configured as checked at entry. Production installation still needs the normal current-body, owner, ACL and dependency checks. No policy row is seeded.

1. Verify installed P3 dependencies and install the reviewed addition under an approved owner transaction. Confirm the three new tables are empty and runtime has no table privileges.
2. Insert an explicit disabled policy with `selection_revision` bound to the fresh existing selector, `generations=0` and all `last_*` values null. Confirm its whole row before enabling.
3. Use existing `prepareGoogleWorkbookRegistration` and owner-only `lean_google_workbook_register(jsonb)` for each genuine new packet. Existing registration remains disabled by default. Activate only the exact approved dependencies after readback.
4. Owner calls `lean_google_standing_enqueue(policy_id, revision, run_id, reconciliation_ref)`. This refuses completed or already attempted full runs, duplicate runs, backward `asOf`, other accounts/managers/dates and excessive inventory. The reference must identify the actual independent controls, not this code.
5. After the separately approved policy enable and application bindings, use the existing full endpoint. Its response is operation state, not metric acceptance. Inspect `google_standing_runs`, the policy pointer and original selection. Read `lean_google_standing_read(project_ref, policy_id, revision, account_id)` with an independently authorized read.
6. After an actual natural dedicated import, collect complete unfiltered table values, independently observed job metadata and exhaustion proof. Owner calls `lean_google_standing_accept_import(policy_id, revision, evidence)`. The exact evidence keys are listed below. The function compares rows to the current saved generation and checks the approved source/table. A later generation invalidates earlier acceptance.
7. Read `lean_google_standing_health(project_ref, policy_id, revision)` and the existing health endpoint. Production acceptance still requires actual provider/destination observations and approved recurrence evidence.

Import evidence keys are `runId`, `selectionRevision`, `projectId`, `sourceId`, `tableId`, `resource`, `jobId`, `status`, `startedAt`, `completedAt`, `checkedAt`, `evidenceRef`, `complete`, `wholeTable`, `unfiltered`, `independentlyExtracted`, `nextCursor`, `rows`. Resource must be `google_account_daily`, status `completed`, all four proof booleans true and `nextCursor` null. `rows` is the exact aggregate array from the independently read whole table, not a copied canonical response. This owner attestation records only its aggregate hash and job/evidence metadata.

The original owner-only selector and import-admission functions remain unavailable to runtime roles. Only `lean_google_standing_next`, `lean_google_standing_finish`, `lean_google_standing_read` and `lean_google_standing_health` receive `service_role` execute. No anonymous or authenticated grants are added.

## Stop and alert route

Use an owner transaction to lock the exact policy and compare its fresh whole-row hash and revision before `enabled=false`. Read back `enabled=false`, `revoked=true`, and the matching current selector disabled. This stops new standing claims and reads; a request already in progress may finish its native request or save its full result, but cannot pass standing finish after revocation. Do not re-enable the row, delete audit evidence or revive an old selection. An approved source/import stop remains separate.

The existing testable monitor path is `scripts/analytics/monitor-refresh.mjs` to `GET /api/analytics/ingest/health`. New issue codes cover missing/disabled/expired policy, held succession, unavailable/expired Google selection, and missing/stale dedicated import proof. The existing script already accepts these codes. It posts at most once per invocation only when `LEAN_ANALYTICS_ALERT_ENABLED=true`, an approval reference and webhook are present. Repeated invocations can repeat alerts. There is no separate test-alert endpoint and no notification has been sent.

`googleImportAcceptanceVerified` reflects fresh owner-admitted independent evidence for the current generation. `posthogReadbackVerified` remains false because the health request itself does not query PostHog. This cannot promote the other workbook families to healthy.
