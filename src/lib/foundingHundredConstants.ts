/**
 * Client-safe constants for the Founding 100 gift attachment.
 *
 * Kept in a separate module from foundingHundred.ts (which imports
 * firebase-admin) so client code (shopifyCheckout.ts) can import these
 * without dragging Node-only modules into the browser bundle.
 */

export const FOUNDING_100_DOC_PATH = "system_counters/founding_100";
export const FOUNDING_100_CART_ATTR_KEY = "founding_100_gift";
