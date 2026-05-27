# Shopify Custom Pixel: Google Ads `checkout_completed` Fallback

## Why this exists

Our Google Ads conversion is fired in three places, all using the same
`mully_txn_id` as `transaction_id` so Google dedupes server-side:

1. **Shopify Custom Pixel** (this file) — fires `checkout_completed` directly
   from Shopify's pixel sandbox. **Catches Apple Pay / Shop Pay / one-click
   buyers who never bounce back through `/auth/callback`.** Primary signal.
2. **Server-side `orders-paid` webhook** — `/api/webhooks/shopify/orders-paid`
   posts to GA4/Google Ads via measurement protocol. Source of truth.
3. **Client-side `/auth/callback` gtag fire** — for buyers who do return to
   the site after checkout. Redundant; helps populate audiences.

The Custom Pixel runs in an isolated iframe sandbox — `window.gtag` from the
parent site is NOT available. We must load `gtag.js` inline inside the pixel.

## How to install

1. Shopify Admin → Settings → **Customer events**
2. Click **Add custom pixel**
3. Name: `Google Ads — checkout_completed`
4. Permission: Customer Privacy → "Not required" (or "Marketing" if you want
   consent gating)
5. Paste the code below into **Code**
6. Click **Save** → **Connect** to make it live

## Pixel code

```javascript
// Mully Reserve — Google Ads conversion via Shopify Custom Pixel
// Fires once per checkout_completed. Dedupes against /auth/callback and
// the orders-paid webhook via mully_txn_id (set as cart attribute on the LP).

const CONVERSION_ID = "AW-603275854";
const PURCHASE_LABEL = "pU08CO2Jva8cEM6E1Z8C";

// ── 1. Load gtag.js inside the sandbox ──────────────────────────────────
// The Custom Pixel sandbox does NOT inherit window.gtag from the storefront.
window.dataLayer = window.dataLayer || [];
function gtag() { window.dataLayer.push(arguments); }
window.gtag = gtag;

gtag("js", new Date());
gtag("config", CONVERSION_ID, { send_page_view: false });

const s = document.createElement("script");
s.async = true;
s.src = "https://www.googletagmanager.com/gtag/js?id=" + CONVERSION_ID;
document.head.appendChild(s);

// ── 2. Subscribe to checkout_completed ──────────────────────────────────
analytics.subscribe("checkout_completed", (event) => {
  try {
    const checkout = event.data?.checkout;
    if (!checkout) return;

    // Pull mully_txn_id from cart attributes — set on the LP at cart create.
    // Shopify exposes cart attributes on the order via `attributes` in the
    // checkout payload. Fall back to order_id so we still fire if the
    // attribute is missing.
    const attrs = checkout.attributes || [];
    const txnAttr = attrs.find((a) => a && a.key === "mully_txn_id");
    const txnId =
      (txnAttr && txnAttr.value) ||
      checkout.order?.id ||
      checkout.token ||
      ("mully-pixel-" + Date.now());

    const value =
      (checkout.totalPrice && checkout.totalPrice.amount) ||
      (checkout.subtotalPrice && checkout.subtotalPrice.amount) ||
      0;
    const currency =
      (checkout.totalPrice && checkout.totalPrice.currencyCode) ||
      (checkout.currencyCode) ||
      "USD";

    gtag("event", "conversion", {
      send_to: CONVERSION_ID + "/" + PURCHASE_LABEL,
      value: Number(value) || 1.0,
      currency: currency,
      transaction_id: String(txnId),
    });
  } catch (e) {
    // Never throw from a pixel — Shopify will disable it.
    console.warn("[mully-pixel] conversion fire failed:", e);
  }
});
```

## Verifying it works

1. After saving, go through a real (or test-mode) checkout end-to-end.
2. In Google Ads → Tools → Conversions → "Purchase" → look at the recent hits.
   You should see a conversion within ~15 minutes.
3. To check dedupe: do a checkout that bounces through `/auth/callback`.
   You should see **one** conversion in Google Ads, not three — they share
   the same `transaction_id`.

## Why not just trust the server webhook?

The server webhook is reliable but **lacks the client-side gclid → conversion
linkage**. Google Ads attribution works best when the conversion ping comes
from the same browser session that clicked the ad. The pixel + client paths
preserve that linkage; the server webhook is the safety net.
