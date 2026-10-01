# Selected workbook reports on the production route

Review-only integration. It uses existing `buildFullReports`, persisted
`report_*` tables and owner-only scoped selection. It does not approve sources,
register jobs, select a publication, install SQL or enable a destination.
The five report families cover the workbook's 18 core metrics. Optional ad
diagnostics and monetary subscriptions are not added.

## Preserve the narrow feed

Omitted `LEAN_PRODUCTION_REPORTS_MODE` remains `observed`. SQL050, its original
two-resource manifest and its offline destination checker are unchanged.

The new `workbook` mode requires both `LEAN_PRODUCTION_WORKBOOK_REPORTS_ENABLED=true`
and an independent `LEAN_PRODUCTION_WORKBOOK_REPORTS_SECRET`, distinct from the
narrow report bearer. Existing production/main, shared report-enable, path,
method, query/body and exact database-binding checks still apply. The same fixed
route calls `lean_production_workbook_reports_read` with its server-bound project.
There is no caller-selected SQL, run, scope or date and no fallback to old data.

Switching modes changes the private response contract and bearer. It requires
separate source/destination/audience approval and an attended consumer transition.
Do not change the current two-table destination or its secret merely because
this code deploys. The added manifest is not an instruction to create a source;
source creation may probe the endpoint.

## Persisted output and independent domains

SQL053 adds one default-disabled private delivery binding for an exact completed,
enabled full build, project and shop. It reads only domains selected through the
existing certifications/selected-publications rules for that bound publication.
The gate does not certify a candidate. No raw source facts are exposed.

All five metric arrays are present. A sixth operational resource, `report_status`,
has exactly five rows, one per metric family, and identifies selected versus
unselected domains. Unselected metric arrays are empty and unavailable, not
measured zero, independently accepted empty tables or another publication's data.
Scoped release can select a domain with some ready metrics and others withheld.
Sessions do not need accepted commerce metrics; repeat purchase does not need
accepted revenue LTV. Nothing in this reader changes those calculation gates.

Rows preserve the existing reporting-contract fields, including report-scope
`shop_id`/`publication_id`, definition, model/funnel versions, cohort cutoff,
readiness and stale flags. SQL serializes decimals and integers as strings
before JavaScript parses them. Nulls remain null; no ratios are recalculated.
The validator rejects extra/missing fields, mixed versions, duplicates, wrong
dates/cutoffs, coerced numbers and unavailable fields labeled ready.

Each status row's `as_of_at` is the saved publication cutoff. `report_from_date` and
`report_through_date` are the reporting interval, not universal source-data
completeness. Per-metric readiness retains that distinction. Cohort cutoff,
acquisition model and funnel version must match the saved policy. The selected
views preserve row stale OR selection stale. Status rows carry the same
publication/versions, per-resource stale flag and count. Unselected counts are
null, not zero. Metric readiness summarizes as `ready`, `withheld` or `mixed`;
selected empty tables use `no_rows`, while unselected domains use `unavailable`.
This is operational metadata, not another metric/fact family or SQL table.
Pending/newer privacy removals or
selection invalidation prevent reading the old publication.

The new manifest imports `report_status` as its own resource; it does not discard
the availability/cutoff metadata through a metric-array selector. Destination
queries must match resource and publication against this status table and honor
its availability/staleness. A status-only refresh cannot prove the metric tables
have refreshed. Keep the status resource's actual job evidence too.

One database response is statement-consistent. The PostHog resources may refresh
separately. Neither the shared publication ID nor this reader certifies atomic
warehouse refresh, real metric acceptance or ongoing recurrence. Every status
row explicitly keeps `atomic_resource_refresh: false`. Retain each
resource's actual job/readback evidence. The original offline checker remains
the narrow two-resource verifier, not a verifier for this expanded contract.

## Fresh spend through the existing full job

Optional immutable `full_builds.policy.freshGoogleSpend` contains exactly
`manifest`, `controls` and `marketingInventory`. SQL derives `bases` from the
base report's registered spend runs, never from caller JSON. Existing
`lean_full_inputs` returns the enriched `freshGoogleSpend` envelope and hashes
it with the rest of the input. No optional key is emitted for legacy jobs.

The same `lean_full_finish` rechecks that hash and enabled pilot/run bindings
under source locks. Expiry during finish rolls back insertion. The existing
`lean_full_next` exposes the saved v2 manifest for a fresh-google spend stage;
missing policy blocks instead of falling back to the ordinary collector.
The D adapter and A job hooks are companion changes required to consume this
envelope. They preserve independent controls and compatible-sales scope; this
reader never derives MER from the webhook-only sales feed.

## Installation and acceptance boundaries

The checked production database does not contain the generic history/spend/full
job prerequisites. Deployment alone cannot install them. Use the separately
reviewed absent-only guarded dependency installer after exact approval.
Never replay existing 001/013/014/045/050 or overwrite the installed operational
scope. SQL053 itself enables no source, build, selection, scheduler or reader.
Existing owner-only release and service-role boundaries remain in force.

Focused synthetic tests exercise actual full-job persistence, SQL readback,
canonical HTTP serialization, independent domain availability, privacy/stale
behavior, default-feed preservation and fresh-spend input fencing. They are not
production evidence. Authentic source controls, approved registration, successful
processing, selected output and per-resource destination/repeat-refresh checks
remain required.
