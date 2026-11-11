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

NEXT_PUBLIC_GIFT_SEASON_ORDER_BY is 2026-12-14 in Production and Preview (matches the gift guide, Mon Dec 14).

## Flow (no reveal, Nov 11 redesign)

Season 1 is physical and ships right away (1-2 business days after purchase). There is no send date, no reveal email, no recipient sizing step before shipping and no "I'll give it myself" path. See `DESIGN.md` for the full design.

1. Step 1: the purchaser picks 1, 2 or 4 seasons.
2. Step 2 ("Who is it for?"): recipient first name, their sizes (the same six fields as `/gift-sizing`: shirt, waist, inseam, shoe, glove, glove hand, plus optional fit notes), an optional note, an optional recipient email, and "Where should the first one ship?":
   - Ship to them (default): the purchaser enters the recipient's address as the Shopify shipping address.
   - Ship to me, I'll give it to them: the shipping address is the purchaser's.
3. Shopify checkout. The return page is `/lp/gift-season/confirmed?t=&mode=&seasons=`, with mode-specific next steps.
4. `orders-paid` creates the season doc and (behind a flag) sends the gifter confirmation.
5. Season 1 ships from the parent order. Seasons 2..N ship to the stored next-season address.

## Reuse of existing gift plumbing

The season gift is a kind of the existing `gift_orders` Firestore doc (doc id = Shopify order id):

- `orders-paid` creates the doc. `fulfillments-create` records shipments. `/admin/gifts` is the ops view. `/gift-card/[token]` is the printable card. `sendPlainText` (Resend) sends the emails.
- `scheduled-send` skips season gifts. `/gift-sizing/[token]` redirects season tokens to `/gift-address/[token]`. The legacy recurring gift is unchanged.

Season gifts never touch Loop.

## Data on the order without write_orders

The production Shopify token has no `write_orders`, so nothing is written to the parent order after checkout.

- Cart LINE attributes (shown to the stylist as line item properties): `Recipient`, `Shirt`, `Waist`, `Inseam`, `Shoe`, `Glove`, `Glove hand`, `Fit notes`, `Ships to`, plus hidden `_gift_token`, `_gift_ship_mode`, `_recipient_email`.
- Cart attributes (note_attributes): `gift=true`, `gift_kind=season`, `gift_seasons`, `gift_ship_mode`, `gift_token`, `gift_recipient_name`, `gift_recipient_email`, `gift_message`, `gift_size_*`.
- `orders-paid` identifies the parent by SKU `RES-GIFT-1S/2S/4S` or variant id, and reads note_attributes first, then line item properties (`readGiftSeasonOrderData`). The parent `tagsAdd` / `orderUpdate` calls are removed.
- Child orders (seasons 2..N) are created with `draftOrderCreate` (`write_draft_orders` only) with tags, line item custom attributes (recipient, sizes, season X of N) and the shipping address set at creation. No email or customer is set, so Shopify sends nothing.

## Next-season addresses

- Ship to them: `orders-paid` copies the parent shipping address into `next_shipping_address` (`address_source=parent_order`).
- Ship to me: `next_shipping_address` stays empty and `/admin/gifts` shows "Address needed". The daily `season-dispatch` cron:
  - 14 days after season 1 is fulfilled, emails the `/gift-address/[token]` link to the recipient (or the purchaser if no recipient email was given).
  - 7 days later with no response, emails the purchaser (`?by=p`).
  - 14 days before season 2 is due, reminds the purchaser.
  - Blocks season 2 dispatch until a valid US address exists (`blocked_address_needed`, logged once as `gift_season_address_blocked`).
- Both modes: the same `/gift-address/[token]` page confirms or updates name, address and sizes before any season. The season notice email (10 days before each season 2..N) includes the link.

## Emails and flags (all default off)

| Flag | Emails |
|---|---|
| `GIFT_SEASON_GIFTER_EMAIL_ENABLED` | Gifter confirmation on `orders-paid` ("Your gift is on its way", ship-to address, season schedule, printable card link for ship to me) |
| `GIFT_SEASON_ADDRESS_EMAILS_ENABLED` | Address request, purchaser fallback, purchaser reminder, season notice |
| `GIFT_SEASON_OFFER_EMAILS_ENABLED` | Continue offer before the last Reserve |

Every send is idempotent (Resend idempotency key plus a `*_sent_at` stamp on the doc).

## Data model (additive only)

**Firestore `gift_orders`**: new optional fields only. Legacy docs are unaffected.

- `gift_kind` ("season"), `seasons_total` (1, 2 or 4)
- `ship_mode` (`to_recipient` | `to_purchaser`), `next_shipping_address`, `address_source`, `address_collected_at`
- `address_request_sent_at`, `address_request_target`, `address_fallback_sent_at`, `address_reminder_sent_at`, `season_notices_sent[]`, `sizing_updated_at`, `gifter_confirmation_sent_at`
- `box_orders[]`: `{box_number, shopify_order_id, shopify_order_name, created_at, due_on, shipped_at, fulfillment_id}`, `box_order_ids[]`
- `boxes_shipped`, `boxes_remaining`, `next_box_due_on`
- `continue_offer_sent_at`, `converted_at`, `converted_order_id`
- Status `season_active`

**Supabase `public.gift_seasons`** (project `xnfjdbpjuaezxjgargto`): reporting mirror; Firestore is the source of truth. RLS on, no policies.

- `migrations/20261111_gift_seasons.sql`: the table.
- `migrations/20261111_gift_seasons_ship_mode.sql`: nullable `ship_mode`, `address_needed`, `address_source`, `address_collected_at`, `address_request_sent_at`, `gifter_confirmation_sent_at`. Applied Nov 11. Nothing existing was altered.

**Shopify**: one DRAFT product, "Reserve Gift Season" (`gid://shopify/Product/10327639392448`), option "Length", the 3 variants above. One-time, requires shipping, unpublished.

## How the prepaid count works

- Season 1 is the paid gift order itself. It ships through the normal queue right away with sizes on the line item.
- Seasons 2..N are $0 orders created by the daily cron `/api/gifts/season-dispatch` (14:30 UTC): `draftOrderCreate` on RES-MEM with a 100% line discount and $0 shipping, then `draftOrderComplete(paymentPending: false)`. Tags `gift-season`, `gift-season-box`, `gift-season-N`, `gift-season-box-X-of-N`, `gift-parent-<id>`. The cron searches by tag first, so retries reuse the order.
- Season X is due `first_box_shipped_at + 3*(X-1) months`, only after the previous one shipped and only with a valid address.
- `fulfillments-create` stamps `shipped_at` and recomputes counts via `seasonProgress()`. Status goes `season_active`, then `completed`.

## How ops sees it

`/admin/gifts` shows "X of N left", ship mode, an "Address needed" badge, the next-season address, address email status, gifter confirmation status and the per-shipment table. In Shopify, filter by tag `gift-season-box` for children; parents show the line item properties.

## Instrumentation

**Server (PostHog):** gift_season_purchased, gift_season_gifter_confirmation_sent, gift_season_address_copied, gift_season_address_requested, gift_season_address_reminder_sent, gift_season_address_collected, gift_season_sizing_updated, gift_season_address_blocked, gift_season_notice_sent, gift_season_box_dispatched, gift_season_box_shipped, gift_season_completed, gift_season_continue_offer_sent, gift_season_converted, gift_season_error.

**Client:** gift_season_view, gift_season_hero_cta_clicked, gift_season_length_selected, gift_season_form_started, gift_season_ship_mode_selected, gift_season_summary_change_clicked, gift_season_form_error, gift_season_checkout_clicked, gift_season_checkout_error, gift_season_confirmation_viewed, gift_season_continue_view, gift_season_continue_clicked.

## CRO review changes (2026-11-11)

> Superseded in part by the no-reveal redesign above: the timing line is now "Order by December 14 for it to arrive by Christmas. Ships in 1-2 business days." (after the cutoff: "Ships in 1-2 business days."), the trust row middle item is "Ships in 1-2 business days", and "I'll give it myself", `gift_self_deliver`, the reveal email and `gift_season_self_deliver_toggled` are removed. The purchase event now carries `gift_ship_mode`.

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
