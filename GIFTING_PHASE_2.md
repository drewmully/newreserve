# Gifting Phase 2 — Where Everything Lives

Recipient-email pipeline + auto-cancel after first shipment.
All code is live on `main` and deployed to mymully.com.

---

## Setup required before it actually runs

Two things you need to do once in the dashboards. Until both are done, the pipeline is dormant (no data loss — orders still queue up in Firestore, they just won't send email or auto-cancel).

### 1. Vercel env var: `CRON_SECRET`
- Vercel → Project Settings → Environment Variables
- Add `CRON_SECRET` = any long random string (e.g. `openssl rand -hex 32`)
- Apply to Production + Preview, then redeploy
- Vercel cron jobs send this as `Authorization: Bearer <secret>`. Routes also accept `?key=<secret>` for manual curl testing.

### 2. Shopify webhook: fulfillment creation
- Shopify Admin → Settings → Notifications → Webhooks → Create webhook
- Event: **Fulfillment creation**
- Format: JSON
- URL: `https://mymully.com/api/webhooks/shopify/fulfillments-create`
- Uses the existing `SHOPIFY_WEBHOOK_SECRET` (same HMAC as orders-paid — no new secret needed)

`RESEND_API_KEY` is already configured, nothing to change there.

---

## The lifecycle (what happens when)

```
Buyer checks out via /lp/gift
       │
       ▼
orders-paid webhook
  → creates gift_orders/<orderId> in Firestore
  → status = pending_recipient_email
  → SKIPS the buyer's member-tier update (buyer is not a member)
       │
       ▼  (immediately if no gift_deliver_on, else on that date)
cron /api/gifts/scheduled-send   [hourly :15]
  → Resend email to recipient with /gift-sizing/<token>
  → status = recipient_emailed
       │
       ▼
Recipient submits sizing form at /gift-sizing/<token>
  → POST /api/gifts/submit-sizing
  → status = sizing_collected, sizing field populated
       │
       ▼
Shopify ships first box
fulfillments-create webhook
  → status = first_box_shipped
       │
       ▼
cron /api/gifts/post-first-shipment   [hourly :45]
  → cancelLoopSubscription()
  → Resend thank-you email to buyer
  → status = completed
```

---

## File map

### New files

| Path | Purpose |
|---|---|
| `src/lib/gifts/giftOrder.ts` | Firestore types + helpers (`GiftOrderDoc`, `createSizingToken`, `getDueGiftOrders`, `getGiftOrdersAwaitingCancel`) |
| `src/lib/email/templates/giftRecipient.ts` | Subject + text body for recipient email and thank-you email |
| `src/app/api/gifts/scheduled-send/route.ts` | Hourly cron — sends recipient email when due |
| `src/app/api/gifts/submit-sizing/route.ts` | POST — saves sizing data from recipient form |
| `src/app/api/gifts/post-first-shipment/route.ts` | Hourly cron — cancels Loop sub + thank-you email |
| `src/app/api/webhooks/shopify/fulfillments-create/route.ts` | Detects first ship, flips status |
| `src/app/api/admin/gifts/route.ts` | Admin list API |
| `src/app/admin/gifts/page.tsx` | Admin lifecycle dashboard |
| `src/app/gift-sizing/[token]/page.tsx` | Recipient sizing page (server entry) |
| `src/app/gift-sizing/[token]/GiftSizingClient.tsx` | Sizing form (shirt / waist / inseam / shoe / glove + notes) |

### Modified files

| Path | What changed |
|---|---|
| `src/app/api/webhooks/shopify/orders-paid/route.ts` | Detects gift via `note_attributes`, creates `gift_orders` doc, skips member-tier update for buyer |
| `src/app/lp/gift/GiftLPClient.tsx` | Added `recipientEmail` field + validation (was missing) |
| `src/app/admin/layout.tsx` | Added Gifts nav link |
| `vercel.json` | Added 2 cron entries |

---

## Where to access stuff

### Admin dashboard
**https://mymully.com/admin/gifts**

Auth: existing admin email allowlist (`isAllowedAdminEmail`). Shows full lifecycle per order — status, recipient/purchaser, total, timestamps, sizing data, Loop sub id, last_error, and a copy-able sizing link for each row.

### Firestore data
- Collection: `gift_orders`
- Doc ID: Shopify order id (string)
- No index migration needed — current queries (status filter + ordering) work with default Firestore indexes.

Fields on `GiftOrderDoc` (see `src/lib/gifts/giftOrder.ts` for the full type):
- `status` — one of `pending_recipient_email` / `recipient_emailed` / `sizing_collected` / `first_box_shipped` / `completed` / `error`
- `sizing_token` — random 24-byte hex, used as the only auth for `/gift-sizing/<token>`
- `recipient_email`, `recipient_name`, `purchaser_email`, `purchaser_name`
- `gift_message`, `gift_deliver_on` (ISO date or null = send immediately)
- `sizing` — populated when recipient submits form
- `loop_subscription_id` — set after sizing, used by post-shipment cancel
- `last_error`, timestamps for each transition

### Cron schedules (vercel.json)
- `/api/gifts/scheduled-send` — `15 * * * *` (hourly at :15)
- `/api/gifts/post-first-shipment` — `45 * * * *` (hourly at :45)

### Recipient flow URL
`https://mymully.com/gift-sizing/<token>` — single-use per order, random token. No login required.

---

## Manual testing / debugging

```bash
# Trigger scheduled-send cron manually
curl "https://mymully.com/api/gifts/scheduled-send?key=$CRON_SECRET"

# Trigger post-first-shipment cron manually
curl "https://mymully.com/api/gifts/post-first-shipment?key=$CRON_SECRET"

# Verify token-gated sizing page returns 404 for bogus token
curl -o /dev/null -w "%{http_code}\n" https://mymully.com/gift-sizing/badtoken
```

Idempotency: Resend send IDs are `gift-recipient:<orderId>` and `gift-postship:<orderId>`, so reruns won't double-send.

---

## Editing patterns (so you can change copy / behavior)

- **Recipient email copy** → `src/lib/email/templates/giftRecipient.ts`
- **Sizing form fields** → `src/app/gift-sizing/[token]/GiftSizingClient.tsx`
- **Admin columns** → `src/app/admin/gifts/page.tsx`
- **Cron timing** → `vercel.json` (then redeploy)
- **What counts as a "gift" order** → check `note_attributes` parsing in `src/app/api/webhooks/shopify/orders-paid/route.ts`

---

## Critical design choices (so future-you doesn't undo them)

- Gift purchases **skip the member-tier update** in orders-paid — the buyer is not a member, only the recipient becomes one after sizing.
- Recipient sizing page uses a **random 24-byte token as auth** — no login required.
- Auto-cancel uses **Loop's cancel API**, not Shopify's, since subscriptions live in Loop.
- Idempotency keys on Resend so cron retries are safe.

---

## Build / deploy

```bash
cd /home/user/workspace/newreserve
RESEND_API_KEY=re_dummy_for_build npm run build   # local verify
git push origin main                              # auto-deploys to mymully.com
```

Local `npm run dev` will crash from missing Firebase env vars — that's expected. Test against the deployed site.
