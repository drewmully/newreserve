/**
 * /lp/gift-season
 *
 * Gift a Season of Mully Reserve: prepaid 1, 2 or 4 seasons, one checkout,
 * no auto-renewal. See src/lib/gifts/giftSeason.ts for the lifecycle.
 */

import type { Metadata } from "next";
import GiftSeasonLPClient from "./GiftSeasonLPClient";
import { canonical } from "@/lib/seo";
import { fetchGiftSeasonLivePrices } from "@/lib/gifts/giftSeasonPrices";

export const revalidate = 300;

export const metadata: Metadata = {
  alternates: canonical("/lp/gift-season"),
  title: "Gift a Season of Mully Reserve",
  description:
    "Give 1, 2 or 4 seasons of hand-picked golf apparel. They confirm their own sizing. Paid once, never renews.",
  openGraph: {
    title: "Gift a Season of Mully Reserve",
    description:
      "Hand-picked golf apparel and accessories each season. Paid once, never renews.",
    images: ["/reserve-founders-hero.jpg"],
  },
};

export default async function GiftSeasonLPPage() {
  const livePrices = await fetchGiftSeasonLivePrices();
  return <GiftSeasonLPClient livePrices={livePrices} />;
}
