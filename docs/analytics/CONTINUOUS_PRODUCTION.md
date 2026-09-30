# Continuous production reporting increment

Review-only code on main `449a747278fab9185928684aa8e41fdca0cbc7b5`. No production activation, source calls, migrations, permissions, source creation, merges or deployments were performed while implementing this increment.

## Existing path, not a new processing framework

The existing five-minute GitHub workflow gains an explicit `LEAN_ANALYTICS_SCHEDULE_MODE=continuous` mode. Both existing opt-in variables remain required. Omitted mode preserves the tested bounded-window behavior; continuous mode rejects leftover trial start/stop dates rather than silently extending a trial.

Each continuous invocation checks authenticated counts-only health first. An empty healthy queue returns `idle` without a processing POST. Pending work or an expired lease permits at most one POST and one subsequent health GET: three HTTP requests maximum, with the existing 180-second invocation budget and main-only concurrency boundary. Network/authentication/malformed health failures stop before processing. Known backlog, dead-letter and expiry warnings remain visible but do not prevent unrelated pending work from progressing. The existing SQL retains ownership of lease recovery, retained-source reuse and the five-attempt ceiling; this code does not reset jobs or erase evidence.

An unhealthy result makes the workflow fail visibly. This is not a new alert destination or proof that a person receives notifications. Persistent dead letters require an operator to inspect the existing private status/audit and use the existing separately authorized retry path if warranted. The HTTP processing route now passes request cancellation to the ordinary non-pilot reader, as it already did for the pilot.

## Aggregate publication

Additive SQL050 requires the existing 047 observed views. It creates one private default-disabled delivery gate and one fixed, parameter-free, service-role EXECUTE RPC. It grants no table/report-view access and no login. Known Supabase default grants on these new objects are closed; unknown explicit grantees abort installation atomically. Old schema objects are not rewritten.

The RPC aggregates only the latest successful production order heads. The historical 211-row selected-order sample is not part of that set. Store AOV is recomputed from summed purchase merchandise net divided by summed eligible orders, not by adding individual AOVs. The ratio truncates toward zero at six decimal places, matching `reporting.ts`. If any contributing value is missing, the aggregate remains null. Cash, customers, spend, CAC and MER stay null/withheld. Product rows reuse the existing 047 product aggregate.

`GET /api/analytics/reports/production` is restricted to the production/main deployment, an independent bearer secret and the exact analytics database binding. It accepts no query/body/scope/SQL arguments. The response uses exact-key validation, decimal strings, explicit observed/unverified coverage and stale flags. It rejects more than 366 daily definition rows, 10,000 product rows or 4 MiB rather than silently truncating. It exposes no order, transaction, customer, source or publication identifiers. SKU buckets and business financial aggregates remain commercially sensitive, not anonymous data.

The manifest in `production-posthog-manifest.json` uses two single-page resources, `store_daily` and `product_daily`, with composite daily/definition/SKU keys. It intentionally omits an incremental cursor: a full refresh must capture refunds, revisions, nulls and stale-state changes to previous dates. Proposed destination is existing PostHog project 353503, new prefix `mymully_production_observed`, separate from both disabled sample sources. Proposed publication cadence is 15 minutes, independently gated from the five-minute processing cadence.

## Execution contract requiring approval

1. Review and normally merge the exact private code after CI, preserving all existing Preview guards. Verify normal application deployment. Flags remain off while installing/configuring.
2. Install SQL050 once, after its approved prerequisite inventory is verified. Keep its gate disabled initially. If 048/049 are included in the same release, install their strict reviewed packages before 050 and before live intake; do not reinstall 003/004/017/047 or replay the completed sample.
3. Supersede the exact disabled, expired trial scope with a separately approved standing source policy using the existing owner-only scope revision mechanism. This change records the prior row in the existing operator audit. Exact scope dates, product classification, topics, private retention and approval reference must be in the final activation SQL; expired-trial authorization is not reusable.
4. Bind the existing dedicated worker bearer to the GitHub Actions secret without logging it. Set continuous mode, clear trial date variables, and enable both scheduling opt-ins only after server configuration and source policy are ready. No database/provider credential belongs in GitHub Actions.
5. Enable only the approved Shopify notifications and dedicated receipt/worker flags. Existing operational notifications and unrelated schedules remain untouched. Shop-wide delivery and any financial hydration before catalog/date exclusion must be explicitly covered.
6. Create an independent production report bearer securely, enable the SQL050 gate and production report flag, validate the real endpoint and then create the separately named PostHog Custom source with the reviewed manifest and secret provided outside the manifest. Inspect actual schema status and exact supported sync settings before enabling two full-refresh resources at the approved cadence. Never insert fake business rows to populate an empty schema; report an empty source or a provider requirement honestly.
7. Verify implementation deployment, scheduled health/idle behavior, publication status and first real processed transaction as three different milestones. Absence of a new order does not make code unfinished, and fixture success does not prove provider delivery.

## Stop and rollback

Disable both scheduler opt-ins, disable the standing database scope, remove only newly approved notifications and deploy the dedicated receipt/worker flags false. Disable the report gate and route flag and set only the new PostHog schemas to `should_sync=false`. Reconcile any in-flight lease without replaying it; preserve reports/evidence and the original sample. Do not drop installed tables/functions or delete already imported warehouse rows as a routine rollback. Such deletion requires its own authority.

## Focused evidence

The new tests cover continuous opt-ins, trial-date rejection, idle/no-source behavior, bounded recovery, malformed/auth-failed health, cancellation and deadlines. Disposable PGlite tests exercise the new RPC's actual service-role permissions, unknown-default-grantee rollback, latest-revision aggregation, ratio-of-sums AOV, null preservation, stale state, output allowlists and response limits. One integrated fixture traverses signed receipt admission, existing scheduled dispatch, fixture Shopify hydration, 047 atomic finish, 050 aggregation and HTTP serialization. No fixture transaction is written to a hosted database or PostHog.

## Explicitly outside this increment

Final bounded review added two safeguards: one admission-time abort signal covers
the preflight and processing requests together, and the read-only aggregate RPC
is `STABLE` so store and product reads share the invoking statement's snapshot.
Focused tests exercise a slow preflight followed by an in-flight deadline abort
and assert the installed RPC's actual stability property.

It does not infer a complete catalog or whole-store coverage, certify historical periods, activate size capture, acquire Loop credentials, implement advertising account/day scheduling, establish customer identity/permission history, or certify subscription/session/attribution metrics. Those workstreams must state their own implemented code, missing data and activation requirements without blocking the supported sales/product path.
