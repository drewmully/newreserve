# Independent default-off subscription supervisor

This separate GET `/api/analytics/subscriptions/scheduled` wraps the unchanged
`runScheduledSubscriptions` helper. It is not part of commerce dispatch and
does not register plans, grant Loop source permits or change049 budgets.
The combined release includes both analytics schedule entries in `vercel.json`.
An approved deployment registers both triggers; processing remains default-off
behind independent dedicated flags. Publication, deployment and configuration
cutover require the separate timer approval.

Admission requires Production, the separate
`LEAN_SUBSCRIPTIONS_VERCEL_SCHEDULE_ENABLED=true`, existing authenticated
`CRON_SECRET`, `LEAN_ANALYTICS_SUBSCRIPTIONS_ENABLED=true` and
`LEAN_SUBSCRIPTIONS_DISPATCH_ENABLED=true`. Query/body arguments are rejected.
It maps only its dedicated flag into the helper's schedule admission flag.
Commerce flags do not admit a subscription invocation.

Keep the exact approved `LEAN_SUBSCRIPTIONS_SCHEDULE_START_AT` and `_STOP_AT`
bindings, using the helper's millisecond-UTC format and maximum seven-day
window. Missing, malformed or overlong windows fail closed. Before start or
with less than one second remaining, zero calls occur. Do not silently renew
an expired window or substitute a new plan.

The existing project/origin and subscription processing bearer are verified
by the unchanged helper. One fixed empty-body POST is allowed per invocation;
there are no retries or caller-selected plan/account/cursor values. The existing
runtime and049 still own target, lease, per-page source permits, scan budgets
and halt/completion. The wrapper has no Loop credential or direct DB client.

The helper's request limit is the lesser of90 seconds and remaining approved
time. The new route has120-second host allowance. Response parsing retains
the existing1024-byte limit and state-only allowlist. Logs/responses contain
only the bounded helper state and call count. `observation_saved` is not
whole-scan completion or complete/reportable coverage.

This route has its own same-isolate overlap guard; it is not distributed
deduplication. Existing049 leases/budgets remain authoritative. Neither
same-isolate protection nor staggered phases guarantee cross-instance exclusion.

## Two independently approved timer cutovers

The following entries are present in the combined release's `vercel.json`.
The separate timer approval must cover their deployment and controlled cutover:

| Path | Bundled schedule | GitHub job-specific schedule variable to turn off first | Dedicated Vercel opt-in |
|---|---|---|---|
| `/api/analytics/ingest/scheduled` | `2-59/5 * * * *` | `LEAN_ANALYTICS_SCHEDULE_ENABLED` | `LEAN_ANALYTICS_VERCEL_SCHEDULE_ENABLED` |
| `/api/analytics/subscriptions/scheduled` | `4-59/5 * * * *` | `LEAN_SUBSCRIPTIONS_SCHEDULE_ENABLED` | `LEAN_SUBSCRIPTIONS_VERCEL_SCHEDULE_ENABLED` |

Approve/activate only the timer whose existing trigger failed its observation
window. Reconcile that job's in-flight work before switching. Do not disable
the shared GitHub workflow, turn off the other job or alter dispatch/source
permits to force the cutover. Each timer remains independently default-off.

Keep other provider settings and the shared `CRON_SECRET` unchanged. Stop only
the affected fallback flag on wrong target, ambiguous POST, lost/expired lease,
budget/permit error, unexpected source scope or failed natural-run readback.
Expiry means stop, not extension. Investigate before any replay or switching
back; do not let both provider triggers unintentionally remain active.
Environment changes require a new deployment to take effect. A saved false
flag alone is not a verified shutdown; complete the approved off deployment
or targeted trigger removal and reconcile in-flight work without changing049.
See [environment changes](https://vercel.com/docs/environment-variables/managing-environment-variables).
