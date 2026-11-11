import { SITE_URL } from "@/lib/seo";
import { giftGuideFaqs, type GiftPick } from "@/lib/giftGuide";

/** ItemList of product URLs. No prices here: those stay live on the cards and PDPs. */
export function itemListJsonLd(name: string, path: string, picks: GiftPick[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    url: `${SITE_URL}${path}`,
    numberOfItems: picks.length,
    itemListElement: picks.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE_URL}/shop/${p.product.slug}`,
      name: `${p.product.brand} ${p.product.name.replace(new RegExp(`^${p.product.brand}\\s+`), "")}`,
    })),
  };
}

export function faqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: giftGuideFaqs().map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}
