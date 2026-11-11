import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShopPageShell } from "../../components/ShopPageShell";
import { ScrollToTop } from "../../components/ScrollToTop";
import { canonical, SITE_URL } from "@/lib/seo";
import { serializeJsonLd } from "@/lib/safeJsonLd";
import { GIFT_GUIDE_TIERS, getGiftTier, loadGiftGuide } from "@/lib/giftGuide";
import { GiftGuideTracker } from "../GiftGuideTracker";
import { itemListJsonLd } from "../jsonLd";
import {
  GiftFaqs,
  GiftOrderByNote,
  GiftOutfits,
  GiftSeasonCard,
  GiftSizingNote,
  GiftTierNav,
  GiftTierSection,
} from "../GiftGuide";
import "../gift-guide.css";

export const revalidate = 3600;
// Old slugs (under100, hundredToThree, threeHundredPlus) are 308s in next.config.ts.
export const dynamicParams = false;

interface Props {
  params: Promise<{ tier: string }>;
}

export function generateStaticParams() {
  return GIFT_GUIDE_TIERS.map((t) => ({ tier: t.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tier: slug } = await params;
  const tier = getGiftTier(slug);
  if (!tier) return {};
  const path = `/shop/gifts/${tier.slug}`;
  return {
    title: tier.metaTitle,
    description: tier.metaDescription,
    alternates: canonical(path),
    openGraph: { title: tier.metaTitle, description: tier.metaDescription, url: `${SITE_URL}${path}`, siteName: "Mully", type: "website" },
    twitter: { card: "summary_large_image", title: tier.metaTitle, description: tier.metaDescription },
  };
}

export default async function GiftTierPage({ params }: Props) {
  const { tier: slug } = await params;
  const tier = getGiftTier(slug);
  if (!tier) notFound();

  const { tiers, outfits } = await loadGiftGuide();
  const data = tiers.find((t) => t.tier.slug === tier.slug)!;
  const path = `/shop/gifts/${tier.slug}`;
  const chinoTier = outfits.length > 0 && tier.slug === "100-to-150";

  return (
    <ShopPageShell className="gift-guide">
      <ScrollToTop />
      <GiftGuideTracker page={tier.slug} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(itemListJsonLd(tier.heading, path, data.picks)) }} />

      <main className="shop-page-main gg-main">
        <div className="gg-hero gg-hero--tier">
          <Link href="/shop/gifts" className="shop-text-link shop-page-kicker" data-gg-tier-link="hub" data-gg-placement="tier-back">
            ← Gift guide
          </Link>
          <GiftTierNav active={tier.slug} placement="tier-top" />
        </div>

        <GiftOrderByNote />

        <GiftTierSection
          data={data}
          as="h1"
          placement="tier"
          aside={tier.slug === "150-to-250" ? <GiftSeasonCard placement="tier-hero" /> : undefined}
        />

        {chinoTier && <GiftOutfits outfits={outfits} placement="tier-outfits" />}
        {tier.slug !== "150-to-250" && <GiftSeasonCard placement={`tier-${tier.slug}`} compact />}

        <GiftSizingNote />
        <GiftFaqs />
      </main>
    </ShopPageShell>
  );
}
