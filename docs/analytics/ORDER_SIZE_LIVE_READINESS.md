# Order-time top-size live readiness (not activated)

This additive package provides a separate default-off, fixed size aggregate:

- fixed server-role aggregate RPC `lean_order_size_reports_read()` (SQL051, STABLE, read-only),
- `GET /api/analytics/reports/order-size`, guarded by
  `LEAN_ORDER_SIZE_REPORTS_ENABLED=true`, and
- the already reviewed selected-latest-head aggregate/provenance checks.

It does **not** alter the live SQL050 financial RPC or its strict
`store_daily`/`product_daily` response. Size disable/revert leaves financial
delivery available. It creates no table, source read, schedule, hook, publication,
PostHog login or direct private-table grant. The only non-owner grant is
`service_role` execution of the new RPC; PostHog/other roles receive no access. The proposed HTTP bearer
binding reuses `LEAN_PRODUCTION_REPORTS_SECRET` but this package never reads or
copies a credential.

## Meaning and output

The only approved product is Shopify product `8501257044160`, merchandise with
`requested_box_top_size`. `Top size` is the requested preference associated with
purchased BOX line units. Quantity is **BOX units**, not actual shirts purchased,
packed or fulfilled, and is not return-adjusted. No current profile, customer,
address, catalog or shirt-in-box inference is allowed.

Output is one `order_size_daily` array. Every row includes purchase date, SKU,
semantics/status/value, exact six-place original purchase quantity, contributing
line count and warnings: selected-observed latest-head scope, stale, unverified,
not certified, not complete history, not fulfillment-proven and not return-adjusted.
No order/item/publication/customer IDs, source/policy references, raw attributes
or titles are returned. Missing/invalid/conflict/unsupported/projection-absent
remain explicit. Valid old size-off heads stay in the denominator as
`not_collected`; newer missing never backfills an older known size. Refund dates
do not create/adjust size-unit rows.

Heads=0 alone can return `no_selected_orders`. Heads>0 with missing/corrupt joins,
inconsistent evidence, unsupported live policy, missing046/051 or permission/SQL
errors are unavailable (`null`/HTTP503), never a successful zero distribution.
The read uses all selected-head purchase dates and rejects ranges beyond366 days;
it does not silently roll or truncate history. The endpoint caps10,000 rows/4MiB.

## Exact future activation sequence (requires new approval)

1. Keep the existing production target, date/catalog scope, four hooks, scheduler
   and SQL050 financial controls unchanged.
2. Owner installs optional SQL046, then SQL051 **in that order**, verifies only
   service-role RPC execution and no underlying table access. SQL051 changes no
   delivery/source gate and returns unavailable under the current size-off policy.
3. Record the actual new approval reference through the existing immutable-scope
   audit while updating only new claims to:
   - `sourceProjection: financial_no_geo_order_size`
   - `sourceRetention: financial_allowlist_v1`
   - `retainedReports: product-v1`
   - `orderSize.policyRef: <actual approval>`
   - `orderSize.productSemantics: {"8501257044160":"requested_box_top_size"}`
4. Before enabling the HTTP flag, run owner readbacks for scope/policy,046/051
   ACLs, new genuine-head evidence and financial SQL050 byte/metric continuity.
   Enable `LEAN_ORDER_SIZE_REPORTS_ENABLED` independently. No automatic PostHog
   resource is added by this package.

The live approval must disclose that Shopify has no attribute-key filter:
hydration transiently receives **all line customAttributes and variantTitle**,
including `_quiz_profile_id`, Style, Fit, Waist and other same-line values, and
can do so for an order later rejected by product/date eligibility. Only sanitized
canonical enum/status evidence survives existing retention. No customer/address
fields are introduced.

## Immutable-history and rollback limits

Existing in-flight snapshots keep their original policy. Same-revision source
mismatch remains a failure. Do not reread/rewrite old size-off orders, reset work,
reinterpret snapshots or synthesize events to fill old missing size. Only a
genuine newer source event may produce a new head.

Size-only rollback first disables `LEAN_ORDER_SIZE_REPORTS_ENABLED`, then restores
the previous source policy for **new claims** through the existing audit. The size
RPC becomes unavailable; SQL046 and retained evidence stay private and are not
deleted. Already-claimed size snapshots need explicit in-flight handling; policy
rollback does not retroactively cancel a source request. Never disable the sales
scope, hooks, scheduler or SQL050 financial delivery for a size rollback.

Focused synthetic tests exercise the actual reader → minimized retention →
047+046 → SQL051 → authenticated GET, missing/conflict/not-collected/latest-head
behavior, read purity, grants, budgets and financial050 continuity in disposable
PGlite only. No provider/production data, credential, hosted install, approval,
actual size coverage or activation has been tested.
