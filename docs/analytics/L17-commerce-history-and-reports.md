# Commerce history and combined reports

This slice adds a fixed, read-only Shopify order inventory, durable-page runner
and combined store/product report builder. It does not enable a source, create a
hosted branch, install a schedule, or certify a store-wide publication.

## Import

`runShopifyHistory` verifies the token's actual `read_orders`/`write_orders`
scope, plus `read_all_orders` for older history, on each invocation. It reads
an approved half-open creation-time window using `CREATED_AT`, at most 20
orders/page and 20 pages/invocation. Pass an overall AbortSignal. Every listed
order is hydrated with the existing bounded order/financial/refund reader.
A changed revision, missing order, nested pagination limit or source failure
prevents that page's cursor from advancing. Resume only from the durable cursor.

The caller must load immutable scope from an operator-registered run, not
accept a shop/window/approval from an untrusted request. Its `commitPage` must
atomically retain sources and CAS the cursor, as migration 015 provides.
Reaching the final cursor proves enumeration only, not historical or financial
completeness. Shopify is not a snapshot-isolated reporting source: use a second
reconciliation pass to detect concurrent changes and deleted/missing orders.

Source contracts: [orders pagination/filtering](https://shopify.dev/docs/api/admin-graphql/latest/queries/orders),
[sort keys](https://shopify.dev/docs/api/admin-graphql/latest/enums/OrderSortKeys),
[historical order access](https://shopify.dev/docs/api/admin-graphql/latest/queries/order).

## Reporting

`buildCommerceCandidate` takes retained sources plus reviewed per-order policy,
chooses the latest revision, rejects same-revision conflicts and policy drift,
and creates one publication. It aggregates all orders before calculating AOV;
it does not add per-order ratios. Duplicate imports do not multiply facts.
Reports have a bounded New York date spine; sources are NOT filtered by creation
date inside reporting because later refunds can belong to older orders.

Every non-null metric is labeled `observed_unverified`, including zero-activity
sample days; `is_stale` is true. Cash, customer, spend and acquisition metrics
remain null. Never sync these rows into certified selected-publication views.
They are inspection candidates, not a completed warehouse release.

## Remaining commerce gates

- Register immutable import scopes and runtime ownership; wire durable history
  job registration/dispatch, not caller-provided arbitrary scopes.
- Reconcile an independent complete inventory and currency/component totals.
- Broaden the original mapper for edited, tax-inclusive, cancelled, gift-card,
  unusual-refund and other unsupported orders. They currently block rather than
  disappear. The new importer does not make these accounting decisions.
- Add authoritative gateway settlement and approved purchased-offer evidence.
- Release frozen candidates transactionally and prove Supabase/PostHog readback.

No full-history, settlement, identity, attribution, spend, or full-pipeline
completion claim is implied by this slice.
