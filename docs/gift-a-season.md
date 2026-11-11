# Gift a Season: design

Status: built on branch `feat/gift-a-season`, [PR #352](https://github.com/drewmully/newreserve/pull/352) (draft). Owner: Drew Amato. Target: live before about Nov 20, 2026.

## What it is

Prepaid Reserve gifts that never auto-renew:

| Length | Reserves | Price (Drew, Nov 11) | Per season | SKU | Variant id |
|---|---|---|---|---|---|
| 1 season | 1 | $299 | $299 | RES-GIFT-1S | 50765708820672 |
| 2 seasons | 2 | $550 | $275 | RES-GIFT-2S | 50765708853440 |
| 4 seasons | 4 | $1,000 | $250 | RES-GIFT-4S | 50765708886208 |

Pricing note: the original brief assumed $250/season with no discount ($250 / $500 / $1,000). Drew replaced that on Nov 11 with $299 / $550 / $1,000. The regular Reserve Member price used in the continue offer stays $250 a season.

## Reuse of existing gift plumbing

The season gift is a new kind of the existing `gift_orders` Firestore doc (doc id = Shopify order id). It runs on the same flow as the legacy recurring gift:

- The LP cart attributes (`gift=true`, `gift_recipient_*`, `gift_deliver_on`, `gift_message`) are the same ones `/lp/gift` uses.
- `orders-paid` creates the doc.
- `scheduled-send` sends the recipient reveal on the send date.
- `/gift-sizing/[token]` collects sizing.
- `fulfillments-create` records shipments.
- `/admin/gifts` is the ops view.

Season gifts are told apart by `gift_kind: "season"` and the line-item variant or SKU.

Season gifts never touch Loop. The legacy post-first-shipment cron cancels the purchaser's Loop subscription. It never sees season gifts, because they move to `season_active` rather than `first_box_shipped`.

## Data model (additive only)

**Firestore `gift_orders`**: new optional fields only. Legacy docs are unaffected.

- `gift_kind` ("season")
- `seasons_total` (1, 2 or 4)
- `box_orders[]`: `{box_number, shopify_order_id, shopify_order_name, created_at, due_on, shipped_at, fulfillment_id}`
- `box_order_ids[]`, used for array-contains lookup
- `boxes_shipped`, `boxes_remaining`, `next_box_due_on`
- `continue_offer_sent_at`, `converted_at`, `converted_order_id`
- New status value `season_active`

**Supabase `public.gift_seasons`**: a new table, applied to production project `xnfjdbpjuaezxjgargto`. A branch wasn't practical: the existing branch is MIGRATIONS_FAILED and the preview isn't wired to Supabase.

- It is a reporting mirror upserted by the app; Firestore remains the source of truth.
- RLS is enabled with no policies, so only the service role can access it.
- Migration file: `migrations/20261111_gift_seasons.sql`. Nothing existing was altered.

**Shopify**: one new DRAFT product, "Reserve Gift Season" (`gid://shopify/Product/10327639392448`, handle `reserve-gift-season`), with option "Length" and the 3 variants above. Each variant is one-time (no selling plan), requires shipping, is taxable and has untracked inventory. The product is unpublished.

## How the prepaid count works

**Box 1 is the paid gift order itself.**

- `orders-paid` sees a RES-GIFT variant and creates the season doc with `box_orders=[box 1]` and `boxes_remaining=N`.
- It tags the order `gift-season`, `gift-season-N` and `gift-season-box-1-of-N`.
- The order ships through the normal queue once sizing is in. `submit-sizing` prepends `GIFT SIZING: ...` to the order note for the stylist.

**Boxes 2..N are $0 Shopify orders.** The daily cron `/api/gifts/season-dispatch` (14:30 UTC, `vercel.json`) creates them.

- How the order is built: `draftOrderCreate` on the Reserve Member variant (RES-MEM) with a 100% line discount and $0 shipping, to the parent order's shipping address, followed by `draftOrderComplete(paymentPending: false)`. The draft has no email or customer, so Shopify sends the recipient no order confirmation or shipping notification. Our season-dispatch email is the only message they get for boxes 2..N.
- Tags: `gift-season`, `gift-season-box`, `gift-season-N`, `gift-season-box-X-of-N` and `gift-parent-<id>`.
- Attributes: `gift_season_child=true`, plus the parent id and the box number.
- Note: recipient, box X of N, and sizing.
- Idempotency: before creating, the cron searches Shopify orders by tag, so a retry reuses the existing order.
- When it fires: box N is due on `first_box_shipped_at + 3*(N-1) months`, and only once the previous box has shipped. Two open boxes are never stacked.
- `orders-paid` returns early for child orders: they are persisted to Supabase only, with no analytics, tier changes or emails.

**Decrement.** `fulfillments-create` finds the season doc by `box_order_ids`.

- It stamps that box's `shipped_at` and recomputes `boxes_shipped` and `boxes_remaining`.
- Status moves to `season_active`, then `completed` when remaining reaches 0.
- Remaining is always `seasons_total - boxes_shipped`, derived by the pure `seasonProgress()`.

**Continue offer.** It is sent once, before the final Reserve arrives:

- For 2 or 4 seasons: when the final box order is created.
- For 1 season: when it ships.

It links to `/gift-continue/<token>`, which starts a regular Reserve Member checkout ($250 a season). The email only sends when `GIFT_SEASON_OFFER_EMAILS_ENABLED=true`. A later membership purchase by the recipient email stamps `converted_at`.

## How ops sees it

On `/admin/gifts`, each season gift shows:

- "X of N left"
- shipped and ordered counts
- the next box number and due date

Its details row has a per-shipment table (Shopify order, due, ordered, shipped) plus continue-offer and conversion status. There is a new "Season active" filter. In Shopify, filter orders by tag `gift-season-box`.

## Instrumentation

**Server (PostHog):**

- gift_season_purchased
- gift_season_recipient_notified
- gift_season_sizing_submitted
- gift_season_box_dispatched
- gift_season_box_shipped
- gift_season_completed
- gift_season_continue_offer_sent
- gift_season_converted
- gift_season_error

**Client:**

- gift_season_view
- gift_season_length_selected
- gift_season_form_started
- gift_season_self_deliver_toggled
- gift_season_form_error
- gift_season_checkout_clicked
- gift_season_checkout_error
- gift_season_continue_view
- gift_season_continue_clicked

Orders are tagged as listed above. The Supabase `gift_seasons` table supports SQL reporting.

## CRO review changes (2026-11-11)

- **Launch config** (`src/lib/gifts/giftSeasonConfig.ts`). These values are pending Drew and render as visible placeholders until they're set:
  - `NEXT_PUBLIC_GIFT_SEASON_ORDER_BY`: the holiday order-by cutoff as an ISO date. Set to `2026-12-15` in Preview and Production. The cutoff ends at midnight US Eastern after that day. Default `[cutoff date TBD]`.
  - `NEXT_PUBLIC_GIFT_SEASON_SHIP_WINDOW`: when the first Reserve ships after sizing. Set to `1-2 business days` in Preview and Production. Default `[ship window TBD]`.
  - `NEXT_PUBLIC_GIFT_SEASON_FREE_SHIP_EXCHANGES=true`: turns on the "free shipping and free exchanges" claim on the LP, the sizing page and the season email. It is off by default.
- **Timing line** under the picker and in Step 3, evaluated at view time against the cutoff:
  - Before: "Order by December 15 for their first Reserve to arrive by Christmas." (15th: 1-2 business days to ship, about 3-5 days ground, plus a buffer for recipient sizing.)
  - After: "Their gift reveal still arrives on time by email. Their first Reserve ships 1-2 business days after they confirm sizing." With "I'll give it myself" on, the first sentence is "Your printable gift card still arrives on time by email."
- Free shipping and exchanges stay off. The top bar on this page reads "Easy Returns".
- **Mobile layout**: the eyebrow, H1 and subhead now sit above a 16/10 image. The lg layout is unchanged.
- **Retail value**: "$300+ retail value" is replaced with "Hand-picked by a Mully stylist each season" on the LP, the season reveal and the season email.
  - The only itemized record of actual contents is the June 2026 Reserve plan (31 orders). It averages $262.89 MSRP per Reserve, and no Reserve in it reached $300.
  - Shopify and ShipHero only record the RES-MEM line, not the contents.
- **"In a typical Reserve" row**: four real pieces from that plan, labeled by category (polo, outer layer, accessory) and marked as examples, with no item counts.
- **FAQ**: five collapsed items placed after "How it works".
- **Picker cards**: each card shows its per-season price, and the 2- and 4-season cards show "Save $X" against the 1-season price. Both are derived from variant prices (`seasonSavings`).
  - The 4-season badge reads "Full year, best value".
  - A microline under the CTA reads "Paid once. Never renews. Secure Shopify checkout."
- **"I'll give it myself"**:
  - Cart attribute `gift_self_deliver=true`. The recipient email becomes optional.
  - orders-paid stores `self_deliver`.
  - scheduled-send emails the gifter the printable card (`/gift-card/[token]`) plus the sizing link.
  - The sizing page asks for the recipient's email when none is on file, so the continue offer can reach them. If there is still no email, the continue offer is skipped (`offer_skipped_no_email`).
- **Events**:
  - New: `gift_season_form_started` (first field focus) and `gift_season_self_deliver_toggled`.
  - `lp_source` added on `gift_season_form_error` and `gift_season_checkout_error`.
  - `gift_season_purchased` carries `seasons`, `value` and `currency`. The main `purchase` event now carries `gift_kind`, `seasons` and `gift_self_deliver`.

## Hero options (?hero=a|b)

The page header is the standard shop header and top bar (`ShopSeasonalHeader`). The hero has an eyebrow, the H1, one line, a "Choose a gift length" CTA on mobile and the picker on desktop, with the trust row ("Paid once. Never renews." · "They pick their own sizes" · "Secure Shopify checkout.") right under the CTA. On desktop the image fills the left half at the same height as the picker column. The recipient form is now step 2 below the picker (`#gift-details`). The type scale matches the homepage: Playfair 400 at 30px on mobile and up to 52px on desktop, -0.025em tracking, #111 ink and an olive eyebrow.

- **A (default): product flat lay.** These are live Shopify product packshots arranged on a bone ground. White backgrounds drop out with `mix-blend-multiply`, and nothing is generated.
  - Rhone Rise 1/4 Zip: `mully-fall-2026-24.jpg`
  - Quiet Golf Remy Polo: `mully-fall-2026-16.jpg`
  - Greyson Gothic G Dad Hat: `MG23A25_100_1_4858.webp`
  - Will Leather Saddle Belt: a prepared white copy of `60078_SADDLE_BELT_TAN_001`
- **B: course photo.** This uses `/shop/hero-fall-2026.jpg`, the real Mully course photograph documented in `public/shop-redesign/asset-manifest.md`.
  - It has no single product focal point.
  - The homepage hero (`fall-fairway-*`) and `fall-firepit-*` are AI-generated per that manifest, so they're not used.
  - The `/lp/discover` box images have unconfirmed provenance (PR #116 calls one a "render"), so they're excluded until someone confirms they're real photos.
- No member quote yet. There's no reviews system in the repo. Quoting Intercom conversations would need the member's permission.
- Event: `gift_season_hero_cta_clicked` {hero, target: picker|details, seasons, lp_source}. `gift_season_view` includes `hero`.

- **CRO round 2 (A picked, default):**
  - The flat lay now uses cutouts of the same Shopify packshots (`public/lp/gift-season/flatlay/`, sources in SOURCES.md). Their baked-in shadows were removed, so all four share one CSS drop shadow.
  - New caption: "Pieces from past Reserves. Every Reserve is styled to them."
  - The "In a typical Reserve" section is removed.
  - The picker is labeled "Step 1 of 2 · Choose a gift length".
  - On desktop, step 2 has an order summary column with the length, the price and a Change link (event `gift_season_summary_change_clicked`).
  - The top bar reads "Easy Returns" on this page through the new optional `returnsLabel` prop. No sitewide change was found, so the default copy elsewhere is unchanged.
  - Unboxing-7.jpg (real photo, approved by Drew) is the "gift moment" band below step 2, not in the hero, so the fold keeps one focal point. Its CTA fires gift_season_hero_cta_clicked with target "moment".

## Copy rules

There are no em dashes or double dashes. Customer copy uses "Mully" and "Reserve", never "box" or "Mullybox". Vitest enforces this on the season emails and season UI files.
