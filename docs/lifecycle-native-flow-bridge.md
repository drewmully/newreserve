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
| 2609447104, 2614526144, 2614558912, 2620522688, 2669215936, 2669281472, 2700312768, 2700345536, 2700378304, 2819883200, 2839904448, 2871132352, 2902098112, 2989392064, 2989424832, 3004891328, 3004924096, 3004956864 (legacy) | Loop | Created Loop-app renewals among all 4,000 renewals Oct 16 2025 to Oct 9 2026 |
| 3654713536 Swing Box, 3259433152 Deliver every year | **Unverified** | Held until confirmed |

Renewals (`subscription_contract_checkout_one`, and `subscription_contract` used by Loop until
September 2025) created by app 5284869 are Loop regardless of plan, including deleted plans.
A non-Loop renewal counts as native only when every plan on it is a native plan.

Recharge Subscriptions (app 294517) ran subscriptions from 2021 to March 2025. Its orders, and
pre-March 2025 orders whose plan was since deleted, are **legacy membership**: they make a
returning member "not first-time" (new-member programs hold) but never count as a paid cycle
on a current contract.

Read-only baseline (October 9, 2026, 48 sampled customers: 29 active Loop members, 19 recent
buyers, full live Shopify histories): every history read completely and none held. 26 of 29
active members have two or more qualifying Loop cycles. Before the Recharge and deleted-plan
rules, 16 of 29 active members would have been wrongly held.

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

## Business rules (Drew, October 9, 2026)

- Support pause: only an **open Intercom** thread with an Intercom message in the **last 14
  days** pauses lifecycle email for that customer. Gmail, Resend and SendBlue do not. At
  the time of the decision, this paused 77 customers, compared with 907 under the old
  any-open-thread rule.
- Product reviews: **Junip** sends review requests. Klaviyo delivery emails must not ask for
  reviews.
- Swing Box: ignored. Its plan stays unregistered, so its orders never enter lifecycle email.
- Size reminder (member email M2): skipped for this launch pass. `SIZE_REMINDER_ENABLED` in
  `src/lib/lifecycle/readiness.ts` is `false`, so `mully_wave1_setup_incomplete` is always false.
- Nonmember proof: an email with no Shopify customer, or a customer whose complete order
  history has zero subscription orders (Loop, Recharge or native) and no contract rows, is a
  verified nonmember. Gap: a contract created by hand in Shopify admin with no order.

## Readiness profile properties

`src/lib/lifecycle/readiness*.ts` writes the `mully_wave1_*` / `mully_wave2_*` properties
the draft flows and campaign segments filter on. Evidence properties (member, nonmember,
cancelled, support pause, earned reward) are facts. Program `*_ready` flags are true only for
programs listed in `LIFECYCLE_READINESS_PROGRAMS`, with sendable consent and every
prerequisite verified. Any unreadable source holds. Sunset is never enabled.

- Batch: `GET /api/admin/cron/lifecycle-readiness?offset=0&limit=50` (cron auth, not
  scheduled). Returns counts and hold codes only.
- Signup: refreshed inline before the "Mully Site Signup" event, so the immediate welcome
  sees current flags.
- Earned reward: only the highest earned code (SMS MULLYTEXT15 15%, email MULLYEDIT10 10%),
  only if unused by that email and active in Shopify. A spent 15% never falls back to 10%.

## Cart recovery links

Added to Cart events carry `RecoveryURL` (`https://www.mymully.com/cart/recover?c=&k=&p=`).
`/cart/recover` checks the Storefront cart: live and non-empty goes to its checkout URL
without tracking parameters, otherwise the product page, otherwise shop-all. Cart emails
CA1/CA2 (flow `TEqdeg`) show "Return to your cart" when the link exists and "View the item"
otherwise.

## Switches (all unset today)

| Variable | Effect when set |
| --- | --- |
| `LIFECYCLE_NATIVE_FLOW_INGEST_ENABLED=true` | Flow intake accepts and stores events |
| `LIFECYCLE_FLOW_SHARED_SECRET` | Required for intake; 32+ chars |
| `LIFECYCLE_DISPATCH_ENABLED=true` + `LIFECYCLE_DISPATCH_PROGRAMS=…` | Dispatcher may send for listed programs |
| `LIFECYCLE_READINESS_WRITE_ENABLED=true` | Readiness writer runs (batch route and signup) |
| `LIFECYCLE_READINESS_PROGRAMS=welcome,browse,…` | Programs whose `*_ready` flag may be true |
| `LIFECYCLE_RECOVERY_LINKS_ENABLED=true` | Cart events carry `RecoveryURL`; `/cart/recover` reads carts |

## Known limits

- Contracts created outside checkout (manual or imported) have no origin order. They still
  appear in the daily snapshot, so they are covered once the snapshot is live.
- Loop coverage from the `loop_subscriptions` mirror proves contracts that exist. An empty
  result alone is not proof of nonmembership and holds; only the complete-order-history rule
  above upgrades it.
- Shopify cart recovery depends on Shopify keeping the cart; expired carts fall back to the
  product page.
- Unknown selling plans on any historical first order hold that customer's history until the
  plan's owner is verified and registered.
