# Image-first outfit selectors

## Changes

- All six outfit products use white-background, proportionally normalized derivatives of actual merchant photography. The vest uses the merchant's existing transparent packshot. Original images and Shopify records are untouched; source/version guards fall back to updated catalog photos.
- Two large photo choices remain visible together. Compact category tabs retain each selected product and size. Selection, enlargement, and size guidance have separate accessible controls.
- Desktop keeps the complete outfit and purchase options beside the choices. Mobile uses a choosing stage followed by a purchase review. No subscription is preselected.
- Consolidated competing outfit styles into `shop-outfit.css`; removed redundant headings, repeated directions, and per-card fit links. Native dialogs retain size charts, close buttons, keyboard dismissal, and full product links.
- One-time BOGO15 estimates, real Shopify variant IDs, availability checks, per-product sizes, and the $250 quarterly Reserve handoff are preserved. Sold-out selections have a clear disabled purchase CTA rather than duplicated warnings.

## QA inventory and results

- Targeted Vitest coverage: product photography version guards, outfit cent rounding and variant selection, size retention/removal, cart persistence, product variant flows, and merchandise visibility.
- TypeScript and touched-source ESLint checks.
- Chromium layout checks: 1440×900, 1568×792, 1366×768, 1280×650, 390×844, 375×667, 320×568, and 768×1024. The section fits under the 96px header. No horizontal page overflow. Short landscape 844×390 intentionally scrolls rather than crushing images and controls.
- At 1440×900 the choice-image area is approximately 423px tall; at 1280×650 it is 189px. Mobile image areas are approximately 349px at 390×844 and 128px at 320×568. The image itself retains its original aspect ratio within this area.
- Exercised all three tabs, both product selections, independent sizes, enlarged-photo dialogs, size-guide charts, purchase-review toggles, removal/restoration, and retained size state. Reserve remains disabled when a piece is removed.
- Existing category tiles and latest-product cards remain visible. No broken images or uncaught page errors in the tested local build.

## Scope and release

Only presentation and photography change. No inventory, discount, price, password, payment, tracking configuration, or Shopify product changes. The existing `mullyshop` soft-launch gate remains unchanged.

The live catalog currently reports these outfit variants unavailable. One-time checkout cannot be completed with unavailable selections; they can still serve as a Reserve style guide. No order or subscription was submitted during QA.

Production merge/deployment requires approval. Do not promote a detached review deployment over newer main-branch work.
