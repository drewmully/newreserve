import Link from "next/link";
import { GIFT_SEASON_LINK, isGiftSeason } from "@/lib/giftSeason";

/** Server-rendered seasonal link to the gift guide (Nov 15 to Dec 24 ET). */
export function GiftSeasonLink({ force = false }: { force?: boolean }) {
  if (!force && !isGiftSeason()) return null;
  return (
    <p className="shop-gift-season-link">
      <Link className="shop-text-link text-sm" href={GIFT_SEASON_LINK.href} data-block="gift_season_link">{GIFT_SEASON_LINK.label}</Link>
    </p>
  );
}
