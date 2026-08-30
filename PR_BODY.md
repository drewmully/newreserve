# feat(migration): prepaid-annual migration script with dry-run

Adds the one-at-a-time migration endpoint for moving Loop Member
prepaid-annual contracts onto the new Shopify Subscriptions Partner app.
Follows PR #127 (scaffolding) and Section 4 of the migration plan
(`memory/sessions/2026-06-29_2026-07-05/a0280c2d/ai_outputs/loop_to_shopify_migration_plan.md`).

**Draft.** Nothing runs against production data automatically — you
must invoke the endpoint by hand, per contract, with the correct
`contract_id`. Default is a dry run.

## What ships

**New route** — `src/app/api/admin/cron/migrate-prepaid-annual/route.ts`
- `POST` only. Auth: `Authorization: Bearer $CRON_SECRET`, or Firebase
  bearer for an allowlisted admin email (via `verifyAdminRequest`).
- Query params:
  - `contract_id` — **required**. Refuses the request without it. No
    batch mode in this PR by design.
  - `dry_run` — defaults to `true`. Only the exact string `false`
    turns it off.
- Enforces the exact prepaid-annual signature before doing anything:
  `status=ACTIVE`, `isPrepaid=true`, `billingPolicy={MONTH,12}`, one line
  on variant `47601025122496` (Member $249/qtr). Anything else → 422,
  no row written.
- Reads `getLoopSubscriptionById` from the existing `loopAdmin.ts` (no
  changes to that file). Captures `customerPaymentMethodId` verbatim
  along with the full raw contract into `raw_loop_snapshot`.
- Inserts a row into the new `public.subscription_migrations` table
  before doing any external writes. Idempotent: a prior `migrated` or
  `dry_run_ok` row is returned as-is; a prior `failed` or `planned` row
  triggers a `409` so a human looks before we double-write.
- Dry-run path: writes row status `dry_run_ok`, returns the exact input
  we would send to `subscriptionContractAtomicCreate`.
- Real path (`dry_run=false`): calls
  `createContractAtomic` (helper already in place from PR #127), then
  `cancelLoopSubscription(id, "migrated_to_shopify_native")`, then
  fans out to Firestore (`users/{uid}.subscription_contract_ids`) and
  `public.subscribers.shopify_subscription_id`. Errors are captured in
  the row with clear status transitions:
  - Shopify create fails → row `failed`, Loop untouched.
  - Loop cancel fails after Shopify create → row `failed` with both ids
    and an error message; caller sees `loop_cancel_failed_after_shopify_create`
    and follows the runbook.
  - Firestore/subscribers update failures are logged into
    `error_message` but do not undo a successful migration.
- Also refuses real execution when
  `SHOPIFY_QUARTERLY_MEMBER_SELLING_PLAN_ID` is not set, since the new
  Partner-Dashboard app publishes its own selling plans.

**New Supabase migration** — `migrations/20260830_subscription_migrations.sql`
- Creates `public.subscription_migrations` per the spec in the PR ticket,
  with `loop_contract_id UNIQUE`, status CHECK, and status/planned-at
  indexes. Raw Loop + Shopify blobs stored as `jsonb` so incidents can
  be reconstructed from Postgres alone.
- Adds `shopify_subscription_id text` to `public.subscribers` so
  admin UI and weekly-rollup can point at the new contract without
  losing the existing `loop_subscription_id` during the grace window.
- **NOT APPLIED.** Emitted for Drew to apply manually via psql, matching
  the convention of `20260830_subscription_events.sql`.

**Runbook** — `docs/loop-shopify-migration-runbook.md`
- curl invocation examples with `CRON_SECRET`.
- Dry-run → review → real-run flow.
- Full manual rollback recipe for the "Shopify created, Loop still
  ACTIVE" state, including exact SQL for `subscribers` and
  `subscription_migrations`.
- The 30-day "do not uninstall Loop yet" rule and its rationale
  (Shopify Payments vault handoff must clear one full renewal per
  migrated contract before Loop can be removed safely).

**Tests** — `tests/api/migratePrepaidAnnual.route.test.ts`
Twelve tests covering:
- 401 unauth, 400 missing `contract_id`
- Dry-run happy path (row is `dry_run_ok`, no Shopify or Loop calls)
- 404 when Loop returns null
- 422 signature mismatch (Access variant)
- 422 when contract status is not `ACTIVE`
- Idempotent short-circuit for `migrated` and `dry_run_ok` rows
- 409 when a prior `failed` row exists
- Real-path Shopify create failure → Loop untouched
- Real-path Loop cancel failure → row `failed` with both ids
- Real-path full success — asserts the exact Shopify input shape
  (customer GID, MONTH/3 billing + delivery, payment-method GID,
  variant GID, selling-plan GID)
- Real path refused when `SHOPIFY_QUARTERLY_MEMBER_SELLING_PLAN_ID`
  is missing

## What was NOT changed

- `src/app/api/_lib/shopifySubscriptionsApi.ts` — `createContractAtomic`
  is already the exact shape this route needs (from PR #127). No edits.
- `src/app/api/_lib/loopAdmin.ts` — `getLoopSubscriptionById` and
  `cancelLoopSubscription` used unchanged.
- `SUBSCRIPTIONS_BACKEND` feature flag — **not** flipped. This route
  operates through the migration endpoint only.
- `/account` UI — untouched. Cutover PR is separate.

## Invocation cheat sheet

```bash
# Dry run
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://newreserve.mully.co/api/admin/cron/migrate-prepaid-annual?contract_id=10011705"

# Real run (after reviewing dry-run response)
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://newreserve.mully.co/api/admin/cron/migrate-prepaid-annual?contract_id=10011705&dry_run=false"
```

## Safety properties

- One contract at a time. No batch mode.
- Dry-run by default. Only `dry_run=false` executes.
- Refuses to migrate anything but an ACTIVE Member prepaid-annual with
  the exact signature.
- Idempotent — safe to re-run.
- Every state transition is auditable in `subscription_migrations`.
- Loop write is only attempted after Shopify write succeeds.

## Follow-ups (out of scope here)

- Batch driver that reads segmentation.csv and calls this endpoint per
  contract with a delay + retry policy.
- Cutover PR that flips `SUBSCRIPTIONS_BACKEND=shopify` and updates
  `/account` to read from the new contract ids.
- Loop decommission PR (after 30-day grace + one full renewal cycle per
  migrated contract, per runbook).
