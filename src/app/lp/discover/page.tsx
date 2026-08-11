/**
 * /lp/discover
 *
 * Three-tier acquisition LP for Mully Reserve. Every tier is the FIRST BOX
 * of the same Reserve membership; the subscription cycles at the full
 * quarterly rate on subsequent orders regardless of which tier a member
 * chooses today.
 *
 * Tiers (first-box price only):
 *   1. Discovery         — introductory first box
 *   2. Signature Preview — enhanced first box
 *   3. Reserve Collection — full first box (no code applied)
 *
 * Discount plumbing (see DiscoverLPClient):
 *   - Discovery selects MULLY_DISCOVER   (Shopify code, product-scoped,
 *                                         one-per-customer, first-order only)
 *   - Signature Preview selects MULLY_SIGNATURE (same rules)
 *   - Reserve Collection uses no code
 *
 * Cart-level tagging:
 *   - `discover_tier` cart attribute carries "discovery" | "signature" |
 *     "reserve" into checkout → becomes an order note-attribute →
 *     orders-paid webhook stamps `discover-tier-<tier>` on the FIRST
 *     order only (Loop renewals cannot inherit the cart attribute).
 *
 * Copy constraints (locked, verified in review):
 *   - No em-dashes anywhere.
 *   - The words "cheap", "discount", "deal", "save", and any percent-off
 *     framing must not appear on the page.
 *   - Voice: confident, direct, club-like. Never a coupon.
 */

import type { Metadata } from "next";
import DiscoverLPClient from "./DiscoverLPClient";

export const metadata: Metadata = {
  title: "Mully Reserve — Discover Your First Box",
  description:
    "Three ways in. One membership. Pick the first box that fits how you golf; each renews as the full quarterly Reserve edit.",
  openGraph: {
    title: "Mully Reserve — Discover Your First Box",
    description:
      "Choose your entry into Reserve. Quarterly curation of premium golf apparel, hand-picked by our editors.",
    images: ["/reserve-flatlay-hero.webp"],
  },
};

export default function DiscoverLPPage() {
  return <DiscoverLPClient />;
}
