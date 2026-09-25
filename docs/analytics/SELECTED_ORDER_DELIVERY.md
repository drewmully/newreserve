# Selected-order verification — real source, prior test policy

This is **not** a store/day total or a new merchandise-policy approval. It
reuses one completed 016 pilot's saved facts and `storeDaily` / `productDaily`.
Every row says `selected_order_sample`, `prior_single_order_test`,
`certified=false`, `complete_window=false`, `selected_order_count=1`, and
`is_stale=true`. Monetary observations are `observed_unverified`; unsupported
cash, customer, spend and comparison metrics remain null. The source revision
timestamp travels with each row. No source/order/customer ID or geography is
exported; SKU is the actual saved product dimension.

The first proposed selection is pilot
`bd7f3419-0a05-4385-9c35-4247d95f5f9a`, **not both runs of the same order**.
Parent verified real original purchase USD250, one RES-MEM item/one unit, no
retained refunds, matching retained fingerprint, and purchase date 2026-09-21.
Those are source observations under the prior isolated single-order **test**
policy, not authority to generalize eligibility to other orders.

## Finite owner workflow

1. Install 044 disabled after 016. It adds only a private registry/functions;
   it does not touch 039/041/042/043, existing facts, certified pointers or crons.
2. As database owner, save this JSON value to a private `owner-input.json`:

   ```sql
   select public.lean_selected_order_input('bd7f3419-0a05-4385-9c35-4247d95f5f9a');
   ```

   This is a local canonical-facts read, not Shopify. Exact decimal strings
   avoid JavaScript rounding. Raw retained source and policy stay in the DB;
   the input hash binds both plus **all four full canonical fact tables**
   and the original saved store report. Hash equality is integrity, not
   independent source completeness.
3. Offline in the repository:

   ```sh
   node scripts/analytics/selected-order-project.mjs owner-input.json aggregate.json
   ```

   Actual purchase/ledger dates define the rows; no invented empty days.
   The command calls existing formulas, writes only the two allowlisted
   aggregate arrays, and reports row counts/input hash.
4. Register the exact output as owner (parameterized values, no secrets):

   ```sql
   select public.lean_selected_order_register(
     $scope, $run::uuid, $input_hash, $aggregate::jsonb,
     $sample_delivery_approval, $absolute_expiry::timestamptz);
   ```

   Registration is disabled, insert-only, bounded to <=24h absolute expiry.
   Re-registration under the same ID fails, never replaces a result. Owner
   reviews/readbacks before `update lean_private.selected_order_delivery
   set enabled=true where scope_id=$scope`. Disabling is the only allowed
   registry update. Runtime cannot extract private facts, register, change
   expiry, write a report, approve policy or certify anything.
5. Build a combined package (043 spend function stays byte-identical):

   ```sh
   node scripts/analytics/package-selected-order.mjs /absolute/new-package
   ```

   The command invokes the unchanged 043 packager then adds only the new
   selected-order function and route. Both existing `/observed` and new
   `/selected-order` URLs remain; the manifest retains the original 043
   hashes. It does not change 043 environment variables or enablement.
   Parent deploys only in isolated Preview with
   `VERCEL_GIT_COMMIT_REF=review/analytics-initial-validation`,
   `LEAN_SELECTED_ORDER_ENABLED=true`, a fresh dedicated
   `LEAN_SELECTED_ORDER_SECRET` (32–512 characters), fixed
   `LEAN_SELECTED_ORDER_SCOPE_ID`, project `xeqlgxvrhgwwudyqtnun`,
   and existing server-only isolated Supabase URL/service key.
   Default is OFF. PostHog gets only the dedicated bearer, **never** a DB key.
6. Save authenticated GET `/api/analytics/reports/selected-order` to
   `saved-get.json`, then repeat:

   ```sh
   node scripts/analytics/selected-order-project.mjs owner-input.json verified-aggregate.json saved-get.json
   ```

   A mismatch fails. No new source query occurs. The read fails if source,
   policy, full saved facts, saved store report, or aggregate snapshot drifts.
7. Parent configures the two PostHog Custom REST array streams `store_daily`
   and `product_daily`, runs one sync, compares actual date/SKU/decimal/null/
   scope/readiness fields to `verified-aggregate.json`, then pauses source
   and disables delivery. Keep warnings in **each imported row**. A paused
   source does not delete already imported rows.

Expected first-order check (only after actual input confirms it): store
Sep21 gross/net/total and AOV `"250.000000"`, orders `1`, refunds/discounts
`"0.000000"`; product RES-MEM units `"1.000000"` and gross/net
`"250.000000"`. No source/provider calls, no first-customer/session claim,
and no claim that this sample completes any whole-day workbook acceptance.
