/**
 * /lp/gift-season/confirmed: Shopify checkout return page for Gift a Season
 * (origin_return_url). Mode-specific next steps from the URL (?mode, ?seasons)
 * and the recipient name the LP stored locally. Reads no order data.
 * Fires the browser Google Ads purchase conversion (same action as
 * /auth/callback), deduped by the checkout transaction id.
 */

import type { Metadata } from "next";
import { parseSeasonCount, parseShipMode } from "@/lib/gifts/giftSeason";
import GiftSeasonConfirmedClient from "./GiftSeasonConfirmedClient";

export const metadata: Metadata = {
  title: "Your gift is on its way | Mully",
  robots: { index: false, follow: false },
};

export default async function GiftSeasonConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; mode?: string; seasons?: string; name?: string }>;
}) {
  const sp = await searchParams;
  return (
    <GiftSeasonConfirmedClient
      shipMode={parseShipMode(sp.mode)}
      seasons={parseSeasonCount(sp.seasons) ?? 1}
      fallbackName={typeof sp.name === "string" ? sp.name.slice(0, 40) : null}
      giftToken={typeof sp.t === "string" && /^[A-Za-z0-9_-]{24,64}$/.test(sp.t) ? sp.t : null}
    />
  );
}
