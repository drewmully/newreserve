import type { Metadata } from "next";
import Link from "next/link";
import { ShopPageShell } from "../components/ShopPageShell";
import { ScrollToTop } from "../components/ScrollToTop";
import { canonical, SITE_URL } from "@/lib/seo";
import { serializeJsonLd } from "@/lib/safeJsonLd";
import { GIFT_GUIDE_HUB_ORDER, GIFT_SEASON_HREF, loadGiftGuide } from "@/lib/giftGuide";
import { GiftGuideTracker } from "./GiftGuideTracker";
import { faqJsonLd, itemListJsonLd } from "./jsonLd";
import {
  GiftFaqs,
  GiftOrderByNote,
  GiftOutfits,
  GiftSeasonCard,
  GiftSizingNote,
  GiftTierNav,
  GiftTierSection,
} from "./GiftGuide";
import "./gift-guide.css";

export const revalidate = 3600;

const TITLE = "Golf Gifts for Men 2026: Picks by Price | Mully";
const DESCRIPTION =
  "Golf gifts for men, picked by price: merino and down vests, quarter zips, the Duck Head chino, and stocking stuffers under $100. Plus Gift a Season from Mully Reserve.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: canonical("/shop/gifts"),
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${SITE_URL}/shop/gifts`, siteName: "Mully", type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default async function GiftGuideHubPage() {
  const { tiers, outfits } = await loadGiftGuide();
  const ordered = GIFT_GUIDE_HUB_ORDER.map((slug) => tiers.find((t) => t.tier.slug === slug)!).filter(Boolean);
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
          <p className="gg-intro">
            The best golf gift this year is <Link href={GIFT_SEASON_HREF} className="gg-ulink" data-gg-season="hub-intro">Gift a Season</Link>: a
            season of Mully Reserve, hand-picked by a stylist and sized by him. If you would rather wrap something, every piece below is chosen by
            price, with in-stock picks first, from merino vests and down layers to towels, hats and a chino he will live in.
          </p>
          <GiftTierNav active="hub" placement="hub-top" />
        </header>

        <GiftOrderByNote />

        {ordered.map((data, i) => (
          <div key={data.tier.slug}>
            <GiftTierSection
              data={data}
              placement="hub"
              showAllLink
              aside={i === 0 ? <GiftSeasonCard placement="hub-hero-tier" /> : undefined}
            />
            {i === 0 && <GiftOutfits outfits={outfits} placement="hub-outfits" />}
          </div>
        ))}

        <GiftSizingNote />
        <GiftFaqs />
      </main>
    </ShopPageShell>
  );
}
