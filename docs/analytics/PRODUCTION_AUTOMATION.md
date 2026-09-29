# Bounded production sales automation

This addition wires the existing finite Shopify dispatcher to a default-off
GitHub Actions supervisor. It does not create a source feed, install database
objects, register a policy, enable a runtime route, publish reports or configure
credentials. Production activation and any merge/deployment remain separately
approved actions.

## Existing processing path

The existing receipt endpoint accepts signed Shopify deliveries. The existing
worker hydrates each parent order, retains source evidence, computes supported
financial facts and advances the latest successful observed order snapshot.
The supervisor advances at most one saved receipt per invocation, followed by
one counts-only health read. It does not independently generate fresh source
events or run the full-domain evidence-based refresh.

The observed view is not certified whole-store reporting. An idle queue does
not establish source completeness, and an invocation returning `complete` does
not prove that a new report was calculated or delivered.

## New code and configuration

- `scripts/analytics/scheduled-pipeline.mjs` reuses `dispatchConfig` and
  `runDispatch`. It adds an absolute UTC start/stop window of no more than seven
  days and pins the intended production origin and database reference.
- `.github/workflows/analytics-production-dispatch.yml` provides a manual trigger
  and a proposed five-minute schedule, both restricted to `drewmully/newreserve`
  on `main`. It uses read-only repository permissions, no database credential,
  no dependency installation, and a non-cancelling concurrency group.
- Both `LEAN_ANALYTICS_SCHEDULE_ENABLED` and the existing
  `LEAN_ANALYTICS_DISPATCH_ENABLED` repository variables must be exactly `true`.
  Otherwise the workflow job is skipped. The script also checks both gates.
- `LEAN_ANALYTICS_SCHEDULE_START_AT` and `LEAN_ANALYTICS_SCHEDULE_STOP_AT` are
  required explicit UTC instants, for example ISO strings ending in `Z`, not
  implied local dates. No actual activation dates are supplied by this change.
- The repository secret `LEAN_ANALYTICS_PIPELINE_SECRET` must match the
  separately configured production processing endpoint. Do not copy a preview
  secret or the existing application administrator credentials.
- The workflow pins the origin to `https://www.mymully.com`, project reference
  to `xnfjdbpjuaezxjgargto`, and database URL to the matching Supabase host.
  These are target constraints, not proof of the remote application's
  configuration; verify the deployed target separately before activation.

Each invocation allows only one processing POST and one health GET, with no
request body, query scope or redirects. The overall deadline is at most 180
seconds, shortened to the remaining approved window. Setup time counts against
that deadline. Late or ambiguous responses are not retried in the invocation.
An already accepted server-side operation cannot be undone merely by cancelling
the client request.

The proposed cadence is up to 288 invocations per day, 576 processing/health HTTP
calls per day, and one receipt per invocation. These are upper bounds for a
complete day, not promises of throughput or exactly-on-time scheduling. Shopify
requests made inside each bounded processing call are additional requests.
Existing worker leases and retry limits continue to govern the queue; this
wrapper does not replace them.

Merging this workflow installs its trigger definitions even while the job is
disabled. Therefore do not merge it without explicit schedule-definition and
normal application deployment approval. No trigger has been installed by local
file creation or testing.

## Operational prerequisites

1. Install and verify only the necessary receipt/worker/pipeline runtime
   migrations on the existing production foundation. Do not replay the
   already-loaded selected-order sample. Apply 003, 004 and 017 atomically with
   reviewed pre/post invariants; individual commits between them expose
   intermediate function privileges under Supabase defaults.
2. Resolve the exact Shopify app, signing secret, authorized read credential,
   catalog policy, order-creation window and collection-field scope. Existing
   receipt retention includes the webhook payload, which is broader than the
   previous selected-order financial-only sample.
   The separate runtime projection change supports an explicitly saved
   `PipelinePolicy.sourceProjection: "financial_no_geo"` for order hydration.
   Omission retains the legacy query. The choice comes from each immutable
   claimed snapshot policy, not a request or mutable process environment;
   broader retained sources cannot silently resume under the narrower policy.
   This option does not remove identifiers from the stored webhook payload.
3. Approve and configure production runtime settings and a disabled scoped
   policy row. Verify the actual target, server credential boundaries and
   expected rejection of unauthenticated requests before enabling it.
4. Complete one genuinely sourced supported delivery through the processing
   endpoint. Reconcile that case and confirm stale/failure behavior. Do not
   fabricate a purchase or delivery to claim a real-source test.
5. Approve the exact bounded execution dates, five-minute cadence, repository
   secret placement, expected log audience and failure-response owner before
   setting the two activation variables.
6. Configure production aggregate delivery separately. The existing isolated
   sample-only export routes must not have their guards removed to shortcut it.

GitHub workflow logs contain only the sanitized invocation state, call count
and queue health counters. They contain no source body, secret or order ID.
Do not add a raw fetch response or provider error to these logs.

## Stop and recovery

Out-of-window invocations make zero requests. Malformed configuration fails
before network access. Missing credentials, HTTP failures, invalid health,
disabled scope, stale backlog, expired leases or dead work produce non-success
results rather than a second processing attempt.

This workflow does not grant itself repository-write privileges to disable
future runs. A failed invocation is visible as a failed Actions run; it does not
guarantee an alert is delivered or permanently pause later invocations. Before
activation, name the monitor/operator who will disable
`LEAN_ANALYTICS_SCHEDULE_ENABLED` on a failure requiring investigation and
review the queue before resuming. Do not reset retry counters or leases to hide
an unresolved failure.

The worker's own stored retry behavior is unchanged. Do not label this wrapper
as an end-to-end exactly-once delivery guarantee or a full refresh service.
Existing unrelated application and pilot schedules are outside this change.

## Focused local validation

The new `analyticsLeanScheduledPipeline.test.ts` file has 25 passing cases:
default-off behavior; before/at/after stop boundaries; invalid dates, duration,
target and credentials; one-receipt call budget; setup-time and in-flight
expiry; cancellation; unhealthy and ambiguous responses; sanitized results;
and workflow guards. Vendor responses are injected synthetic responses, not
customer evidence.

Analytics TypeScript, changed-file ESLint, workflow YAML parsing and whitespace
checks passed. A separate credential-free CLI invocation returned
`{"event":"analytics_scheduled_invocation","state":"disabled","calls":0}`.
No hosted request, source read, database write, secret update, schedule change,
commit, push or deployment was made by those tests.
