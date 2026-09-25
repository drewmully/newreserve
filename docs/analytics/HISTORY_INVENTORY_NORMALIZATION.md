# 042: retained inventory → pending canonical facts, no provider

This forward-only supplement uses completed 040 source rows and the existing
`normalizeCommerce` normalizer. It never constructs a Shopify/PilotSource packet
or labels inventory-only operation as a source error. It does not edit 040/041
SQL definitions, enable a source, select a publication or create a schedule.

## Scope and meaning

Owner-only `lean_history_inventory_register(p_scope)` accepts the existing 041
registration fields plus required `sourceMode:"inventory_only"`. It requires
`policy:null` and `includeCustomerId:false`; registration is disabled. The
immutable 041 scope/source hash and separate immutable-mode inventory registry
bind execution. The example JSON deliberately has blank approval/actor/deadline
placeholders and cannot be registered unchanged.

The **whole completed source inventory** is traversed; the calendar fields only
scope independent spend snapshots, not inventory admission. No source credentials
are needed. The existing 041 hydration/day path cannot obtain a token for this
mode. Owner can enable/kill through `history_report_jobs.enabled`; source kill,
source completion/hash, run expiry and batch lease also fence all operations.

Pending orders retain genuine IDs, created/updated timestamps and currency.
Supported positive-quantity lines retain IDs, product IDs and quantities only;
class remains unknown. SKU, geo, customer, checkout, paid date, purchase evidence,
cost and every purchase/financial amount remain null. No ledger, payment,
customer, identity, session or attribution facts are inferred.
`commerce_source:"other"` is only a neutral internal pending placeholder here,
not source/channel authority or a storefront/subscription-renewal classification.
The mandatory pending status and acquisition-false boundary remain unchanged.

Edited-order lines, zero quantities and >500-line orders are explicit withheld
item outcomes. Oversized/edited orders still get a pending header, but no partial
first-500 canonical line subset. Source lines remain complete in 040.
Per-order source/canonical/withheld counts and reasons are stored privately;
even an empty canonical item set never creates zero purchase aggregates.

`history_inventory_runs.complete=true` means all retained order IDs received
pending headers, **not** that all source lines became qualifying purchases or
that financial normalization finished. The original 041 job stays in its orders
phase, so existing snapshots do not overstate financial normalization completion.
This does not finish the 10 core tables / 5 reports / **18 mandatory + 3 optional**
workbook metrics.

## Batches and replay

Two service-role RPCs: `lean_history_inventory_claim` and
`lean_history_inventory_finish`. A batch contains ≤100 orders, ≤1,000 projected
line rows and ≤8 MiB input/output. Source line counts may exceed projected rows
for explicitly withheld oversized/edited orders; that is not truncation presented
as complete canonical inventory.

The database pins the exact IDs/input hash under source/run locks. Finish checks
the same source, exact output ID set and counts, pending-only/null fields and
source-derived quantities/product keys; writes and cursor advance are atomic.
Lease is 90 seconds, capped by run expiry and rechecked after writes. Interrupted
unfinished batches resume the same IDs/hash; identical completed finish replays
do not duplicate facts. There is no per-order RPC and no provider call.

At 100 orders/batch, 61,821 orders require 619 batches / **1,238 write-work RPCs**
plus a completion check; line/byte caps can increase that count. This is an
estimate, not a live run. No reporting calendar is automatically materialized.
Existing private spend snapshots remain separately available and observed/stale,
with all non-spend metrics withheld.

## Operator

Package offline:
`node scripts/analytics/package-history-report.mjs /absolute/new/directory inventory`

Default config: disabled, mode inventory, one batch, **maxProviderRequests:0**.
Owner registration is `select public.lean_history_inventory_register($1::jsonb)`
via an authorized operator, not runtime. After separate authorization/enablement,
set the reviewed run in `operator-config.json`, then run `node operator.cjs`.

The environment is the existing exact isolated Preview branch, project/shop and
dedicated analytics DB URL/service key documented for 041. Inventory mode
constructs a DB-only environment, **does not read/copy the Shopify token**, and
its transport permits only the two new RPC URLs. No new flags, tokens or secrets.
Max 100 batches/action; no new batch after eight minutes, nine-minute hard abort,
20-second request timeout, 256 MiB aggregate request+response bytes. Each action
is finite and resumes from DB progress. Static output has aggregate counts/status
only. No runtime endpoint or automatic redeployment.

## Verification and rollback

Read private job/source hash, batch counts, source/canonical line differences and
all pending/null invariants; verify replay and source kill before larger runs.
Kill `history_report_jobs.enabled=false` to stop further batches. Do not modify
040 data or the Google/Shopify active pilots. Existing candidate facts remain
private; there is no public selection or certification to revoke.

Focused evidence uses disposable loopback PostgreSQL and retained **synthetic**
040-shaped fixture rows, not live-source validation. Production/history rollout
still requires parent/operator authorization and exact scope registration.
