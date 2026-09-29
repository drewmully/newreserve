# Observed sales and product runtime: bounded activation

This extends the existing Shopify receipt-to-observed-sales worker. It does not
create another independent data pipeline, certify whole-store coverage, or
activate customer, subscription, session, attribution, spend or cash metrics.
Code changes are local review material until a separately approved merge and
deployment. SQL 047 and optional 046 are not installed by deploying code.

## Existing boundary and explicit opt-ins

The existing `lean_pipeline_finish` signature and SQL 017 are unchanged.
Omitting `retainedReports` continues through the old mapper and finish RPC.
The immutable claimed policy may opt into `retainedReports: "product-v1"`;
the worker then composes existing store and product calculations from the same
retained order and sends them in one `lean_pipeline_finish_extended` call.
Database errors propagate without marking an ambiguously committed job failed.
The extended transaction must commit facts, reports, head advancement and work
completion together, or roll them all back.

The additive `lean_analytics.observed_product_daily` view is owner-only.
It uses only latest successful per-order heads, aggregates by shop/date/SKU,
propagates unknown metric values and reports queue/policy/coverage staleness.
It does not expose publication, work, order, customer or source identifiers.
No existing reader gains access and no external destination is configured.
Optional size dimensions stay private; no size aggregate is invented.

Optional size requires all of:

- `sourceProjection: "financial_no_geo_order_size"`.
- Existing explicit `orderSize.policyRef` and per-product `productSemantics`.
- The extended product sink and installed SQL 046 size writer.

Without size, 046 is not needed. The proposed default is **size off** until the
approved product-to-size meaning and source-field scope are available. A failed
optional sidecar write is not best effort: it must abort the entire finish.
All outputs stay stale and `observed_unverified`; rejected or missing observations
are not zeros. Store money formulas and the existing six-decimal arithmetic are
unchanged. Product results follow actual purchase/refund dates without gap fill.

## Minimized storage, not anonymous data

For the proposed sales activation, explicitly configure both:

- Receipt environment: `LEAN_ANALYTICS_RECEIPT_RETENTION=financial_allowlist_v1`.
- Immutable policy: `sourceRetention: "financial_allowlist_v1"` together with
  `sourceProjection: "financial_no_geo"` (or the separately approved size variant).

Receipt HMAC verification still runs over the original exact raw bytes before
parsing or storage. The original body hash, delivery ID, business key, topic and
required order/refund IDs and timestamps remain private; email, addresses,
customer objects, item payloads and arbitrary webhook properties are omitted.
Invalid selected scalar shapes, unsafe IDs and invalid timestamps fail closed.
This opt-in is rejected in combination with the historical bounded-pilot route
instead of changing that route's contract.

The source response retains only fixed commerce/financial/refund fields needed
by the current calculations, recursively including money and pagination shapes.
Unexpected object-valued scalar fields are rejected. Sanitization occurs before
the worker calls its durable retain RPC; this does not promise that unexpected
provider fields never reach application memory. The size query still transiently
requests all line custom attributes and variant titles, but only normalized
size enums/statuses survive retention. Shopify source IDs, SKU and financial
transaction lineage remain private; this is not anonymization.

Legacy opt-ins omitted means legacy retention is unchanged. Already retained
broader snapshots are **rejected**, not rewritten, when a minimized policy is
used. No existing receipts or snapshots are scrubbed or replayed automatically.
Both receipt and source settings are required: enabling only one does not
minimize the other.

## Smallest executable validation

The production base 003/004/017 is installed inactive. Do not reinstall it and
do not reuse the earlier 26-order sample approval. Before a real run:

1. Approve and deploy the reviewed code while all processing switches remain off.
2. Approve the reviewed 047 migration and its one new finish-RPC service grant.
   Approve 046 only if size is included. Verify actual target, object inventory,
   unchanged old function/view definitions and sample hashes, and empty new data.
   Confirm receipt/work/snapshot/head tables remain empty before initial
   activation; if earlier receipts exist, stop for review rather than deleting,
   replaying or claiming their retained payloads were retroactively minimized.
3. Pin the actual Shopify shop/app, exact approved merchandise product IDs,
   order-creation window, signed-delivery topic and financial policy references.
   Verify dedicated signing/read credentials without exporting their values.
   Approve transient payload access and the exact minimized retained fields above.
   Do not assume all shop receipts are within the worker's catalog/date scope.
   The existing ingress is shop/topic scoped, not a product/date receipt filter:
   matching signed deliveries can retain private lineage before the worker reads
   the order and rejects an out-of-catalog or out-of-window source. The activation
   approval must explicitly cover that bounded receipt/hydration access, or use
   a verified narrower upstream delivery scope. Report eligibility is not a
   substitute for permission to read the source. Do not claim catalog-limited
   collection merely because reports are catalog-limited.
4. Register that frozen policy and target, enable the dedicated receipt/worker
   settings, and process **one genuine qualifying Shopify delivery**, not a
   fabricated purchase, forged webhook or replay of the frozen sample.
5. Verify one receipt/work outcome and one retained revision; reconcile store
   and product money against that one source, verify no unexpected retained
   fields, and verify only the intended head advances. If size is enabled,
   inspect the private sidecar's exact normalized value/status and provenance.
6. Keep aggregate inspection inside the existing owner context for this first
   cycle. Do not add a PostHog feed, external reader grant, public endpoint or
   certified-publication selection merely to display the sample.

Expected successful synthetic test values are not live acceptance values.
The live expectation must come from the actual bounded approved source. A
healthy empty queue does not establish completeness; missing data stays unknown.

## Proposed first recurring window

After the one-cycle check, the recommended provisional trial is **60 minutes**
with the already-built five-minute dispatcher, at most 12 scheduled invocations.
Use an exact approved UTC start/stop, one processing request and one health read
per invocation, the production target and the dedicated worker secret. Keep
legacy/pilot schedules unchanged. The scheduler does not disable its own future
runs after a failure; a named operator must monitor and turn the two opt-ins off.
Missed deliveries, provider retries and duplicate delivery IDs must remain visible.

Stop on any failed reconciliation, unintended source fields, wrong target or
catalog, expired lease, dead work, stale backlog, missing schema, unexpected
authentication/authorization response, or ambiguous finish response. Preserve
the last good observed output, stop scheduling, and reconcile read-only before
any repair. Do not broaden access, retry an ambiguous write, or skip an invariant.
Turning switches off does not delete already stored private evidence.

## Not included

This is observed supported sales/product processing, not automatic certified
product/spend/customer/funnel reporting. Optional sizes remain private sidecars
until a separate aggregate definition and destination are approved. Missing
analytics permission, identity history, customer history, spend completeness,
subscription authority and missing events are not supplied by this change.
