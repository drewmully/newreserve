/**
 * Client-safe constants for the Founding 100 gift attachment.
 *
 * Kept in a separate module from foundingHundred.ts (which imports
 * firebase-admin) so client code (shopifyCheckout.ts) can import these
 * without dragging Node-only modules into the browser bundle.
 */

export const FOUNDING_100_DOC_PATH = "system_counters/founding_100";
export const FOUNDING_100_CART_ATTR_KEY = "founding_100_gift";

/**
 * Shopify discount code that zeros out the rangefinder line.
 *
 * Configured in Shopify admin as an Amount off products discount: 100% off
 * the Precision Pro Nexus Rangefinder variant, code-based (not automatic),
 * no minimum, no usage limit per customer. The code is auto-applied via
 * cartCreate when the Founding 100 gift is attached. Buyers never see or
 * type it.
 *
 * If a buyer removes the rangefinder line in checkout, the code applies
 * nothing (no rangefinder line to discount), and the orders-paid webhook
 * declines to claim a Founding 100 slot because the rangefinder is absent.
 *
 * Drew reviews orders for anyone trying to game the system.
 */
export const FOUNDING_100_DISCOUNT_CODE = "FOUNDING100GIFT";
