/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import Link from "next/link";
import { getLetterPosts } from "../posts";
import { ShopPageShell } from "../../shop/components/ShopPageShell";
import { canonical, SITE_URL } from "@/lib/seo";
import { serializeJsonLd } from "@/lib/safeJsonLd";
import { LETTER_COLLECTION, LETTER_SUBSCRIBE, sentDate } from "@/lib/newsletterCollection";
import "../commerce/blog-commerce.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { absolute: LETTER_COLLECTION.title },
  description: LETTER_COLLECTION.description,
  alternates: canonical(LETTER_COLLECTION.path),
  openGraph: { title: LETTER_COLLECTION.title, description: LETTER_COLLECTION.description, type: "website", url: `${SITE_URL}${LETTER_COLLECTION.path}` },
};

export default async function LettersPage() {
  const issues = await getLetterPosts();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: LETTER_COLLECTION.name,
    description: LETTER_COLLECTION.description,
    url: `${SITE_URL}${LETTER_COLLECTION.path}`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: issues.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE_URL}/blog/${p.slug}`, name: p.title })),
    },
  };
  return (
    <ShopPageShell>
      <main className="shop-page-main">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
        <Link href="/blog" className="shop-text-link text-xs">← The Journal</Link>
        <header className="shop-page-heading mt-4">
          <h1>{LETTER_COLLECTION.name}</h1>
          <p>{LETTER_COLLECTION.intro}</p>
        </header>
        {issues.length > 0 ? (
          <div className="shop-journal-grid">
            {issues.map(post => (
              <Link key={post.slug} href={`/blog/${post.slug}`} className="shop-journal-card">
                <img src={post.image} alt={post.imageAlt} width={600} height={400} loading="lazy" />
                <div className="shop-journal-meta"><span>{sentDate(post.publishedAt) ?? post.date}</span><span>{post.readTime}</span></div>
                <h2>{post.title}</h2>
                <p>{post.excerpt}</p>
                <span className="shop-text-link text-xs mt-2">Read the issue →</span>
              </Link>
            ))}
          </div>
        ) : (
          <p>The first issues are on the way. <Link className="shop-text-link" href="/blog">Read the Journal →</Link></p>
        )}
        <aside className="bc-panel bc-panel--end" aria-label={LETTER_SUBSCRIBE.eyebrow}>
          <p className="bc-eyebrow">{LETTER_SUBSCRIBE.eyebrow}</p>
          <h2 className="bc-panel__title">{LETTER_SUBSCRIBE.heading}</h2>
          <p className="bc-panel__body">{LETTER_SUBSCRIBE.body}</p>
          <Link className="bc-panel__cta" href={LETTER_SUBSCRIBE.href}>{LETTER_SUBSCRIBE.cta} →</Link>
        </aside>
      </main>
    </ShopPageShell>
  );
}
