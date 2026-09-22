# MyMully: Shopify source mapping and test results

Prepared September 22, 2026. This is a local, additive implementation on top of
the analytics PR stack, not a deployment or a completed live Shopify pipeline.
The source fixtures use Shopify's documented GraphQL response shape, but they
are synthetic records, not downloaded customer orders.

## What this slice implements

- **Read-only source reader:** `src/lib/analytics/shopifySource.ts` requests one
  order by its GraphQL ID using a fixed query, explicit shop and access token,
  and API version `2026-07`. It follows every line-item page up to a configured
  bound, checks the source revision across pages and again at completion, and
  rejects partial responses, changing revisions, duplicate lines and repeated
  cursors. The actual API-version header must match the requested version;
  Shopify can otherwise fall forward to a different supported version
  ([Shopify API versioning](https://shopify.dev/docs/api/usage/versioning)).
- **Source-to-contract mapper:** `src/lib/analytics/shopifyMapping.ts` maps the
  source document into the existing `orders`, `order_items` and `payments`
  contracts. It uses string IDs and exact decimal arithmetic, keeps uncertain
  values null, and explicitly returns `publishable: false`.
- **No production side effects:** No existing route imports these modules.
  No credentials were loaded, no customer Shopify query was run, no remote
  database was changed, and no worker, schedule, backfill or PostHog connection
  was activated. No paid staging resource was created.

## Field mapping

| Shopify source | Analytics destination | Rule |
| --- | --- | --- |
| Order `id` | `source_order_id`, hashed `order_id` | Preserve numeric portion as a string, including values above JavaScript's safe integer limit. Namespace keys by shop. |
| Order `createdAt`, `updatedAt` | `created_at`, `source_updated_at` | Validate timestamps; changing revisions during the read fail the run. |
| LineItem `quantity` | `quantity` | Use original ordered quantities, including refunded units, not `currentQuantity`, which excludes refunded/removed units ([LineItem](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/LineItem)). |
| `originalUnitPriceSet.shopMoney` and `originalTotalSet.shopMoney` | Original unit price and gross merchandise | Verify unit price times quantity equals the independent line total; never substitute current order totals ([LineItem](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/LineItem)). |
| `discountAllocations[].allocatedAmountSet.shopMoney` | `purchase_discount_usd`, line net | Sum actual allocations; these represent calculated discounts assigned to the line ([DiscountAllocation](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/DiscountAllocation)). |
| `subtotalPriceSet.shopMoney` | Independent validation | All line gross amounts minus their allocations, including gift-card/other lines, must match this subtotal before merchandise is separated. The source subtotal is after discounts and before returns ([Order](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Order)). |
| `isGiftCard` plus approved line classification | `item_class` and merchandise inclusion | Gift cards do not become merchandise. Other item classifications require an explicit approved map; missing classifications remain unknown. |
| Successful SALE/CAPTURE amounts plus `originalTotalPriceSet` | `paid_at`, `purchase_date` | Require the complete transaction list and an exact match to the original total, then use the final successful payment-processing timestamp. Authorization is not an additional payment ([transaction kinds](https://shopify.dev/docs/api/admin-graphql/2026-07/enums/OrderTransactionKind)). |
| Transaction `id`, `kind`, `status`, `amountSet`, `parentTransaction` | Payment IDs, type, status, signed source amount and parent link | Refund amounts become negative. Validate the parent exists in the same order and gateway; unsupported kinds/statuses stop mapping ([OrderTransaction](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/OrderTransaction)). |
| No independent settlement evidence | `cash_eligible=false`, `settled_at=null`, `cash_amount_usd=null` | A successful order transaction is not treated as bank-settled cash. This preserves the existing workbook settlement gate. |
| No approved identity/checkout/offer evidence | Null identity and checkout links; empty offer memberships | Do not guess customer matches, subscription renewals, checkout links or offer membership from tags, SKUs or discount codes. |

The query asks for at most 250 transactions and compares the returned array
length with `transactionsCount`, requiring `EXACT` precision. Anything larger,
truncated or approximate stops the order rather than silently omitting financial
history ([Count](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Count),
[CountPrecision](https://shopify.dev/docs/api/admin-graphql/2026-07/enums/CountPrecision)).

## Cases deliberately blocked or withheld

- **Edited orders:** A post-edit response is not treated as the original purchase
  snapshot. A retained pre-edit snapshot and explicit adjustment mapping are
  still needed.
- **Tax-inclusive prices:** Require an explicit tax allocation implementation;
  tax-inclusive amounts are not mislabeled as tax-exclusive merchandise.
- **Unproven full payment:** Partial payments, missing payment timestamps and
  authorization-only orders cannot be marked eligible. A policy-approved
  pending order may retain null paid fields.
- **Exceptional transactions:** Unknown statuses, cash change, suggested refunds,
  mixed test/live transactions, missing gateway or parent information, and
  overpayment require review rather than invented mappings.
- **Unapproved business classifications:** The caller must provide an approval
  reference, eligibility/source decision and catalog classifications. The
  synthetic policy in tests is not customer approval.
- **Non-USD orders:** Preserve source amounts and currency but leave USD metrics
  unknown; this slice performs no FX conversion.

Shopify exposes `edited` and `taxesIncluded` explicitly; its subtotal and line
prices include tax when `taxesIncluded` is true
([Order](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Order)).
The safety restrictions above are implementation choices, not claims that
Shopify cannot represent those cases.

## Tests run

All new source-mapping tests forbid real network calls. HTTP responses are
mocked, and database validation uses a disposable local PGlite Postgres instance.

| Check | Final result |
| --- | --- |
| New Shopify source/mapping tests | 52 passed |
| Entire analytics suite | 279 passed across 18 files |
| Existing local receipt-to-report tests, included above | 7 passed; still use their original synthetic evidence adapter |
| Analytics TypeScript check | Passed |
| Analytics lint, including the new modules and tests | Passed |
| Regenerate staging/report SQL and compare with tracked definitions | Passed; no SQL changes |
| Full application suite | 614 passed; 11 failing tests plus one suite-loading failure |
| Full-suite failure-name comparison | Same 12 failure entries as the previously saved original baseline and compatibility run; no additional failing test names |

The new tests cover original versus current values, multiple discount
allocations, gift-card exclusion, exact decimals and large IDs, refunds and parent
links, partial captures, authorization exclusion, failed/pending payments,
missing evidence, replay determinism, currency mismatch, non-USD handling,
unknown catalog data, cancellation/test policy, malformed/truncated/duplicate
records, pagination, revision changes, HTTP/GraphQL/version errors, secret-safe
error handling and shop-host validation.

The new database test applies the actual staging migration, inserts mapped
orders/items/payments, verifies the independently specified merchandise total,
checks that no settled cash or sales ledger is invented, and verifies that
duplicate order insertion is rejected by the real key constraint. This is a
source-shaped mapping-to-database test, not a live Shopify-to-PostHog test.

```sh
npm test -- --project api tests/api/analyticsLeanShopifyMapping.test.ts
npm test -- --project api tests/api/analyticsContracts.test.ts tests/api/analyticsLean
npx tsc -p tsconfig.analytics.json
npx eslint src/lib/analytics src/app/api/analytics/ingest src/app/api/_lib/supabaseService.ts tests/api/analyticsContracts.test.ts tests/api/analyticsLean*.test.ts scripts/analytics/*.mjs
node scripts/analytics/generate-staging.mjs
node scripts/analytics/generate-reporting-sql.mjs
git diff --exit-code -- sql/analytics
npm test
```

## What still needs to happen

1. Review and publish this local slice as a stacked PR. It has not been pushed,
   merged, rebased onto newer main, or deployed.
2. Implement the separate sales ledger: original sales components, refunds
   allocated to items/tax/shipping/duties, adjustments and independent source
   reconciliation. A negative refund payment is not a merchandise-refund ledger.
3. Add approved classification configuration and durable source retention, then
   integrate the asynchronous source reader with worker orchestration. The current
   worker's transform is synchronous; this module is not silently wired into it.
4. Validate a small, explicitly approved sample of actual orders using the
   runtime app's read permission. Browser access or an accepted Shopify invite
   alone does not validate that runtime token or query.
5. Test isolated database writes, scheduled processing, certification/publication
   and PostHog reads before enabling production. Settlement data and the other
   workbook domains still need their own source evidence.

The source reader's revision checks detect observed changes; they do not create
an atomic Shopify snapshot. The caller must retain the source document under
the evidence reference, handle failures as incomplete, and never mark a
source-shaped test or a mapped subset as a certified full publication.
