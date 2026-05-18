/**
 * /lp/gift
 *
 * Ad-targeted PDP landing page for the "Golf Gifting" Google Ads ad group.
 *
 * Phase 1 (this PR): captures gift purchase intent, lets the gifter buy with
 * recipient name + personal message + send-on date as cart attributes. Uses
 * the existing recurring subscription SKU to avoid backend changes — see
 * disclaimer copy: "Quarterly recurring — cancel anytime after first box."
 *
 * Phase 2 (future): redemption email + auto-cancel after first ship. The
 * cart attribute `gift=true` is the marker the orders/paid webhook will
 * use to fork into the gift redemption pipeline once that exists.
 */

import type { Metadata } from "next";
import GiftLPClient from "./GiftLPClient";

export const metadata: Metadata = {
  title: "Mully Reserve Gift — The Golf Gift That Lasts",
  description:
    "The hand-curated golf box every golfer secretly wants. More value inside than what you pay. Better than a gift card.",
  openGraph: {
    title: "Mully Reserve Gift — The Curated Golf Box",
    description:
      "A hand-curated quarterly box of premium golf brands. The gift every golfer wants.",
    images: ["/reserve-founders-hero.jpg"],
  },
};

export default function GiftLPPage() {
  return <GiftLPClient />;
}
