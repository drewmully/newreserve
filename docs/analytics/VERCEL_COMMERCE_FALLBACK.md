# Default-off Vercel commerce supervisor

This optional GET route reuses `runScheduledPipeline` without changing the
existing process route, dispatcher, SQL, subscriptions or report delivery.
This combined release adds both analytics schedule entries to `vercel.json`.
An approved deployment registers those triggers; processing remains default-off
behind the independent dedicated flags. Publication, deployment and configuration
cutover require the separate timer approval.

## Admission and bounded behavior

`/api/analytics/ingest/scheduled` requires production `VERCEL_ENV`, a separate
`LEAN_ANALYTICS_VERCEL_SCHEDULE_ENABLED=true`, existing usable `CRON_SECRET`
(at least16 characters), and a matching bearer header. Caller queries and
bodies are rejected. User-agent and scheduling headers confer no authority.
Keep `CRON_SECRET` unchanged; it is shared with other existing routes.

Explicit server settings must include:

- `LEAN_ANALYTICS_PIPELINE_ENABLED=true`
- `LEAN_ANALYTICS_DISPATCH_ENABLED=true`
- `LEAN_ANALYTICS_SCHEDULE_MODE=continuous`, with no trial start/stop settings
- Existing exact project/Supabase target and processing bearer
- Canonical origin `https://www.mymully.com` (the fallback when unset);
  a different supplied origin is rejected by the existing supervisor

The fallback flag maps to the supervisor's schedule-admission flag, not the
GitHub repository variable. GitHub and Vercel settings are separate surfaces.
This mapping does not bypass the dispatcher or database's independent gates.

The real existing supervisor performs health GET, at most one saved-receipt
POST when work exists, then final health GET, under one180-second deadline.
Idle makes only one GET; no new order selection, source policy or replay is
accepted from the caller. HTTP errors and ambiguous processing are not retried.
The handler permits240 seconds for completion/response and sends no-store
aggregate results only. `complete` is invocation completion, not report success.
Admitted invocations log `analytics_vercel_scheduled_invocation` with that same
aggregate state/counts; caught exceptions log only a static unavailable state.
On failure, any returned health is the last successfully parsed observation and
may predate the failed POST; it is not proof that the attempt committed or failed.

The existing `/api/analytics/ingest/process` GET remains read-only health.
Do not schedule that route expecting it to process orders.

## Concurrency and capacity limitations

A process-local guard rejects overlapping requests to the same isolate.
It is **not distributed deduplication**. Database work leases retain ownership
fencing across instances; separate concurrent invocations can claim different
items. No new lock table or timer framework is introduced.

At a nominal five-minute interval there are twelve intended invocations per
hour, at most one advancement per invocation. This is not a global cap,
guaranteed throughput, strict delivery-time promise or sufficient capacity
for every arrival rate. A growing legitimate backlog needs a separately
reviewed capacity decision, not an unbounded loop.

## Separately approved activation only

Before activation, verify the exact reviewed deployment, usable existing
bearers without exporting them, actual host duration, and the same approved
sales scope. The intended existing Vercel project is `newreserve` in
`greensclub`; no new project or provider should be created.

The combined release includes this entry, which may be deployed only under
the separate timer approval:

```json
{"path":"/api/analytics/ingest/scheduled","schedule":"2-59/5 * * * *"}
```

This entry and the separate subscription entry are present in `vercel.json`.
Deploying the bundle registers both triggers even if their processing flags are off.
Vercel schedules use GET and send `CRON_SECRET` as bearer authentication.
Pro/Enterprise permit minute-level scheduling; Hobby does not support this
cadence. See [trigger behavior](https://vercel.com/docs/cron-jobs),
[schedule limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), and
[authentication/no automatic retries](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

For a controlled cutover, disable only the GitHub commerce schedule variable
and reconcile in-flight commerce work before enabling the Vercel fallback.
Do not disable the shared workflow, subscriptions, receipts, database scope,
financial delivery or unrelated Vercel schedules. The code cannot inspect
GitHub variables, so that cross-provider step is an operator prerequisite.

Verify real natural invocations and counts-only queue health. Stop the
dedicated fallback opt-in on target/auth drift, unresolved work leases,
ambiguous state, unexpected source scope or worsening backlog. Do not
immediately replay a failed POST. Re-enable the previous trigger only through
the approved cutover/recovery decision; never leave both active unintentionally.
Vercel environment edits apply only to new deployments. Disabling a flag in
project settings is not an immediate stop of an already-live route; complete
the approved off deployment or targeted trigger removal and reconcile any
in-flight call. Do not disable unrelated schedules.
See [environment changes](https://vercel.com/docs/environment-variables/managing-environment-variables).

## Duration and verification boundary

Current Vercel Fluid Pro documentation gives300 seconds default and800 seconds
maximum for Node functions. This route's explicit240 seconds fits those limits;
its internal180-second bound is unchanged. Confirm effective deployment metadata
after an approved build rather than treating local configuration as proof.
See [duration limits](https://vercel.com/docs/functions/limitations).

Focused tests exercise the actual supervisor with synthetic HTTP responses:
default-off/preview/auth/target rejection, idle no-POST, one saved-receipt
attempt, ambiguity/no retry, cancellation/deadline and same-isolate overlap.
They do not prove production scheduling, cross-instance concurrency, source
results, or hosted timeout behavior.
