# Loop → Shopify Subscriptions migration runbook

Operational guide for running `POST /api/admin/cron/migrate-prepaid-annual`,
the one-at-a-time migration endpoint introduced in PR #128. See also:

- `memory/knowledge/projects/loop-to-shopify-subscription-migration.md`
- `memory/sessions/2026-06-29_2026-07-05/a0280c2d/ai_outputs/loop_to_shopify_migration_plan.md`
  (Sections 3 and 4)
- `migrations/20260830_subscription_migrations.sql` — audit table + `subscribers.shopify_subscription_id` column

## Scope

This route migrates a **single** Loop contract that matches all of the following:

- `status = ACTIVE`
- `isPrepaid = true`
- `billingPolicy = { interval: MONTH, intervalCount: 12 }`
- Exactly one line, on `variantShopifyId = 47601025122496` (Member $249/qtr)

Anything else is rejected with `signature_mismatch` and no row is written.
Batch mode is intentionally not supported in this PR.

## Prerequisites

1. `migrations/20260830_subscription_migrations.sql` applied to Supabase prod.
2. `SHOPIFY_SUBSCRIPTIONS_TOKEN` set in Vercel (from PR #127).
3. `SHOPIFY_QUARTERLY_MEMBER_SELLING_PLAN_ID` set in Vercel — the numeric id of
   the quarterly Member selling plan under the new Partner-Dashboard app.
   Real migrations refuse to run without this.
4. `CRON_SECRET` set in Vercel (already the case).
5. Contract has been dry-run at least once and the response reviewed.

## Invoking the endpoint

### Dry run (default)

```bash
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://newreserve.mully.co/api/admin/cron/migrate-prepaid-annual?contract_id=10011705"
```

Response:

```json
{
  "ok": true,
  "dry_run": true,
  "migration_row": { "id": 1, "status": "dry_run_ok", "...": "..." },
  "would_create": {
    "customerId": "gid://shopify/Customer/7549514318016",
    "nextBillingDate": "2026-11-03T00:00:00.000Z",
    "variant": "gid://shopify/ProductVariant/47601025122496",
    "cyclesRemaining": 3,
    "unshippedCreditUsd": 750,
    "paymentMethodField": "customerPaymentMethodId",
    "paymentMethodId": "11249780"
  }
}
```

Review `would_create` carefully — this is the exact shape that will be sent
to `subscriptionContractAtomicCreate` when you flip `dry_run=false`.

### Real execution

```bash
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://newreserve.mully.co/api/admin/cron/migrate-prepaid-annual?contract_id=10011705&dry_run=false"
```

Success response:

```json
{
  "ok": true,
  "dry_run": false,
  "migration_row": {
    "status": "migrated",
    "new_shopify_contract_id": "gid://shopify/SubscriptionContract/1234",
    "executed_at": "2026-08-30T...Z"
  },
  "shopify_response": { "id": "gid://shopify/SubscriptionContract/1234", "status": "ACTIVE" },
  "loop_cancel_response": { "ok": true }
}
```

**The endpoint is idempotent.** Re-running against a contract with a
`migrated` or `dry_run_ok` row returns the existing row with
`idempotent: true`; no new work is performed.

## Failure states and what to do

| Status | Meaning | Action |
| --- | --- | --- |
| `planned` | Row inserted but neither dry-run finish nor real path completed (crash mid-request). | Contact Drew; usually delete the row and rerun the dry-run. |
| `failed` with `new_shopify_contract_id = null` | Shopify create failed. Loop untouched. | Fix the underlying cause (scope, sellingPlan id, address validity), delete the row, rerun. |
| `failed` with `new_shopify_contract_id` set | Shopify created a contract but Loop cancel failed. **Both are live.** | Follow the manual rollback below immediately. |

The route returns 409 on a subsequent run if any prior row is in `planned`
or `failed`, forcing you to look before you touch it.

## Manual rollback (single contract)

Only needed for the "Shopify created, Loop still ACTIVE" state.

1. **Cancel the new Shopify contract** using
   `shopifySubscriptionsApi.cancelContract()` from the Node repl, or
   directly against Shopify Admin GraphQL:

   ```graphql
   mutation { subscriptionContractCancel(subscriptionContractId: "gid://shopify/SubscriptionContract/1234") { contract { id status } userErrors { field message } } }
   ```

2. **Verify Loop is still ACTIVE** (`GET /subscription/<id>` via Loop admin).
   If it is, no further Loop action is needed. If it was in fact cancelled,
   call the Loop reactivate endpoint (`cancelLoopSubscription` wraps
   `/subscription/<id>/cancel`; `reactivateLoopSubscription` is the inverse
   and works within Loop's grace window).

3. **Restore Firestore pointer.** In `users/{uid}.subscription_contract_ids`,
   remove the new Shopify GID so `/account` (once cut over) does not read
   the cancelled contract.

4. **Restore subscribers pointer.**
   ```sql
   update public.subscribers
     set shopify_subscription_id = null
     where customer_id = '<shopifyCustomerId>';
   ```

5. **Mark the migration row.**
   ```sql
   update public.subscription_migrations
     set status = 'rolled_back',
         error_message = coalesce(error_message,'') || ' | manually rolled back <date>'
     where loop_contract_id = '<id>';
   ```

## Post-migration verification

Run these after each migration; save the outputs in the migration ticket.

```sql
-- 1. The row landed as expected.
select id, loop_contract_id, new_shopify_contract_id, status, dry_run, executed_at
  from public.subscription_migrations
  where loop_contract_id = '<id>';

-- 2. subscribers.shopify_subscription_id was set.
select customer_id, loop_subscription_id, shopify_subscription_id, status
  from public.subscribers
  where customer_id = '<shopifyCustomerId>';

-- 3. No duplicate active contracts for this customer under the Partner app.
--    Use the Shopify Admin: Customers → <customer> → Subscriptions tab.
```

Confirm the customer's next scheduled shipment date in Shopify equals
`loop_next_billing_date` on the migration row.

## The 30-day "do not uninstall Loop yet" rule

Even after every prepaid-annual contract is migrated:

- **Do not uninstall the Loop app** for at least 30 days after the last
  migration.
- **Do not truncate `public.subscription_events` or `subscription_migrations`.**
- Shopify Payments vault handoff between apps only fully clears after
  each migrated contract has been charged **at least once** under the
  new Partner app. Uninstalling Loop early can break the vault reference
  and force customer re-collection.

Track first successful renewal per contract via
`subscription_billing_attempts/success` webhooks landed in
`public.subscription_events`. Only once every migrated row has ≥ 1
successful attempt AND 30 days have passed is it safe to plan the Loop
decommission (separate PR).

## Resilience behavior

- Loop admin calls retry up to 3 times with 2s/4s/8s exponential backoff (max ~14s of backoff + 3x15s per-call = ~59s worst-case per Loop operation).
- Shopify mutations retry up to 3 times with 1s/2s/4s backoff (max ~7s + 3x30s per-call = ~97s worst-case per Shopify operation).
- Total worst-case route runtime: ~3 minutes if all external calls hit max retries. Well within the 300s maxDuration ceiling.
- If Loop is TRULY down (all 3 retries exhaust), the route returns 502 and the audit row is NOT written (fails before the initial planned-row insert). Retry the migration when Loop recovers — no cleanup needed.
