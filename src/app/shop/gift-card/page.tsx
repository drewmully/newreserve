import type { Metadata } from "next";
import Link from "next/link";
import { ShopPageShell } from "../components/ShopPageShell";
import { ScrollToTop } from "../components/ScrollToTop";
import { canonical, SITE_URL } from "@/lib/seo";
import { serializeJsonLd } from "@/lib/safeJsonLd";
import { getProductByHandle } from "@/lib/shopify";
import { GIFT_CARD_FAQS, GIFT_CARD_HANDLE, GIFT_CARD_PATH } from "@/lib/giftCard";
import { GiftCardClient, type GiftCardOption } from "./GiftCardClient";
import { GiftGuideTracker } from "../gifts/GiftGuideTracker";
import "./gift-card.css";

// Prices are live Shopify variants (Storefront fetch cached 60s).
export const revalidate = 300;

const TITLE = "Mully Gift Card: Golf Gift Card Delivered by Email | Mully";
const DESCRIPTION =
  "The Mully Gift Card, delivered by email. Send it to him or to yourself, add a note, and pick a send date, like Christmas morning. Good for anything in the Mully shop.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: canonical(GIFT_CARD_PATH),
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${SITE_URL}${GIFT_CARD_PATH}`, siteName: "Mully", type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default async function GiftCardPage() {
  let options: GiftCardOption[] = [];
  let productId: string | undefined;
  try {
    const product = await getProductByHandle(GIFT_CARD_HANDLE);
    productId = product?.id;
    options = (product?.variants ?? [])
      .map((v) => ({ id: v.id, title: v.title, price: v.price, available: v.availableForSale }))
      .sort((a, b) => a.price - b.price);
  } catch (err) {
    console.error("[GiftCardPage] Shopify fetch failed:", err);
  }

  const offers = options.filter((o) => o.available);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Mully Gift Card",
    description: DESCRIPTION,
    brand: { "@type": "Brand", name: "Mully" },
    url: `${SITE_URL}${GIFT_CARD_PATH}`,
    ...(offers.length
      ? {
          offers: {
            "@type": "AggregateOffer",
            priceCurrency: "USD",
            lowPrice: offers[0].price.toFixed(2),
            highPrice: offers[offers.length - 1].price.toFixed(2),
            offerCount: offers.length,
            availability: "https://schema.org/InStock",
          },
        }
      : {}),
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: GIFT_CARD_FAQS.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };

  return (
    <ShopPageShell className="gift-card-page">
      <ScrollToTop />
      <GiftGuideTracker page="gift-card" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqLd) }} />
      <main className="shop-page-main gc-main">
        <Link href="/shop/gifts" className="shop-text-link shop-page-kicker" data-gg-tier-link="hub" data-gg-placement="gift-card-back">← Gift guide</Link>
        <GiftCardClient options={options} productId={productId} />

        <section className="gc-faq" aria-labelledby="gc-faq">
          <h2 id="gc-faq" className="gc-h2">Gift card questions</h2>
          <div>
            {GIFT_CARD_FAQS.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>
                  {f.q === "Didn't get it?" ? (
                    <>Check spam, then <Link href="/contact" className="gc-ulink">reach out</Link> and we&apos;ll resend it.</>
                  ) : (
                    f.a
                  )}
                </p>
              </details>
            ))}
          </div>
        </section>
      </main>
    </ShopPageShell>
  );
}
