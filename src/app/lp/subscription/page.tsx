/**
 * /lp/subscription
 *
 * Ad-targeted PDP landing page for the "Golf Subscription Intent" Google Ads
 * ad group. Bypasses the homepage email-capture step entirely: visitor lands,
 * picks a tier, clicks the buy button, and goes straight to Shopify checkout.
 *
 * No backend changes required. The orders/paid webhook already handles
 * Firebase user creation from the Shopify order email post-purchase. The
 * /auth/callback magic-link bounce-back already exists.
 *
 * Skipped vs. /choose-plan:
 *   - No /api/auth/start-account call (no pre-checkout Firebase user)
 *   - No /home redirect for free tier (we force-paid this funnel)
 *   - No EmailCTA gate (Shopify collects email at checkout)
 *
 * Intentional: free-tier "browse first" path is removed per Drew's spec.
 */

import type { Metadata } from "next";
import SubscriptionLPClient from "./SubscriptionLPClient";

export const metadata: Metadata = {
  title: "Mully Reserve — Your Golf Style, Handled",
  description:
    "Quarterly editorial curation for golfers with taste. Four to six pieces, $300+ retail, hand-picked by editors who play the game.",
  openGraph: {
    title: "Mully Reserve — Quarterly Golf Curation",
    description:
      "A curator who handles your golf wardrobe. Premium brands, hand-picked, four to six pieces every quarter.",
    images: ["/reserve-flatlay-hero.webp"],
  },
};

export default function SubscriptionLPPage() {
  return <SubscriptionLPClient />;
}
