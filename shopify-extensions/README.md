# Mully Checkout Extensions

Shopify Checkout UI Extension that renders reassurance bullets in the cart summary panel on the Shopify Plus checkout (`mullybox-store.myshopify.com` / `checkout.mymully.com`).

## What this ships

`mully-reassurance` — a UI extension targeting `purchase.checkout.cart-line-list.render-after` that displays trust bullets *under the line item summary*. Bullet content is product-aware:

- **Reserve Member (variant 47601025122496)** → shows quarterly-specific reassurance ($300+ retail value, cancel after Q1, free exchanges, ships in 7 days).
- **Reserve Access (variant 47601025482944)** → annual-specific reassurance.
- Other carts → generic reassurance.

## One-time setup (Drew)

You need a Shopify Partner account (free) to ship extensions to a Plus store. If you already have one linked to mullybox-store, skip to step 4.

1. Sign in at [partners.shopify.com](https://partners.shopify.com). Create an account if you don't have one.
2. Apps → "Create app" → "Create app manually". Name: "Mully Internal Extensions". Skip the OAuth URLs for now (extensions don't need them).
3. In the new app → "Distribution" → choose **Custom distribution** → install on mullybox-store.myshopify.com.
4. Install the Shopify CLI on your dev machine (Mac):
   ```sh
   brew install shopify-cli
   ```

## Deploy (one command)

```sh
cd /path/to/newreserve/shopify-extensions/mully-reassurance
shopify app dev    # opens preview link, lets you test in checkout
# when ready:
shopify app deploy
```

`shopify app dev` will ask you to log in (browser pops open) and select the Partner org + app you created in step 2 above. After that selection it remembers everything via `.shopify/`.

`shopify app deploy` creates a new app version. To activate it on the live checkout: Partner dashboard → your app → Extensions → "Release version".

## Edit content

All bullet copy is in `mully-reassurance/extensions/mully-reassurance/src/Checkout.tsx`. Re-deploy after any edit. Releases are versioned in the Partner dashboard so you can roll back instantly.
