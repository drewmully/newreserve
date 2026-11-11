import type { Metadata } from "next";
import { renderShopPage, metadata as shopMetadata } from "./shop/page";
import { getReserveQuarterlyPrice } from "@/lib/shopify";
import { SHOPIFY_MEMBERSHIP_PLANS } from "@/lib/membershipConfig";
import { formatHeroPrice } from "@/lib/homeHero";
import ShopLayout from "./shop/layout";
import { SITE_URL, canonical } from "@/lib/seo";
export const revalidate = 3600;

const HOME_TITLE = "Mully | Golf Apparel and Mully Reserve Styling Subscription";

export const metadata: Metadata = {
  ...shopMetadata,
  title: HOME_TITLE,
  alternates: canonical("/"),
  openGraph: { title: HOME_TITLE, description: shopMetadata.description ?? undefined, url: `${SITE_URL}/`, siteName: "Mully", type: "website" },
  twitter: { card: "summary", title: HOME_TITLE, description: shopMetadata.description ?? undefined },
};

// Organization and WebSite structured data (SEO recovery s08, brand signals).
// sameAs lists only the profiles already linked from the site's member home
// footer. Never use "Mully Golf" here; that is a different brand.
const ORGANIZATION_ID = "https://www.mymully.com/#organization";
const WEBSITE_ID = "https://www.mymully.com/#website";

const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": ORGANIZATION_ID,
  name: "Mully",
  alternateName: ["MyMully", "Mullybox", "Mully Reserve"],
  url: SITE_URL,
  logo: `${SITE_URL}/checkout-branding/header-logo.png`,
  sameAs: [
    "https://instagram.com/MullyReserve",
    "https://x.com/MyMully",
    "https://facebook.com/Mullybox",
  ],
};

const WEBSITE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": WEBSITE_ID,
  name: "Mully",
  alternateName: ["MyMully", "Mullybox", "mymully.com"],
  url: "https://www.mymully.com/",
  publisher: { "@id": ORGANIZATION_ID },
};

export default async function Home() {
  const member = SHOPIFY_MEMBERSHIP_PLANS.member;
  const reservePrice = formatHeroPrice(await getReserveQuarterlyPrice(member.merchandiseId, member.sellingPlanGid));
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSON_LD).replace(/</g, "\\u003c") }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBSITE_JSON_LD).replace(/</g, "\\u003c") }} />
    <ShopLayout>{await renderShopPage({ homeHero: { reservePrice } })}</ShopLayout>
  </>;
}
