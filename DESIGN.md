# Gift a Season: design

Branch `feat/gift-a-season`, [PR #352](https://github.com/drewmully/newreserve/pull/352) (draft). Owner: Drew Amato. Detailed implementation notes: `docs/gift-a-season.md`.

## Model

A prepaid Reserve gift of 1, 2 or 4 seasons ($299 / $550 / $1,000) that never renews. There is no reveal. Season 1 is a physical Reserve that ships right away (1-2 business days after purchase), and the next seasons ship every 3 months.

## Purchase flow (`/lp/gift-season`)

1. Step 1: choose a length.
2. Step 2, "Who is it for?":
   - Recipient first name (required).
   - Their sizes, using the same fields as `/gift-sizing` (shirt, waist, inseam, shoe, glove, glove hand, optional fit notes), with "Not sure? Pick their usual size." All six sizes are required, as on `/gift-sizing`. No free exchange promise; Easy Returns is the only claim.
   - An optional note.
   - Recipient email (optional), used only for address and size updates later.
   - "Where should the first one ship?": Ship to them (default) or Ship to me, I'll give it to them.
3. Shopify checkout. The purchaser enters the shipping address (theirs or the recipient's) there.
4. `/lp/gift-season/confirmed`: next steps for the chosen mode.

Timing copy is driven by `NEXT_PUBLIC_GIFT_SEASON_ORDER_BY` and `NEXT_PUBLIC_GIFT_SEASON_SHIP_WINDOW`: "Order by December 14 for it to arrive by Christmas. Ships in 1-2 business days." until the cutoff (ET midnight), then "Ships in 1-2 business days."

## Order data without write_orders

The production Shopify token lacks `write_orders`, so all gift data rides in at checkout and nothing is written to the paid order afterwards.

- The cart line carries visible properties for the stylist (`Recipient`, sizes, `Fit notes`, `Ships to`) and hidden ones (`_gift_token`, `_gift_ship_mode`, `_recipient_email`).
- Cart attributes mirror everything as note_attributes (`gift_kind=season`, `gift_seasons`, `gift_ship_mode`, `gift_token`, `gift_recipient_*`, `gift_size_*`).
- The gift token is generated in the browser so the confirmation page can link to `/gift-address/[token]`. The server validates its shape and replaces it on collision.
- `orders-paid` identifies parents by SKU (RES-GIFT-1S/2S/4S) or variant id. No tagging.
- Seasons 2..N are $0 draft orders (`write_draft_orders`) with tags, line item sizes and the shipping address set at creation, and no email, so Shopify sends nothing.

## Next-season address

| Mode | Season 2..N address |
|---|---|
| Ship to them | Copied from the parent order's shipping address at purchase |
| Ship to me | Collected on `/gift-address/[token]` after season 1 arrives |

Ship to me timeline, run by the daily `season-dispatch` cron:

- Season 1 fulfilled + 14 days: email the address link to the recipient (purchaser if no recipient email). Waiting 14 days avoids spoiling the gift.
- +7 days with no response: email the purchaser.
- 14 days before season 2 is due: remind the purchaser if still missing.
- Season 2 is not created until a valid US address exists. `/admin/gifts` shows "Address needed".

In both modes the same link lets the recipient update sizes and address before each season. The season notice email, 10 days before each season 2..N, includes it.

## Emails (all gated, default off)

- `GIFT_SEASON_GIFTER_EMAIL_ENABLED`: gifter confirmation from `orders-paid`. "Your gift is on its way", the season 1 ship-to address, the season schedule, and for ship to me "After they open it, we'll email them to collect their address for the next seasons." plus an optional printable card link.
- `GIFT_SEASON_ADDRESS_EMAILS_ENABLED`: address request, fallback, reminder and season notice.
- `GIFT_SEASON_OFFER_EMAILS_ENABLED`: continue offer before the last Reserve.

All go through the existing Resend `sendPlainText` path with idempotency keys.

## Copy rules

No em dashes or double dashes. Say "Mully" and "Reserve", never "box" or "Mullybox". Keep it short. Real imagery only.

## Go-live checklist

- Remove the `write_orders` requirement (done in code; nothing needs it now).
- ShipHero: kit RES-GIFT-1S/2S/4S to RES-MEM so season 1 picks.
- Klaviyo: exclude "Reserve Gift Season" in flow YkuGwj alongside RES-MEM.
- Publish the DRAFT product to Online Store and the headless channel, then turn on the email flags.
