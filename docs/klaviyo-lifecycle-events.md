# Klaviyo lifecycle foundation

What this adds so the Wave 1 to 3 Klaviyo flows have real triggers and data.
Everything is server-side (the site is headless; no Klaviyo script on the site)
and every piece is off until its flag is set to `true` in Vercel.

| Flag | Turns on | Feeds flows |
| --- | --- | --- |
| `KLAVIYO_SITE_EVENTS_ENABLED` | Browse, cart and Reserve-intent events | Browse abandonment, cart recovery, Reserve intent |
| `KLAVIYO_MEMBER_SYNC_ENABLED` | Daily membership properties on profiles | Member welcome, VIP, win-back, exclusions |
| `KLAVIYO_RESTOCK_ENABLED` | Hourly back-in-stock check | Back in stock |
| `KLAVIYO_IDENTITY_SECRET` | Signs the `mully_kid` cookie (32+ chars) | Lets signups be recognized on later visits |

All flags also need `KLAVIYO_PRIVATE_API_KEY` (already set for signup sync).
Scopes this needs on that key: `events:write` (site and back-in-stock events),
`profiles:write` and `lists:write` (bulk profile import for member sync).

## Events

| Klaviyo metric | Source event (`/api/analytics/track`) | Dedupe window |
| --- | --- | --- |
| `Mully Viewed Product` | `proshop_product_viewed` | 30 min per product |
| `Mully Added to Cart` | `add_to_cart` | 5 min per variant |
| `Mully Reserve Intent` | `checkout_clicked` (plan checkouts only), `plan_selected`, `quiz_completed`, `lp_consult_submit`, `lp_subscription_checkout_clicked`, `lp_editorial_checkout_clicked` | 60 min |
| `Mully Back in Stock` | hourly cron on Firestore `back_in_stock_requests` | once per request |

`shop_outfit_reserve_clicked` is mapped too, but the track route deliberately
rejects that event today, so it sends nothing until that policy changes.

### Key properties (use in templates)

- Viewed Product: `ProductID`, `ProductName`, `Brand`, `Categories`, `Price`, `MemberPrice`, `URL`, `ImageURL`, `VariantID`
- Added to Cart: `AddedItemProductName`, `AddedItemBrand`, `AddedItemVariantTitle`, `AddedItemPrice`, `AddedItemURL`, `AddedItemImageURL`, `CheckoutURL` (restores the Shopify cart), `CartTotal`, `CartItemCount`, `ItemNames`
- Reserve Intent: `IntentSource`, `Source`, `Plan`, `Products`, `ProductURLs`, `ReserveURL`
- Back in Stock: `ProductName`, `Brand`, `Size`, `VariantTitle`, `Price`, `MemberPrice`, `URL`, `ImageURL`, `Preorder`
- Every site event: `IdentitySource` = `verified` | `cookie` | `exchange`

## Who gets events

Only known visitors. Anonymous traffic is never sent.

1. **verified**: signed-in member, Firebase token verified on the server with `email_verified = true`.
2. **cookie**: `mully_kid`, an httpOnly HMAC-signed cookie (180 days) set by
   `/api/shop/signup` (email stage) and `/api/editorial/drop-signup` (only when
   that submission consented). Back-in-stock requests do not set it.
3. **exchange**: Klaviyo's `_kx` id from links in Klaviyo emails. The client
   stores it in `localStorage.mully_kx`; it only resolves to an existing profile.

An email typed into a request body never identifies anyone.

Events are not consent. Flows still only send marketing email to profiles that
are subscribed. Back-in-stock requests that did not opt in will get the event
but not a marketing email unless the flow message is approved as transactional.

## Member properties (daily, `/api/admin/cron/klaviyo-member-sync`, 08:20 UTC)

Source: Supabase `loop_subscriptions` (nightly Loop refresh) + `subscribers`.

`mully_member_status` (active | paused | cancelled), `mully_member_plan`,
`mully_member_since`, `mully_member_cancelled_at`, `mully_member_completed_orders`,
`mully_member_next_billing_at`, `mully_member_payment_status`,
`mully_member_last_order_at`, `mully_member_synced_at`.

- `?dry=1` returns counts, sends nothing (works with the flag off).
- `?full=1` also marks every historical cancelled subscriber. Run once at launch.
- Normal runs send everyone in `loop_subscriptions` plus cancellations updated in the last 3 days.
- Properties only. Never changes subscription or suppression status.

## Back in stock (hourly, `/api/admin/cron/klaviyo-restock-check`, minute 25)

Checks waiting requests against the live Storefront catalog. Notifies when the
requested variant (or same size, if the variant id changed) is buyable,
including preorder (`Preorder: true`). Expires requests older than 120 days or
for products that no longer exist. `?dry=1` reports without sending or writing.

## Product feed

`GET /api/feeds/klaviyo/new-arrivals?limit=8&collection=shop-all`, public JSON,
cached 10 minutes, newest first, buyable products with a photo only.
Add in Klaviyo under Content > Web feeds as `new_arrivals`, then:

```
{% for p in feeds.new_arrivals.products|slice:":4" %}{{ p.title }} {{ p.member_price }}{% endfor %}
```

## Launch order

1. Merge, deploy. Nothing changes until flags are set.
2. Set `KLAVIYO_IDENTITY_SECRET` and `KLAVIYO_SITE_EVENTS_ENABLED=true` on Preview, test with `drew+synctest` addresses, then Production.
3. Run member sync with `?dry=1`, compare counts to Loop, then set the flag and run `?full=1` once.
4. Restock: `?dry=1`, then set the flag.
5. Build flows in Klaviyo on the new metrics. Flows stay in draft until approved.

## Turning it off

Set the flag to anything but `true` and redeploy. Events stop immediately;
nothing is queued. Member properties and notified flags stay as they are.
