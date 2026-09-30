# Mully fall shop: preorder fulfillment handoff

The catalog supports preorders, but automatic fulfillment holds are not installed or active as part of this change. Drew is building the Shopify Flow; activate and test it before allowing these orders into the warehouse's normal fulfillment queue.

## Catalog contract

- **Scope:** Product tag `shop-assortment-fall-2026` identifies the new assortment. `shop-preorder` and `preorder` identify the preorder cohort; these are product tags, not automatically order tags.
- **Inventory:** 27 active styles, 272 variants. Inventory is tracked, available quantity is zero, and the inventory policy is `CONTINUE`. The Bristol draft adds 15 unpublished variants.
- **ETA:** `custom.pre_order_eta_weeks = 2` and `custom.preorder_message = Ships in about 2 weeks`. The updated storefront uses Shopify's variant-level `currentlyNotInStock` flag so the preorder label can disappear when stock is available.
- **Pending:** Randolph Fern is not replaced with Forest. Its status is recorded on the Navy product in `custom.catalog_pending_colors` and tag `catalog-pending-fern`. Bristol remains a draft pending Brown/Pine/Navy photography and supplier specifications.

## One-time purchases

Use the purchased variant's product tags to recognize this preorder assortment. Check inventory for the assigned fulfillment location and hold the whole order when an included preorder item cannot be fulfilled, rather than shipping an incomplete outfit.

Shopify Flow's **Hold fulfillment order** action can hold every fulfillment location when supplied an order, or only the triggering fulfillment order when supplied one fulfillment order ([Shopify action documentation](https://help.shopify.com/en/manual/shopify-flow/reference/actions/hold-fulfillment)). Account for split fulfillment locations in the workflow.

Fulfillment orders may not exist immediately when an order is created; Shopify documents waiting for routing before acting on them ([Shopify fulfillment-order timing](https://help.shopify.com/en/manual/shopify-flow/reference/actions/release-fulfillment-hold)). Do not rely only on “Fulfillment order ready to fulfill” for the initial OOS gate, since Shopify describes that trigger as requiring inventory availability and notes that it runs again after a hold is released ([trigger documentation](https://help.shopify.com/en/manual/shopify-flow/reference/triggers/order-ready-to-fulfill)).

Recommended operational labels are order tag `mully-preorder-hold` and a hold note such as `Mully fall preorder: awaiting stock allocation`. These are proposed Flow outputs; the storefront does not currently add that order tag.

## Reserve first shipment

Reserve buys one subscription product at $250, not three additionally billed apparel lines. The chosen garments are first-shipment packing instructions in cart attributes and the order note.

| Order custom attribute | Meaning |
|---|---|
| `_mully_shop_first_box` = `v2` | First-outfit checkout marker |
| `_first_box_top_variant` | Exact selected top variant GID |
| `_first_box_bottom_variant` | Exact selected bottom variant GID |
| `_first_box_layer_variant` | Exact selected layer variant GID |
| `First box Top`, `First box Bottom`, `First box Layer` | Human-readable product, color, size/inseam, quantity 1 |
| `First box` | `Selected outfit. Future shipments are newly curated.` |

The Flow must inspect these **order-level custom attributes**, not just the subscription product's tags or inventory. A conservative first version is to hold every order with `_mully_shop_first_box = v2` for first-outfit stock review.

These instructions do **not** reserve or decrement the three garment variants. Before release, your team must allocate those units in its fulfillment/inventory process; checking whether each variant merely has a positive quantity is not enough when multiple held orders compete for the same units.

The order-level packing attributes remain the fulfillment authority. The shopper-approved clarity update also adds **display-only line properties**, labeled `First shipment only · Top`, `First shipment only · Bottom`, and `First shipment only · Layer`, so selections are visible in checkout. A `Future shipments` property explains that new styles are curated every three months.

Subscription software may retain these display properties on the recurring contract or renewal orders. Do not use them to pack renewals. Verify the actual provider's renewal behavior before assuming any metadata disappears automatically; no paid order or renewal was placed during this work.

## Release rules and acceptance checks

- **Allocation:** All required units must be received and allocated for this order, including all three Reserve selections and any additional purchased merchandise.
- **Other holds:** Preserve fraud, payment, address, and app holds. Shopify's built-in “Release fulfillment order holds” action releases all holds, so do not use it indiscriminately when other holds remain ([Shopify release action](https://help.shopify.com/en/manual/shopify-flow/reference/actions/release-fulfillment-hold)).
- **Warehouse:** Confirm that the warehouse integration honors Shopify holds before it imports or begins picking a preorder. A product tag or order tag alone is not a fulfillment hold.
- **Test cases:** Test one OOS item, a mixed in-stock/OOS order, a split-location order, a Reserve first outfit, insufficient partial replenishment, two orders competing for one unit, an unrelated fraud hold, and a subscription renewal.

No hold/release automation, fulfillment permission change, or automatic inventory allocation was configured in this task. Shopify supports manual holds and releases while the Flow is being validated ([Shopify fulfillment holds](https://help.shopify.com/en/manual/fulfillment/fulfilling-orders/holding-fulfillments)).
