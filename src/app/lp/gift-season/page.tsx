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
  title: { absolute: "Golf Gift Subscription: Gift a Season of Mully Reserve | Mully" },
  description:
    "A prepaid golf gift subscription: 1, 2 or 4 seasons of hand-picked golf apparel in his sizes, which he can update before each season. Paid once, never renews.",
  openGraph: {
    title: "Golf Gift Subscription: Gift a Season of Mully Reserve",
    description:
      "Hand-picked golf apparel and accessories each season. Paid once, never renews.",
    images: ["/shop/hero-fall-2026.jpg"],
  },
};

export default async function GiftSeasonLPPage({
  searchParams,
}: {
  searchParams: Promise<{ hero?: string }>;
}) {
  const [{ hero }, livePrices] = await Promise.all([searchParams, fetchGiftSeasonLivePrices()]);
  // ?hero=a|b lets Drew compare hero options on the preview. Default A.
  const heroVariant = hero === "b" ? "b" : "a";
  return <GiftSeasonLPClient livePrices={livePrices} heroVariant={heroVariant} />;
}
