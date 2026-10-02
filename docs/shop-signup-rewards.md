# Shop signup rewards

## Behavior

- Email consent issues a random `MULLY-…` code for 10% off the whole eligible one-time merchandise order.
- Optional, separately consented phone signup upgrades the same code to 15%.
- Each code has `usageLimit: 1` and `appliesOncePerCustomer: true`. Repeated signup uses the same entitlement; an SMS upgrade does not reset redemption.
- No shipping, tax, gift-card or subscription discounts. No renewal discount.
- Product, order and shipping combinations are disabled. Submit the signup code and BOGO15 to Shopify together; do not choose a winner using a frontend percentage estimate.
- The popup displays the code immediately and saves it for the current/future bag. It does not send email or SMS and does not activate Klaviyo flows.
- Receipt retries are safe after a partial failure: the same SMS receipt may retry only with the same phone number. A Firestore lease serializes issuance; a reserved code survives a lost Shopify response.

Shopify selects the best eligible discount when discounts cannot combine, per its [discount-combination documentation](https://help.shopify.com/en/manual/discounts/discount-combinations).

## Existing-store audit and release gate

- Store: Mullybox, `mullybox-store.myshopify.com`, checkout at `checkout.mymully.com`, Shopify Plus, USD.
- Native headless change in existing `greensclub/newreserve`; no theme edits, no new Vercel project, no tracking or consent-provider changes.
- Existing BOGO15 code: `gid://shopify/DiscountCodeNode/1466910998720`, active buy-one/get-one at 15% off, non-combinable.
- The equivalent automatic offer is `gid://shopify/DiscountAutomaticNode/1466911031488`, titled “Buy 2, save 15% on one item.” It is also already non-combinable and is unchanged.
- The production **Mully Reserve** app token currently has neither `read_discounts` nor `write_discounts` (checked October 1, 2026). Both are required for automatic issuance and upgrade. The separately connected Shopify administrative integration can manage discounts, but this does not grant the production app access.
- Do not merge/release until the existing app has those scopes, its installed access is updated, and issuance is verified using its actual runtime credentials. Reconnecting the unrelated Shopify connector does not resolve the app permission gap.
- Rollback: revert this PR. Existing issued codes remain single-use Shopify discounts; do not reset or duplicate them.

## QA

- 32 focused API/UI/cart tests passing. Final TypeScript check passes (`tsc --noEmit`, exit 0).
- Desktop 1440px and mobile 390px browser checks passed for popup email, SMS upgrade, code display, dismissal and inline-form handoff. UI signup responses were mocked to avoid writing fabricated consent; live discount arithmetic was tested separately against Shopify.

- API tests: input and consent validation, separate email/SMS evidence, bound receipts, same-phone retry, rate limiting, no false success if Shopify fails.
- Reward tests: 10% creation, same-code 15% upgrade, no downgrade, redeemed-code handling, timeout recovery, concurrency lease, Shopify user errors.
- UI tests: email-only 10%, explicit optional SMS upgrade, code persistence, failure messaging and cart/modal suppression.
- Cart tests: both candidates sent to Shopify, preservation of unrelated codes, actual winning price retained.
- Live Shopify cart checks: one and two Rhone Commuter Polos, comparing BOGO-only, reward-only and both; 10% and 15% give the lower eligible total without stacking. Tested with a temporary, one-use QA code, no customer data, no orders and no payments.
- Live two-item totals on $236 merchandise: existing offer $218.30, email reward $212.40, phone reward $200.60. Supplying both offers retained the reward total, not a compounded discount. The QA code was expired after testing.
- Important accounting correction: order-level discount allocations are not included in line prices. Subtract Shopify's cart-level allocations once when rendering the bag subtotal and savings.
- Inline newsletter capture now uses the same consent/reward API and `shop_marketing_leads` storage as the popup, with source `shop-newsletter`. Historical `editorial_drop_list` records and the editorial endpoint are untouched. The inline form retains an `email_submitted` analytics event without sending the email address and can open the popup directly at optional SMS using its bound receipt.
- Remaining launch checks: actual runtime issuance after scope grant, end-to-end real signup, checkout redemption and attempted second use. No payment was placed during this task.
