# Shop-first customer pages and Reserve first box

## Scope

Shared espresso/olive retail chrome covers login, collections, product pages, gift edits, the Journal and articles, FAQ, account, returns, and policies. Collection grids no longer inject unrelated stock-photo editorial cards. Cards reuse prepared product imagery where the merchant source still matches; selected variant colors are preserved.

The homepage, subscription landing/reveal pages, onboarding, and plan-selection layouts are unchanged. Admin, partner campaign pages, and the member community/dashboard are outside this public shop/support styling pass. Login handlers, returns actions, policy text, and account-management behavior are preserved.

The header highlights Build an outfit in pale olive. Header links and builder controls have restrained hover feedback with reduced-motion handling. Repeat clicks and cross-page outfit links respect the 96px header. The existing shop password curtain remains unchanged; support/login pages remain public.

## Updated checkout direction, September 30

The owner explicitly rejected the proposed discounts and instructed us to sell the subscription box product with the chosen outfit attached, without worrying about garment inventory counts. No Shopify discounts or inventory settings have been changed.

The outfit builder calls `createMembershipCheckout("member")` directly, not the quiz:

- The only purchased line is Reserve variant `47601025122496`, quantity one, with the configured quarterly selling plan.
- Shopify checkout shows the $250 Reserve subscription product. The individual garments are not separately priced or displayed as separate checkout merchandise lines.
- The three selected names, sizes, quantities and variant IDs are saved as initial cart/order attributes. A readable first-box packing list is also saved in the order note.
- Selections are deliberately not copied onto the recurring subscription line. Its contract therefore does not receive selected garment line properties.
- First-box checkout adds no discount codes, free products, extra merchandise lines, or first-box discount configuration.
- Garment inventory does not block the Reserve box flow. Individual one-time garment purchases still honor availability.
- Before redirecting, verify Shopify returned exactly one Reserve line, the correct plan, quantity one, and a $250 USD merchandise subtotal. The box itself must remain purchasable.
- Existing subscription entry points retain their original payloads and discounts when `firstBoxItems` is absent.

Shopify documents subscription line/plan behavior in [About selling plans](https://shopify.dev/docs/apps/build/purchase-options/subscriptions/selling-plans) and [Model a subscriptions solution](https://shopify.dev/docs/apps/build/purchase-options/subscriptions/model-subscriptions-solution). No completed order or future renewal has been submitted or observed in this change.

## QA

- TypeScript and scoped ESLint passed.
- All 64 targeted tests across 11 files passed again after the checkout simplification.
- Coverage includes actual checkout-function payloads with mocked responses, first-box order attributes and note, no added merchandise/discounts, no recurring garment properties, missing prices/plans, preserved legacy entry behavior, unavailable individual purchases, variants, hero hotspots, provider routes and cart persistence.
- Browser checks cover desktop collections, login, FAQ, Journal/article, returns, shipping policy, PDP and shop, plus mobile login/collections/FAQ.
- Builder viewport checks: 320×568, 390×844, 768×900, 1024×900 and 1440×900. No horizontal overflow; mobile summary CTA stays within the viewport. Reduced motion disables transitions.
- Vercel preview compilation passed on the initial commit. Its shared preview runtime lacks valid Firebase client configuration; functional browser QA uses the local app with existing production configuration.
- A live, unpurchased Shopify cart confirmed one Reserve line at $250 USD with plan `3241476288`, no discount codes, and all eight first-box attributes plus the readable packing-list note returned by Shopify. The browser reached `checkout.mymully.com` directly. Checkout adds any applicable shipping/tax beyond the merchandise subtotal.
- No emails, orders, payments, account edits or returns were submitted. Signed-in account actions and actual renewal-order behavior are not transaction-tested.

## Release and rollback

Owner authorized deployment of PR #226 after checks pass, then amended that approval to exclude all discount configuration and disregard garment counts for the Reserve box path. Keep the shop password curtain; no merchant-configuration changes are part of release.

Revert this PR to roll back the code. There are no Shopify configuration changes to undo.
