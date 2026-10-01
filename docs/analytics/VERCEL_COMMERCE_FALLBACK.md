# Default-off Vercel commerce supervisor

This optional GET route reuses `runScheduledPipeline` without changing the
existing process route, dispatcher, subscriptions or report delivery.
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
The commerce supervisor makes only one GET when idle. The separate financial
checkpoint below may then run if the owner has enabled its database binding.
No order selection, source policy or replay is accepted from the caller.
HTTP errors and ambiguous processing are not retried.
The handler permits240 seconds for completion/response and sends no-store
aggregate results only. `complete` is invocation completion, not report success.
Admitted invocations log `analytics_vercel_scheduled_invocation` with that same
aggregate state/counts; caught exceptions log only a static unavailable state.
On failure, any returned health is the last successfully parsed observation and
may predate the failed POST; it is not proof that the attempt committed or failed.

The existing `/api/analytics/ingest/process` GET remains read-only health.
Do not schedule that route expecting it to process orders.

## Optional finite financial checkpoint

SQL054 creates an empty owner-only checkpoint registry. Installation alone
does not register or enable a job. After separate approval, an owner may bind
one new SQL018 history job to an independently captured order inventory.
The fixed target is the existing production shop and database. Scope is one
closed New York creation day within the past60 days, one page, at most five
orders, and an expiry no more than24 hours after registration.

Only an authenticated timer invocation whose commerce result is `idle` can
attempt the checkpoint. At least70 seconds must remain in the same180-second
invocation budget. The financial reader has a65-second deadline and at most
`2 + 8 * inventory_size` native Shopify requests. It uses the existing runtime
token with explicit `financial_no_geo`; no new environment variable, public
diagnostic endpoint or caller-supplied scope is introduced.

The native metadata page must exactly match the saved IDs and revisions before
financial hydration. The existing readers verify real API-version headers and
revision stability. The fixed financial allowlist excludes customer, cart,
address and order-size fields before retention. SQL rechecks the binding,
expiry, lease, inventory and projection at the atomic history-page commit.
These authority checks require READ COMMITTED.
The public history-commit wrapper also requires READ COMMITTED for unbound
jobs. REPEATABLE READ and SERIALIZABLE callers must not use that writer.

Claim consumes the single attempt. Errors and ambiguous responses are held
for operator reconciliation, not automatically retried or reclaimed after
expiry. A lost response after a successful commit is recognized from the
durable completed state. The old public history-commit RPC rejects every
checkpoint-bound job, including disabled and expired bindings. Unbound jobs
retain the reviewed history implementation behind the wrapper; runtime and
destination roles cannot call its private delegate.

The response adds only `financialCheckpoint.state` and a source-request count
when available. It does not return source rows, IDs, policies or credentials.
A missing migration or unavailable checkpoint leaves the original commerce
result unchanged. The checkpoint does not replay queue work, change the
standing sales window, build or release a report, or enable a destination
import. A completed source read still needs financial mapping, independent
reconciliation and the separate report/destination acceptance steps.

Pause or recover only the new checkpoint binding. Do not reset its attempt,
force the old history writer, widen the standing pipeline or disable unrelated
commerce work. This version supports the financial checkpoint alone; any
additional scheduled source domain needs separately reviewed exclusion guards.

## Concurrency and capacity limitations

A process-local guard rejects overlapping requests to the same isolate.
It is **not distributed deduplication**. Database work leases retain ownership
fencing across instances; separate concurrent invocations can claim different
commerce items. The finite financial checkpoint has its separate single-attempt
SQL054 binding. No new timer framework is introduced.

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
