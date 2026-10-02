# Shop-first launch, October 2, 2026

## Routes and restoration

- `/` renders the same curated shop as `/shop`, including its membership provider, cart and signup popup.
- The former root acquisition page lives at `/subscription`. Legacy acquisition aliases preserve query parameters and point there.
- `/home` and `/dashboard` redirect to `/`. Their original components remain at `src/app/home/LegacyMemberHome.tsx` and `src/app/dashboard/LegacyDashboard.tsx`. Restore page exports, middleware and prior provider overlay only if intentionally restoring that experience.
- Normal login returns to the shop. Explicit paid onboarding and checkout callbacks retain purchase-completion logic. `/account` remains for subscription management, fit and order details, without the dashboard back link.

## Shopify configuration

Configured in the existing store using its connected Shopify app, not new runtime discount scopes:

- `MULLYEDIT10`: 10%, discount node `1467379843264`.
- `MULLYTEXT15`: 15%, discount node `1467379876032`.
- Both are shared evergreen codes with one redemption per customer, not unique single-use codes. All combination flags are false. They cover one-time merchandise, not subscription purchases or renewals.
- Automatic active-subscriber offer: 15%, node `1467379908800`.
- Shopify segment `552166457536`: `product_subscription_status = 'SUBSCRIBED'`. Both the automatic checkout discount and server-verified price display use this segment. No stale Firestore tier or customer tag grants a discount.
- Popup consent is retained in `shop_marketing_leads` and separate channel consent events. No outbound email/SMS is sent or implied by this change. Codes are shown immediately and saved locally without contact information.
- Shared codes can be passed to another shopper; this is not a unique-code anti-sharing system.

All 310 variants across the 31 active `shop-assortment-fall-2026` products moved from General shipping profile `77050544320` to existing paid-rate profile **Mully One Time Products**, `92446097600`, using Mully Fulfillment location `75406639296`. Existing USPS/UPS carrier rates are unchanged. Legacy subscription and unrelated catalog profiles are untouched. Some catalog weights are zero; warehouse staff should supply measured weights rather than invented values.

## Checkout safeguards

- Bag prices come from Shopify, including cart-level order discount allocations.
- Welcome codes upgrade from 10% to 15% without stacking. Checkout refreshes buyer identity and codes before redirect.
- The old draft-order endpoint is retired with HTTP 410. It must not be restored unchanged: it trusted stale tier eligibility and client-supplied retail totals.
- No orders were placed, payments taken, subscriptions cancelled or customer accounts impersonated for verification.

## Live verification

- All 31 products and 310 variants read back under the paid-rate profile.
- Both signup codes and the automatic subscriber discount read back ACTIVE with no end date.
- Runtime app can query the same active-subscriber segment using its existing customer-read access. The owner's cancelled account returned ineligible.
- A real $268 merchandise test cart returned $250.30 with the normal BOGO offer, $241.20 with email 10%, and $227.80 with phone 15%. With both BOGO15 and the email code supplied, only the better 10% order discount applied.
- Shipping rates remain address-dependent. Do not promise a flat fee or invent missing product weights.
- Browser checkout verification to a test Detroit destination returned paid USPS Ground Advantage ($6.82), UPS Ground ($7.98) and USPS Priority Mail ($9.61), alongside the applied 10% code. No checkout was submitted.

## Rollback

Revert the launch commit to restore routes and UI. Shopify configuration is independent of code rollback: deactivate the three new offers if rolling back their business rules. To reverse only this shipping correction, re-associate the same fall assortment variants with General profile `77050544320`; do not edit rates or move unrelated products. Archived dashboard components are retained in source and covered by their prior tests.
