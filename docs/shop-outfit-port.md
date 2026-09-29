# Shop outfit storefront port

## Scope

Native port of the approved [Mully outfit preview](https://mully-outfit.pplx.app) into `/shop`, rather than an iframe or static simulated store. User confirmed a working storefront and a link into the existing Mully Reserve enrollment.

- Shopify remains the source of products, images, prices, variants and availability.
- Existing category/PDP routes, seasonal header, footer, checkout, attribution and global app scripts remain.
- The `mullyshop` gate is unchanged. It is an existing client-side soft-launch curtain, not server-side access control.
- No Shopify theme, catalog, inventory, discount or selling-plan mutations were made.

## Commerce bindings

| Surface | Binding |
| --- | --- |
| Product cards / quick add | Current collection products, exact Shopify variant selection and availability |
| Outfit | Top, bottom and layer with a distinct size per product, retained when switching options |
| One-time bag | One batch Storefront cart mutation, real cart persistence and checkout URL |
| Bag prices | Shopify cart-line total divided by quantity; original retail retained for savings display |
| BOGO15 | Estimate discounts one lowest-priced item by 15% with two or more items. Code is submitted to Shopify, which controls actual eligibility. An unapplied code is explicitly flagged in the bag. |
| Reserve | Explicit option, never auto-enrollment. Three selected products/variant IDs/sizes are carried through session storage to the canonical root quiz and then as subscription line attributes in the existing checkout. |
| Reserve intent | Valid outfit handoff initially selects the $250 Reserve tier at reveal; the shopper can change tier. |
| Size information | Existing per-brand size guides and live product fit notes |

## Business configuration to resolve before public launch

During September 29, 2026 checks, Shopify's Admin discount lookup for code `BOGO15` returned no matching discount. All six approved outfit products returned unavailable variants through the production Storefront API. These are existing store configuration issues; this implementation does not bypass stock checks or fabricate discounts.

The Reserve handoff is explicitly a curator style guide, not an inventory reservation or guarantee of exact first-shipment SKUs. The full bundle's exact fulfillment at $250 would require additional fulfillment rules beyond linking to Reserve.

## Editability

- Products, pricing, stock, sizes, product photography and fit metafields: Shopify.
- Size charts: `src/lib/sizeCharts.ts`.
- Seasonal hero, accent and palette: `src/app/shop/seasonalTheme.ts`.
- Preferred outfit handles and $250 comparison: `src/lib/shopOutfit.ts`.
- Editorial sections and links: `ShopLanding.tsx`; local lifestyle assets: `public/shop-redesign/`.
- Reserve billing and enrollment remain in the existing Reserve configuration and checkout path.

## QA inventory

- Password: wrong password rejected; `mullyshop` accepted; returning cookie remembered.
- Outfit: desktop sidebar, mobile tabs, choose/swap/remove/restore, independent sizes, default one-time purchase, explicit Reserve option.
- Size chart: opens in a native dialog; Escape closes.
- One-time: missing sizes blocked; unavailable purchase blocked; mocked batch mutation keeps distinct variant IDs; failure cannot create a fake successful bag; one size can be removed without deleting another.
- Reserve: exact names/sizes appear on root quiz; removable handoff; validated checkout line-attribute helper.
- Pricing: cent rounding, no discount on one item, exactly one discounted item with multiple pieces, original cart retail retained.
- Viewports: desktop 1440×900, 1366×768, 1280×650; portrait 390×844, 375×667, 320×568; tablet 768×1024; landscape uses natural scrolling.
- No browser runtime errors observed in the shop-to-Reserve flow.
- TypeScript check and targeted lint passed; 15 targeted unit/UI tests passed.
- No order, payment or subscription was submitted during QA. Successful live checkout of the chosen bundle remains blocked by current stock configuration.

## Rollback

Revert this PR and redeploy the previous Vercel production commit. No data migration or external catalog rollback is needed.
