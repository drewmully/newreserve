# Saved marketing reporting

`GET /api/analytics/reports/marketing` reports already-ingested evidence. It never
captures a provider, enables a P6 source, runs a full build, changes Google grants,
or selects an existing workbook. Existing destinations and environment metadata
remain unchanged.

## One finite read scope, automatic saved-source selection

Install `saved_marketing_report.review.sql` in the provider-owned transaction,
omitting only its outer `begin` and `commit`. The new singleton is off by default.
The owner binds a dedicated PostHog project 353503 source ID, fresh dedicated
bearer SHA-256, approval reference, not-before, expiry no more than 14 days later,
and `lookback_days` from 1 to 7. `allow_disabled_meta=true` explicitly permits
reporting saved source-only P6 packets; it does not enable their full-build use.
`include_observed_sales=true` separately permits the current observed commerce
reader. Do not reuse any existing bearer. The raw bearer belongs only in RAM and
the new source's authentication configuration, never SQL, files, arguments or logs.

No Vercel environment changes are needed. The route retains the existing
Production/main/project checks and `LEAN_PRODUCTION_REPORTS_ENABLED` kill switch.
It rejects the known observed/workbook/Google/full/monitor capabilities. One
service-role RPC receives only the incoming bearer's SHA-256. That RPC returns
data only for the enabled, unexpired dedicated scope.
Authority and sources use one statement snapshot. Disabling the scope closes
subsequent reads; an already authorized request can finish within its 15-second
bound. The route rechecks expiry before returning. This is not an atomic
revocation or an update/delete transaction.

The RPC selects one latest accepted Google immutable capture and one latest
registered `meta_ingest_*` P6 packet per closed New York day. Selection repeats
on reads; no daily owner registration is needed. A same-day source that has not
arrived remains unavailable. A hash mismatch or malformed selected input fails
closed, never silently falls back to older rows. This reporting schedule is
independent of native acquisition schedules. Owner renewal is required at expiry.

## Resources and stable keys

The parent identified paused sample-spend source
`01a0d9ea-e2b5-0000-8057-75c5ef5e44ef` for explicitly approved repurposing because
the project is at its source limit. Do not silently reuse its old table names for
these different contracts. Leave the existing Google, observed, subscription and
sample-sales sources unchanged.
The parent owns its final manifest, bearer binding and natural-import comparison.

| Resource | Response path | Key |
| --- | --- | --- |
| Provider spend | `marketing_daily` | `report_date,provider,account_id,definition_version` |
| Selected-account total | `marketing_totals` | `report_date,report_scope` |
| Availability | `report_status` | `report_date` |

The initial manifest has these three resources only. Initial configuration keeps
`include_observed_sales=false`. Optional `observed_store_daily` and
`observed_product_daily` resources would require separate scope approval and a
manifest revision; they are not included in the initial repurpose approval.

Use complete snapshot replacement, not append-only ingestion. The rolling window
can remove dates; a changed capture for an existing date replaces its prior row.
There is no atomic refresh guarantee across resources.

All amounts and counts are decimal strings. Both accounts are fixed:
Google `4335795219`, Meta `act_2796962933960445`, shop
`mullybox-store.myshopify.com`, Supabase `xnfjdbpjuaezxjgargto`.
The historical Google normalizer uses the original manifest and original asOf.
The Meta hourly normalizer reconciles original campaign/account captures and
selects the exact NY day from the Pacific hourly source. Its historical comparison
interval is bounded by the original two capture clocks, not a new freshness claim.
No date, currency, account or timezone is relabeled.

`source_captured_at`, `control_captured_at` and `source_sha256` retain source
provenance. `source_age_seconds` increases at `evaluated_at`; neither field is
capture time. Compare source hashes, capture clocks, values and scope exactly.
Validate age against that row's evaluation clock, not a later GET's age.
Every spend row remains `historical_snapshot`, `is_stale=true`, `certified=false`.
`source_controls_match` describes the saved comparison, not current-source
freshness, full-marketing inventory, PostHog import acceptance or metric certification.
Google delivery counts can be reported when their independent original control
matches. Meta counts stay null; verified empty spend does not invent zero clicks.

Each provider can report independently. The selected-account total is null until
both same-day inputs validate. It never means all marketing accounts. MER, nCAC,
first-party ROAS, customer counts and collected cash remain null.

Optional commerce delegates to the current privacy-wrapped
`lean_production_reports_read()`. Its existing `webhook_observed_only`,
`complete_window=false`, readiness and staleness fields are preserved. Only dates
in this reporting window are returned. Missing rows are not zero-filled. In
particular, Google's historical Sep30 two-order base is never used as Oct7 sales.

## First acceptance and recurrence

The first actual saved source pair supplied by the parent is Oct7:
Google capture 19:22 UTC on Oct8 with spend USD 2.425689, and Meta capture
17:02 UTC with independently verified empty spend USD 0.000000. Compilation is
not destination acceptance. The parent must compare all emitted resources and
keys after a natural import, including empty-resource/status behavior and source
timestamps. No second Oct7 capture is required.

Daily Meta acquisition was already deployed for 11:50 UTC. Google acquisition is
owned by its separate finite automation. This read scope exposes their saved
results automatically while active, but does not make either source run or extend
its authority. Missing inputs and expired delivery scope remain real operational
limits, not reasons to rewrite capture clocks or expand a source grant.

Focused validation:
`TZ=UTC npx vitest run --project api tests/api/analyticsSavedMarketing.test.ts --maxWorkers=1`
`node --max-old-space-size=256 tests/analytics/saved-marketing-sql.cjs`
runs PGlite fixtures for the new reader, not native-provider access
or a PostgreSQL concurrency claim.
