# Shop-first customer pages and Reserve first box

## Scope

Shared espresso/olive retail chrome now covers login, collections, product pages, gift edits, the Journal and articles, FAQ, account, returns, and policies. Collection grids no longer inject unrelated stock-photo editorial cards. Cards reuse the shop's prepared product imagery where a matching merchant source exists, without replacing selected variant colors.

The homepage, subscription landing/reveal pages, onboarding, and plan-selection layouts are unchanged. Admin, partner campaign pages, and the member community/dashboard are outside this public shop/support styling pass. Login handlers, returns actions, policy text, and account-management behavior are preserved.

The header highlights Build an outfit in a pale olive rectangle. Header links and builder controls have restrained hover feedback and reduced-motion handling. Repeat clicks and cross-page outfit links respect the 96px fixed header. Existing shop password curtain remains unchanged; public support/login pages are not newly password-gated.

## First-box checkout implementation

The outfit builder calls `createMembershipCheckout("member")` directly, not the quiz.

- Recurring line: Reserve variant `47601025122496`, configured quarterly selling plan.
- Three physical merchandise lines: exact selected variant IDs, quantity one, no selling plan.
- Each merchandise line is labeled `Shipment: First box only` and `Outfit piece: Top/Bottom/Layer`.
- Selections are not copied onto the recurring subscription line. A style-guide note is retained as an initial cart/order attribute.
- First-box checkout does not add BOGO15 or acquisition discount codes.
- Before redirecting, the client verifies Shopify returned exactly the four expected lines, the right selling plan, available merchandise, $250 USD for Reserve, $0 for each included piece, and a $250 USD merchandise subtotal.
- Missing discounts, incomplete carts, wrong plans, unavailable products, unexpected quantities/currencies, and partial cart errors block the redirect. There is no silently more expensive checkout.
- Existing subscription entry points retain their existing checkout payloads and discounts when `firstBoxItems` is absent.

Shopify documents mixed one-time/subscription checkout and separate subscription terms in [About selling plans](https://shopify.dev/docs/apps/build/purchase-options/subscriptions/selling-plans) and [Model a subscriptions solution](https://shopify.dev/docs/apps/build/purchase-options/subscriptions/model-subscriptions-solution). The Storefront mutation used here passed Shopify's schema validator.

## Merchant configuration needed before activation

No Shopify discounts, inventory, selling plans, or fulfillment settings were changed in this implementation.

Proposed narrow pricing configuration: three conditional BXGY product discounts, each granting one included one-time piece when the customer purchases the Reserve subscription. Product discounts combine with each other, not with order-level discounts. Each rule is limited to one application per order.

| Rule | Eligible products | Product IDs |
| --- | --- | --- |
| Reserve first box: top | Quiet Golf Remy Polo; Rhone Delta Pique Polo | 8745719365824; 8745718808768 |
| Reserve first box: bottom | Rhone Commuter Pant; Rhone Commuter Short 7" | 8745711534272; 8745710321856 |
| Reserve first box: layer | Rhone Commuter 1/4 Zip; Duckhead Fremont Vest | 8745716580544; 8745717137600 |

All three would require subscription purchase of Reserve product `8501257044160`; the discounted garments are one-time purchases only. Shopify's current schema exposes separate `isSubscription` and `isOneTimePurchase` qualification fields in [DiscountCustomerBuysInput](https://shopify.dev/docs/api/admin-graphql/unstable/input-objects/DiscountCustomerBuysInput). Actual activation still needs merchant approval, API validation, and cart verification. Do not replace conditional pricing with a publicly reusable unconditional 100%-off coupon.

The six selected catalog products currently show zero total inventory, and storefront sizes are unavailable. Do not invent inventory or enable overselling without an approved stocking/preorder decision.

Operational acceptance still required:

- Verify one live, unpurchased cart with available eligible merchandise and approved discounts.
- Verify subscription checkout consent, recurring $250 cadence, shipping and tax.
- Verify fulfillment recognizes the three included pieces as the first shipment, rather than packing an additional default Reserve box.
- Confirm returns/refund handling: included merchandise lines have $0 allocated value, with the paid value on Reserve.
- Do not claim renewal-contract behavior is transaction-tested until an authorized test subscription/order is inspected.

## QA

- TypeScript: passed.
- Scoped ESLint: passed.
- 64 targeted tests across 11 files: passed. Includes first-box cart validation, real checkout-function payload/redirect tests with mocked Shopify responses, unavailable sizes, legacy entry-point preservation, variants, hero hotspots, BOGO15 math, provider routes and cart persistence.
- Browser checks: desktop collections, login, FAQ accordion, Journal, article, returns, shipping policy, PDP and shop; mobile login/collections/FAQ; outfit selection and final summary.
- Builder viewport checks: 320×568, 390×844, 768×900, 1024×900, 1440×900. No horizontal page overflow. Mobile summary CTA remains within the viewport. Reduced motion disables transitions.
- No customer emails, orders, payments, account edits or returns were submitted. Signed-in account actions are not live-tested in this pass.

## Release and rollback

Merge/deploy requires separate approval. Shopify offer activation requires its own approval and verification; current stock blocks live outfit checkout.

Rollback the code with a revert of this PR. Any subsequently activated Shopify discount rules must be disabled separately; a Git revert does not alter merchant configuration.
