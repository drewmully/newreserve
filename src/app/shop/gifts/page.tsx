import type { Metadata } from "next";
import Link from "next/link";
import { ShopPageShell } from "../components/ShopPageShell";
import { ScrollToTop } from "../components/ScrollToTop";
import { canonical, SITE_URL } from "@/lib/seo";
import { serializeJsonLd } from "@/lib/safeJsonLd";
import { GIFT_GUIDE_HUB_ORDER, GIFT_SEASON_HREF, GIFT_SEASON_LIVE, GRID_COLUMNS, capForHub, fitToRows, heroRail, loadGiftGuide } from "@/lib/giftGuide";
import { GiftGuideTracker } from "./GiftGuideTracker";
import { faqJsonLd, itemListJsonLd } from "./jsonLd";
import {
  GiftFaqs,
  GiftGridFill,
  GiftHeroRail,
  GiftHeroStrip,
  GiftOrderByNote,
  GiftOutfits,
  GiftReminders,
  GiftSeasonCard,
  GiftSeasonTile,
  GiftTierNav,
  GiftTierSection,
} from "./GiftGuide";
import "./gift-guide.css";

export const revalidate = 3600;

const TITLE = "Golf Gifts for Men 2026: Picks by Price | Mully";
const DESCRIPTION = `Golf gifts for men, picked by price: merino and down vests, quarter zips, long sleeve polos and stocking stuffers under $100.${
  GIFT_SEASON_LIVE ? " Plus Gift a Season from Mully Reserve." : ""
}`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: canonical("/shop/gifts"),
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${SITE_URL}/shop/gifts`, siteName: "Mully", type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default async function GiftGuideHubPage() {
  const { tiers, outfits } = await loadGiftGuide();
  // Hub: in-stock first, at most 2 Restocking picks per tier. Tier pages show all.
  const ordered = GIFT_GUIDE_HUB_ORDER.map((slug) => tiers.find((t) => t.tier.slug === slug)!)
    .filter(Boolean)
    .map((t) => {
      const fit = fitToRows(capForHub(t.picks));
      return { ...t, picks: fit.picks, fill: fit.fill };
    });
  // Skip whatever already sits in the first grid row (4 across on desktop).
  const firstRow = new Set((ordered[0]?.picks ?? []).slice(0, GRID_COLUMNS).map((p) => p.product.slug));
  const rail = heroRail(tiers, 4, firstRow);
  const allPicks = ordered.flatMap((t) => t.picks);

  return (
    <ShopPageShell className="gift-guide">
      <ScrollToTop />
      <GiftGuideTracker page="hub" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(itemListJsonLd("Golf Gifts for Men 2026", "/shop/gifts", allPicks)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqJsonLd()) }} />

      <main className="shop-page-main gg-main">
        <header className="gg-hero">
          <Link href="/shop" className="shop-text-link shop-page-kicker">← Shop</Link>
          <p className="gg-kicker">The 2026 Mully gift guide</p>
          <h1 className="gg-h1">Golf Gifts for Men, Picked by Price</h1>
          <GiftHeroStrip placement="hub-hero-strip" tier="hub" />
          <GiftHeroRail picks={rail} />
          {GIFT_SEASON_LIVE ? (
            <p className="gg-intro">
              The best golf gift this year is <Link href={GIFT_SEASON_HREF} className="gg-ulink" data-gg-season="hub-intro" data-gg-tier="hub">Gift a Season</Link>,
              a season of Mully Reserve picked by a stylist. Everything else is sorted by price, in-stock first.
            </p>
          ) : (
            <p className="gg-intro">
              Vests, layers and stocking stuffers he will actually wear, sorted by price. In-stock pieces come first.
            </p>
          )}
          <GiftTierNav active="hub" placement="hub-top" />
        </header>

        {ordered.map((data, i) => (
          <div key={data.tier.slug}>
            <GiftTierSection
              data={data}
              placement="hub"
              showAllLink
              aside={i === 0 ? <GiftSeasonCard placement="hub-hero-tier" tier={data.tier.slug} /> : undefined}
              tile={i === 0 ? <GiftSeasonTile placement="hub-grid-tile" tier={data.tier.slug} /> : undefined}
              fill={
                data.fill ? (
                  <GiftGridFill
                    href={`/shop/gifts/${data.tier.slug}`}
                    kicker={data.tier.label}
                    label={`See every ${data.tier.label} gift`}
                    tierLink={data.tier.slug}
                    placement="hub-grid-fill"
                    season={i === 0 ? { placement: "hub-grid-slot", tier: data.tier.slug } : undefined}
                  />
                ) : undefined
              }
            />
            {i === 0 && <GiftOrderByNote />}
            {i === 0 && <GiftOutfits outfits={outfits} placement="hub-outfits" />}
            {i === 0 && <GiftReminders tier="hub" placement="hub-after-hero-tier" />}
          </div>
        ))}

        <GiftFaqs />
      </main>
    </ShopPageShell>
  );
}
