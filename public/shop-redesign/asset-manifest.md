# Shop-first revision asset provenance

## September 30 shoppable hero hotspots

- Two restrained plus markers and compact labels link the illustration to the existing Quiet Golf Remy Polo and Duckhead Gold School Chino catalog handles. Missing products do not receive a marker.
- Separate normalized coordinates are calibrated for the desktop and mobile hero images. Positions are projected through the actual `object-fit: cover` scale and computed `object-position`, updated on image load and resize. Page scrolling needs no per-frame tracking.
- Visible markers are 22–24px with 44px button targets; no pulsing or autoplay. Native product dialogs support Escape, backdrop dismissal, focus restoration, body scroll locking and mobile bottom-sheet layout.
- The shared modal shows actual catalog/variant photography, current price, available sizes and the existing BOGO15 cart handoff. Sold-out options remain disabled.
- Hero-entry modals identify the image as styling inspiration and warn that actual fit may differ; the illustration is not an exact photographic claim about the chinos' tailoring.
- Verification: 41 targeted tests across 8 files, TypeScript and scoped ESLint. Browser checks cover 320–2560px, portrait/landscape and the 600/601px source breakpoint. Both products are currently reported unavailable by the storefront; purchasable-variant and error paths are covered with test fixtures, not a live purchase.

## September 30 approved fall lifestyle hero

- **Scope:** User-approved AI-created fictional adult model and fictional country-club firepit scene. This is aspirational editorial imagery, not documentary photography, a real-person endorsement, or exact product imagery.
- **Garment reference:** Merchant's Quiet Golf Remy Polo image, https://cdn.shopify.com/s/files/1/0561/0530/4256/files/RemyPoloWine1.jpg?v=1789572975. The user requested the striped polo tucked into tailored/tapered khakis with a no-break hem, a brown braided belt, white golf shoes, and a glass of bourbon beside a firepit. Accessories and trousers are styling concepts, not promises of specific purchasable SKUs.
- **Generation:** GPT Image 2.5 Flare for the initial scene; GPT Image 2.5 Sunburst for the approved tailoring refinement and text removal. Desktop environment extended for wide hero framing; portrait retains the approved seated composition.
- **Files:** `lifestyle/fall-firepit-desktop.webp` and `lifestyle/fall-firepit-mobile.webp`. Compressed WebP derivatives of the approved concept; no baked-in text. Responsive `<picture>` chooses portrait only on small portrait viewports.
- **Live copy:** The existing seasonal heading and `[ shop ]` remain accessible HTML; the CTA still leads to the full edit, not a claim that the exact generated outfit is available. Descriptive alt text identifies AI styling.
- **Preserved:** Existing merchant product photography, inventory, offer logic, sizing, builder viewport rules, Reserve handoff, login, and the `mullyshop` soft-launch gate. The gate is unchanged and remains a client-side preview curtain, not server authentication.

## September 30 palette and full-edit rail

- Replaced the duplicate category navigation below the hero with a 32px decorative palette: cream `#EDE6D6`, camel `#B08558`, olive `#5B613F`, taupe `#9B8B7A`, espresso `#4A3528`. Faint hex labels are decorative and hidden from assistive technology.
- The hero action is now a transparent, text-only `[ shop ]` link with a 44px interaction area and a visible keyboard-focus state.
- The Mully Edit includes every product supplied by the live shop catalog, preserving the existing availability-first merchandising order rather than truncating to four products. All products remain reachable in one native horizontal row, with touch/trackpad scrolling, previous/next buttons, keyboard arrows and Home/End. No autoplay or vertical-scroll hijacking.
- Existing prepared images remain preferred where their catalog-primary guard matches; other pieces retain their merchant-provided imagery. No product images or inventory data were invented to expand the rail.
- Category navigation remains in the main header; Build an outfit now appears in both desktop navigation and the mobile menu. The builder's viewport and checkout behavior are unchanged.

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
