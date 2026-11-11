# pdp_complete_look: vest "Complete the look" A/B test

Owner: Drew Amato. CRO: Mully CRO teammate. PR: #361. Built 2026-11-11.
Status: in review, flag off. Do not read results before the flag is rolled out.

## What it tests

A 50/50 test on the three vest PDPs and the shop slide cart.

| Arm | Vest PDP | Slide cart |
|---|---|---|
| control | Current PDP | Current BOGO15 nudge (`ShopCartBogoNudge`) |
| test | "Complete the look" module under Add to cart | BOGO15 line (`ShopCartBogoLine`) |

Pairings live in one config, `COMPLETE_LOOK_PAIRINGS` in `src/lib/pdpCompleteLook.ts`:

| Vest | Piece 1 | Piece 2 |
|---|---|---|
| Olydoe Merino Ponte Vest | Olydoe Pima LS Polo | Winston Golf Tour Towel |
| Duck Head Fremont Quilted Vest | Rhone Rise 1/4 Zip | Winston Golf Tour Towel |
| Rhone Voyage Down Vest | Olydoe Pima LS Polo | Winston Golf Tour Towel |

The Ponte vest originally paired with the Rhone C.O.R. Crew Sock. The sock is not in Shop — All, so BOGO15 could never apply to it. Per the CRO review, it was swapped for the towel so all three vests get the same offer.

If a piece is out of stock in the chosen size, it falls back to the next in-stock piece from the gift guide lists (`100-to-150`, then `under-100`). Prices, stock and images are live from Shopify; nothing is hard-coded.

### Copy rules

- The PDP line "Add a second piece, save 15%." shows only when the vest and both shown pieces are in Shop — All (tag `shop`).
- In the cart, with 1 eligible unit: "Add one more piece and save 15% on it" plus 2 eligible suggestions.
- In the cart, with 2+ eligible units: "Second piece 15% off applied" plus the saved amount. The amount comes from the cart's BOGO15 line-level discount allocations, and the line never shows without allocated money.
- Members, shop rewards and other discount codes suppress the BOGO copy, because BOGO15 combines only with shipping discounts. The auto-applied first-order shipping code (FIRSTORDERSHIP, $100+) does not suppress it, in either arm (`hasBogoBlockingCode`).

## Flag

PostHog flag `pdp_complete_look` (id 1064634), variants `control` 50 / `test` 50. It ships **inactive, at 0% rollout**, and Drew approves the rollout.

- **Assignment:** evaluated server-side (`POST /api/experiments/pdp-complete-look`) on the Mully `anonymous_id`. Exposure is `$feature_flag_called`.
- **When it's evaluated:** on the first shop PDP or slide-cart view. The arm is then sticky in localStorage (`mully_pdp_complete_look`) and registered as `$feature/pdp_complete_look` on every event.
- **QA override:** `?pdp_complete_look=test|control|off`. It works on preview/dev. In production it works only when the matched variant's payload is `{"allow_overrides": true}`. Overrides send no exposure.
- **Purchase attribution:** the cart attributes `pdp_complete_look=<arm>` and `ab_variant=pdp_complete_look:<arm>` (set only when empty). orders-paid maps the arm to `$feature/pdp_complete_look` on `purchase`.

## Events

All events carry `$feature/pdp_complete_look`.

| Event | Properties |
|---|---|
| `complete_look_view` | `pdp_handle`, `items` (comma-joined handles), `item_count` |
| `complete_look_add` | `pdp_handle`, `item_handle`, `price`, `position`, `size` |
| `cart_bogo_line_view` | `state` (`one_item` or `applied`), `cart_value`, `items` |
| `cart_bogo_suggestion_add` | `item_handle`, `price`, `size`, `position` |
| `bogo_nudge_viewed` (control) | `picks` (comma-joined), `anchor`, `rotation`. Fires only when the nudge renders. |

## Analysis plan

- **Population: vest-PDP sessions only.** Exposure also fires when the cart opens from any other shop PDP (it's evaluated on the first shop PDP or cart view). Including those sessions dilutes the effect, so restrict both arms to sessions with a pageview on one of the three vest handles:
  - `olydoe-merino-ponte-vest`
  - `duckhead-fremont-sport-performance-quilted-vest-brandy-brown`
  - `rhone-voyage-down-vest`
- **Keying sessions:** `proshop_product_viewed` can fire before the arm resolves, so it may lack `$feature/pdp_complete_look`. Key vest-PDP sessions on the vest URL plus the person's arm from exposure (`$feature_flag_called`) or from `complete_look_view`. Don't key them on the property on `proshop_product_viewed`.
- **Primary metric:** revenue per vest-PDP session (`purchase` with `$feature/pdp_complete_look`).
- **Secondary metrics:** AOV, units per order, BOGO15 orders, `complete_look_add` rate, and cart `applied` rate.
- **Pause rule:** pause if vest-PDP `add_to_cart` drops more than 15% in test versus control.
- **Stock:** inventory is thin (about 3 to 5 units per vest; the Rise QZ has about 4). An out-of-stock pairing piece falls back, but an out-of-stock vest ends exposure on that PDP, so watch for sellouts.

## page_view measurement break

PR #361 also fixes `page_view` firing twice per page load: `PageViewTracker` and `AnalyticsTracker` both captured it, and `PageViewTracker` was removed. That fix is its own commit. **From the merge date, sitewide `page_view` counts drop about 50%.** Don't read before/after page_view, pages per session or PDP-session counts as a traffic drop. Record the merge date here and in the CRO log:

- page_view fix merged: _(date to be filled at merge)_

## BOGO15 and margin facts (read-only checks, 2026-11-11)

- **Discount:** "Mully BOGO15: 15% off one piece", automatic Buy X Get Y (`gid://shopify/DiscountAutomaticNode/1466911031488`). Buy and get are both Shop — All, with 1 use per order. It combines only with shipping discounts.
- **Shop — All membership:** all three vests, the Pima LS Polo, Rise 1/4 Zip and Tour Towel are in it. The C.O.R. Crew Sock is not.
- **Where the discount lands:** Storefront carts show it as a line-level allocation on the cheaper piece. Order-level `discountAllocations` and `discountCodes` are empty. Examples: vest + Polo −$17.25, vest + Rise −$16.20, vest + Towel −$2.99.
- **Margin:** `inventoryItem.unitCost` is empty for the three vests, the polo, the Rise and the towel. Costs must be entered before the winner scales past these vests, so margin after 15% off can be checked.
