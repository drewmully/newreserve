# Shop-first revision asset provenance

## September 30 visual consistency correction

- **Hero:** Existing Mully course photograph at `/shop/hero-fall-2026.jpg`, previously used on https://www.mymully.com/shop, returns as a full-width image with one seasonal headline and one shop action. No generated imagery.
- **Product rows:** Four apparel/accessory packshots followed by four gear packshots. Merchant alternate images replace model shots and detail crops where available. Thirteen additional catalog images are normalized to 1000×1250 white canvases using edge-connected background cleanup and proportional, category-aware framing. No products, logos or garment details are generated.
- **Exact source provenance:** `src/lib/shopProductPhotos.json` records each Shopify CDN source URL, the merchant's current primary URL, and the prepared path. If the primary photo changes, the renderer stops using that prepared asset rather than showing a stale color or product.
- **Layout:** Both product rows share one React card component and one four-column desktop/two-column mobile grid. Supporting descriptions, repeated product prices and full-width quick-add strips are removed; accessible 44px options controls retain variant selection.
- **Scope:** Landing-page merchandise imagery is standardized. Product-detail galleries remain the merchant's original catalog; unprepared catalog images elsewhere are not represented as normalized.
- **Retained:** Inter/Playfair font loading, espresso accent, login and existing password gate. The outfit builder retains its existing imagery, viewport sizing, size selection, cart and Reserve handoff.

- **Hero:** Real Rhone alternate product photograph from the merchant Shopify catalog, https://cdn.shopify.com/s/files/1/0561/0530/4256/files/2gray-comquartzip-onmod_1100x_4e34844f-cc4f-40ac-ae7e-6b7a2e62bb05.jpg?v=1789572896. Stored as `hero-rhone.jpg`; only the edge-connected light background was whitened. No generated model or garment.
- **Catalog, categories and gifts:** Existing Shopify product image URLs returned by the storefront catalog. Product names, prices, availability and variants remain catalog-backed.
- **Builder:** Existing prepared white-background product photographs in `products/white/`, unchanged.
- **Journal:** Images and article metadata from existing published blog records. No invented articles or testimonials.
- **Brand:** Existing Mully wordmark and Inter/Playfair typography retained. Espresso `#4A3528` and hover `#34251C` implement the founder's requested accent change.
