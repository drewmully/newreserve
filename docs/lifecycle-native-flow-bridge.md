# Lifecycle sources: native subscriptions, outbox and dispatch

Status: built, tested, and **off**. Nothing in this change runs on its own, writes to the
production database, edits Klaviyo, or emails anyone.

## Why this exists

Native outfit contracts (selling plan 6627721408, group 2199224512) belong to Shopify's own
first-party Subscriptions app. No custom app can list them. The production probe returned
zero contracts for mully-subscriptions-api, which means it sees none of its own, **not** that
there are no native subscribers. So native membership needs two independent sources:

1. **Storewide orders** (Admin token with read_all_orders): every paid cycle, from any app.
   See `src/lib/lifecycle/orderHistory.ts` and `src/lib/lifecycle/sellingPlans.ts`.
2. **Shopify Flow** (can act on first-party contracts): status changes, billing successes
   and a daily snapshot. See `src/lib/lifecycle/flowBridge.ts` and
   `POST /api/lifecycle/shopify-flow`.

A customer is "native coverage complete" only when there is a fresh, complete,
untruncated daily snapshot **and** every native order in their full order history maps to a
contract event. Anything else is a hold. Absence is never treated as nonmembership.

## Plan ownership (verified October 9, 2026)

| Selling plan | Owner | Evidence |
| --- | --- | --- |
| 3241476288 Quarterly Reserve | Loop | Headless first orders, Loop change-plan code |
| 3241443520 Annual Access | Loop | Headless first orders, Loop change-plan code |
| 3671163072 Style game | Loop | Loop pause/cancel routes |
| 2609479872 Deliver Every 3 Months | Loop | Loop app (5284869) renewals |
| 6627721408 The Seasonal Edit | Shopify Subscriptions | Native rollout doc, one refunded test order |
| 3654713536 Swing Box | **Unverified** | Held until confirmed |

Renewals (`subscription_contract_checkout_one`) created by app 5284869 are Loop regardless of
plan. A non-Loop renewal counts as native only when every plan on it is a native plan.

## Shopify Flow workflows (to import at activation, not now)

Store the shared secret as a Flow secret named `mully_lifecycle` (at least 32 random
characters, same value as `LIFECYCLE_FLOW_SHARED_SECRET` in Vercel). Every workflow ends in
**Send HTTP request**: method POST, URL `https://www.mymully.com/api/lifecycle/shopify-flow`,
headers `Content-Type: application/json` and `x-mully-flow-secret: {{secrets.mully_lifecycle}}`.
Pick variables with the Flow variable picker so paths are validated on save. Bodies contain
**IDs, status and time only**. The endpoint rejects any other field.

1. **Subscription contract created**
   `{"version":1,"kind":"contract_created","occurredAt":"{{ "now" | date: "%Y-%m-%dT%H:%M:%SZ" }}","contractId":"{{subscriptionContract.id}}","customerId":"{{customer.id}}","orderId":"{{subscriptionContract.originOrder.id}}","status":"{{subscriptionContract.status}}"}`
2. **Subscription contract updated**: same body with `"kind":"contract_updated"` and no `orderId`.
3. **Subscription billing attempt succeeded**
   `{"version":1,"kind":"billing_success","occurredAt":"…","contractId":"{{subscriptionContract.id}}","customerId":"{{subscriptionContract.customer.id}}","orderId":"{{order.id}}"}`
4. **Subscription billing attempt failed**: as 3 with `"kind":"billing_failure"`, without `orderId`.
5. **Scheduled time (daily)** → Get subscription contract data (query empty = all statuses,
   maximum 100) → For each contract: `contract_snapshot` with `runId` = the run date
   (for example `run-2026-10-10`), `contractId`, `customerId`, `status` → after the loop, one
   `snapshot_run` body with the same `runId` and `"count"` = number of contracts.
   If the count is 100 or more, the snapshot is treated as truncated and coverage holds.

Activation checks for Flow (do these before trusting coverage):

- Confirm Flow's Get data returns the first-party native contracts (create one test contract
  and see it in the snapshot). Shopify's docs say "from your store" and do not name apps.
- Confirm each trigger fires for a native contract with a test checkout.
- Flow retries on timeouts and 5xx. Validation errors return 422 so Flow does not retry them.

## Outbox and dispatch

- Migration `migrations/20261009_lifecycle_native_events_and_outbox.sql` (review only, not
  applied). Tables have RLS with no policies (service role only) and strict ID/format checks.
  Verified in an embedded Postgres: idempotent rerun, dedupe, exclusive leases, lease-token
  fenced finishes, expired-lease reclaim and constraint rejection.
- `src/lib/lifecycle/dispatch.ts`: enqueue verified candidates only; claim with leases;
  fresh recheck per row; Klaviyo event `unique_id` = dedupe key; bounded exponential
  retry; dead-letter after 5 attempts.
- `GET /api/admin/cron/lifecycle-dispatch`: CRON_SECRET auth, **not scheduled**. Returns
  `{enabled:false}` and claims nothing unless `LIFECYCLE_DISPATCH_ENABLED=true` **and**
  `LIFECYCLE_DISPATCH_PROGRAMS` lists at least one program.
- Recheck (`src/lib/lifecycle/sources.ts`) reads live: the customer's full order history,
  the order contact, Loop mirror, native Flow events, support inbox and Klaviyo consent.

Klaviyo metrics the draft flows will be rewired to (created on first real event, not before):
`Mully Lifecycle Shop Purchase Verified`, `… Shop Delivery Verified`,
`… Member Start Verified`, `… Member First Delivery Verified`.

## Switches (all unset today)

| Variable | Effect when set |
| --- | --- |
| `LIFECYCLE_NATIVE_FLOW_INGEST_ENABLED=true` | Flow intake accepts and stores events |
| `LIFECYCLE_FLOW_SHARED_SECRET` | Required for intake; 32+ chars |
| `LIFECYCLE_SERVICE_CHANNELS_CONFIRMED=true` | Support inbox (Gmail, Intercom, Resend) is the complete set of channels |
| `LIFECYCLE_REVIEW_OWNER=klaviyo` | Klaviyo owns review requests (needed for delivery programs) |
| `LIFECYCLE_DISPATCH_ENABLED=true` + `LIFECYCLE_DISPATCH_PROGRAMS=…` | Dispatcher may send for listed programs |

## Known limits

- Contracts created outside checkout (manual or imported) have no origin order. They still
  appear in the daily snapshot, so they are covered once the snapshot is live.
- Loop coverage from the `loop_subscriptions` mirror proves contracts that exist. An empty
  result is not proof of nonmembership and holds.
- Unknown selling plans on any historical first order hold that customer's history until the
  plan's owner is verified and registered.
