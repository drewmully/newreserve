# Fresh evidence intake and bounded refresh

This addition makes the existing bounded pipeline operable with new approved
snapshots. It does not establish the customer's missing authoritative feeds or
turn on production processing. Nothing in migration 025 registers a customer
run, enables a job, installs a schedule, releases a report or contacts a vendor.

## Implemented path

1. Source adapters or authorized exporters produce the 17 evidence sections consumed by
   `FullBuildEvidence`. The intake binds each packet to a project, shop, date
   window, source ID, record reference, approved schema, capture timestamp and
   SHA-256 payload digest. Empty sections must be explicit, never silently
   defaulted. Reconciliation/coverage sections require an independently declared
   control-source binding.
2. `prepareRefresh` validates evidence freshness through the whole execution
   window, source-window/account/page budgets, non-overlapping history windows
   and policy scope. Changed inputs produce new immutable run IDs; identical
   reviewed input produces identical IDs.
3. The offline command writes a dependency bundle and a bounded, nonmaterialized
   PostHog diagnostic view definition. It does not register or activate them.
4. An operator registers that exact bundle with `lean_refresh_register`.
   Registration atomically creates history, spend, base, full and queue rows,
   all disabled. Repeating the same bundle is safe; conflicting input is rejected.
5. Separately approved activation allows one saved step per authenticated
   `/api/analytics/ingest/refresh` invocation. Per-run and daily project step
   counters, leases, evidence expiry and switches bound this queue.
6. Completion creates a private candidate only. Independent reconciliation,
   operator release, operator export and read-only PostHog synchronization are
   separate gates, unchanged from L21.

## Offline preparation

Use Node 20 and the lockfile dependencies. The reviewed input JSON must match
`RefreshInput` in `src/lib/analytics/refreshPlan.ts`; the synthetic fixture in
`tests/fixtures/analyticsRefresh.ts` demonstrates the structure, not acceptable
customer evidence.

```sh
node scripts/analytics/prepare-refresh.mjs approved-input.json private-new-output
```

Outputs are `refresh-bundle.json` and `analytics-events-view.json`. They may
contain private evidence; keep them out of source control and customer-facing
logs. Files are owner-readable only on creation. Use a new private directory;
existing output files are not overwritten. Preparation compiles trusted local
modules and validates data without database or vendor access.

A SHA-256 digest detects a changed payload. It does not prove who supplied it,
establish consent, or make a control independent. Source approval, authentic
extraction and control independence remain operator responsibilities.

## Registration and activation

Only after separate deployment approval, apply migration 025 after 018–024
and earlier dependencies in L21. Runtime credentials cannot execute
`lean_refresh_register`, change queue/limit tables, approve or export reports.

The operator uses a parameterized SQL client and the exact reviewed JSON:

```sql
select public.lean_refresh_register($1::jsonb);
```

Verify returned run ID, saved bundle and every disabled dependency. Never
interpolate evidence JSON into SQL. If the response is lost, read back the exact
run and bundle before deciding whether to repeat registration.

Approved activation is one operator transaction for the exact run ID:

- Set/update the approved `refresh_limits` row for this project with an explicit
  daily step allowance and approval/actor reference. Do not reset its current
  day's usage counter as a convenience.
- Enable only history and spend IDs listed in that queue's saved bundle,
  its base run, its full run, and that queue row. Do not enable all saved jobs.
- Confirm the evidence deadline is still in the future and within all approved
  binding freshness limits.
- Commit only if every expected dependency was found and the project/shop
  matches the approved target.

The default-off endpoint uses the full-route server source credentials described
in L21, plus `LEAN_ANALYTICS_REFRESH_ENABLED=true` and a distinct, at least
32-character `LEAN_ANALYTICS_REFRESH_SECRET`. It takes an empty POST body and
accepts no source/run/window arguments. It selects only pre-approved queue work.

Optional explicit dispatch:

```sh
node scripts/analytics/dispatch-refresh.mjs
```

Requires `LEAN_ANALYTICS_REFRESH_DISPATCH_ENABLED=true`,
`LEAN_ANALYTICS_RUNNER_ORIGIN` (HTTPS origin), the refresh secret and optionally
`LEAN_ANALYTICS_REFRESH_MAX_CALLS` (default 5, maximum 128). The dispatcher only
continues on a successful `partial` checkpoint. It stops at completion, any
other state, HTTP failure or ambiguous response. Installing a recurring schedule
still requires separate authorization.

## Limits, recovery and monitoring

- One run covers at most 31 report dates, five history windows, 25 history pages,
  100 order slots and 100 advertising account-days. These are safety bounds,
  not a claim that full production volume is supported.
- A queue step is not an API request or a dollar. It may contain several bounded
  vendor requests. Queue counters do not cap costs from other routes, manual
  queries, PostHog sync, hosting or legacy integrations.
- Queue freshness expires within 24 hours; each source binding can require a
  shorter window. Refreshed full candidates cannot commit after expiry, a
  disabled project/queue or loss of their queue lease.
- A worker crash/lost response retains its lease. After expiry, the next claim
  marks the queue `blocked/ambiguous` without replaying a source call. Operator
  reconciliation must inspect saved dependencies and completion first.
- Read `refresh_queue.status`, `last_state`, `last_step_at`, `expires_at`,
  `used_steps`, and project `refresh_limits` counters to monitor progress.
  They contain no raw event payloads; the bundle itself is sensitive.
- On failure, disable dispatch/endpoint and the exact queue/project as needed.
  Do not delete customer source data or reset counters/leases to force a retry.
  Register a freshly approved revision if evidence has expired.
- A blocked or exhausted oldest run can hold later work. Resolve it explicitly;
  do not bypass it by inflating budgets.

## Event diagnostic view

`behaviorDiagnosticView` generates fixed-scope HogQL over native events, grouped
by action identity. It exposes transport counts and conflicting timestamp,
session, identity and permission versions without outputting raw customer or
session identifiers. The collection helper now emits strict
`analytics_permitted=true`; non-boolean truthy consent is rejected, and denied
events do not retain a session key.

This is a diagnostic definition, not the entire certified logical event table.
It has not been installed or compiled against the customer's live PostHog
project. Validate the generated query and all aliases, reconcile rejected/
duplicate actions, then separately approve any installation or materialization.
[PostHog saved-view guidance](https://posthog.com/docs/data-warehouse/views)
requires named selected fields and describes optional materialization.

## Still required for full live implementation

The intake is a verified-export protocol. L23 adds an executable adapter for
existing Supabase customer rows, Shopify order/customer links, explicit permission
timelines, additional PostHog identifiers and optionally approved Shopify
success-time cash. These remaining integrations cannot be substituted with fixture evidence:

- Authoritative identity links, historical analytics permission, current
  permission and deletion/removal feeds. Marketing/SMS consent and Firebase
  authentication are not analytics consent.
- Complete approved customer/order history and migration coverage.
- Journey producers with actual consent checks and signed checkout/session/
  campaign handoff. Existing application collection is not automatically rewired
  by adding an analytics helper.
- Actual settlement feeds, original-purchase snapshots for deferred commerce
  cases, offer/bundle membership and independently extracted control totals.
- Automated fresh extraction for each revision, production-volume partitioning,
  backfill, late updates and a reviewed publication/removal propagation policy.
- Real deployment credentials, isolated hosted validation, read-only warehouse
  source setup, saved-view installation and synchronization/deletion checks.

The local tests prove machinery and safeguards on synthetic inputs. They do
not prove these customer contracts, source truth, hosted permissions or cost.
