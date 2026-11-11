import type { Metadata } from "next";
import Link from "next/link";
import { getCollectionProducts, type ShopifyProduct } from "@/lib/shopify";
import { buildColorCards } from "@/lib/shopColorCards";
import { canonical, SITE_URL } from "@/lib/seo";
import { serializeJsonLd } from "@/lib/safeJsonLd";
import {
  breadcrumbJsonLd,
  categoryFaqJsonLd,
  categoryItemListJsonLd,
  filterCategoryProducts,
  inStockFirst,
  isCardInStock,
  isProductInStock,
  type CategoryFaq,
  type ShopCategoryPage,
} from "@/lib/shopCategoryPages";
import { ShopPageShell } from "./ShopPageShell";
import { ShopProductCard } from "./ShopProductCard";
import { ScrollToTop } from "./ScrollToTop";
import "./shop-category-landing.css";

/** FAQ answer text with its optional inline link. JSON-LD keeps the same plain text. */
function FaqAnswer({ faq }: { faq: CategoryFaq }) {
  const i = faq.link ? faq.a.indexOf(faq.link.text) : -1;
  if (!faq.link || i < 0) return <>{faq.a}</>;
  return <>{faq.a.slice(0, i)}<Link href={faq.link.href} className="underline underline-offset-4">{faq.link.text}</Link>{faq.a.slice(i + faq.link.text.length)}</>;
}

export function categoryMetadata(page: ShopCategoryPage): Metadata {
  return {
    title: page.title,
    description: page.description,
    alternates: canonical(page.path),
    openGraph: { title: page.title, description: page.description, url: `${SITE_URL}${page.path}`, siteName: "Mully", type: "website" },
    twitter: { card: "summary", title: page.title, description: page.description },
  };
}

/** Live products for a category page, in-stock first. */
export async function loadCategoryProducts(page: ShopCategoryPage): Promise<{ products: ShopifyProduct[]; failed: boolean }> {
  try {
    const all = await getCollectionProducts(page.collection);
    return { products: inStockFirst(filterCategoryProducts(page, all), isProductInStock), failed: false };
  } catch (err) {
    console.error(`[shop category] ${page.slug} catalog unavailable`, err);
    return { products: [], failed: true };
  }
}

export async function ShopCategoryLanding({ page }: { page: ShopCategoryPage }) {
  const { products, failed } = await loadCategoryProducts(page);
  const cards = inStockFirst(buildColorCards(products), isCardInStock);
  const inStockCount = products.filter(isProductInStock).length;
  const faqId = `${page.slug}-faq`;

  return (
    <ShopPageShell>
      <ScrollToTop />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd(page)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(categoryItemListJsonLd(page, products)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(categoryFaqJsonLd(page)) }} />
      <main className="shop-page-main shop-category" data-category={page.slug}>
        <header className="shop-page-heading">
          <nav aria-label="Breadcrumb" className="shop-category__crumbs">
            <Link href="/shop">Shop</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{page.label}</span>
          </nav>
          <h1>{page.h1}</h1>
          <p className="shop-category__intro">{page.lede}</p>
        </header>

        <p className="text-xs text-charcoal/60 mb-6" data-testid="category-count">
          {cards.length} {cards.length === 1 ? "piece" : "pieces"}
          {inStockCount > 0 && inStockCount < products.length ? `, ${inStockCount} ${inStockCount === 1 ? "style" : "styles"} in stock now` : ""}
        </p>
        <div className="shop-catalog-grid">
          {cards.map((card) => <ShopProductCard key={card.displayKey} product={card} accent="#4A3528" />)}
        </div>
        {products.length === 0 && (
          <div className="py-16">
            <p>{failed ? "We couldn’t load this collection. Please try again shortly." : "New pieces are on their way."}</p>
            <Link href="/shop/collection/shop-all" className="shop-text-link mt-4">Explore the shop →</Link>
          </div>
        )}

        <section className="shop-category__about" aria-labelledby={`${page.slug}-about`}>
          <h2 id={`${page.slug}-about`}>{page.aboutHeading}</h2>
          <p>{page.about}</p>
        </section>

        <section className="shop-category__faq" aria-labelledby={faqId}>
          <h2 id={faqId}>Questions</h2>
          <div>
            {page.faqs.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p><FaqAnswer faq={f} /></p>
              </details>
            ))}
          </div>
        </section>

        <nav className="shop-support-links shop-category__related" aria-label="Related">
          {page.related.map((r) => <Link key={r.href} href={r.href} className="shop-text-link">{r.label} →</Link>)}
          <Link href="/policies/refund" className="shop-text-link">Return policy →</Link>
        </nav>
      </main>
    </ShopPageShell>
  );
}
