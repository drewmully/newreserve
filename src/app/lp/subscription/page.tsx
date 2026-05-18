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
  title: "Mully Reserve — The Golf Subscription Box for Discerning Golfers",
  description:
    "Quarterly curations from the brands worth wearing. Hand-picked by editors who play the game. More value inside than what members pay.",
  openGraph: {
    title: "Mully Reserve — Quarterly Golf Box",
    description:
      "Hand-curated boxes of premium golf brands. More value inside than what members pay. Cancel anytime.",
    images: ["/reserve-founders-hero.jpg"],
  },
};

export default function SubscriptionLPPage() {
  return <SubscriptionLPClient />;
}
