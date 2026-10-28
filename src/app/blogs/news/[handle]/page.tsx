/* eslint-disable @next/next/no-img-element */
/**
 * /blogs/news/<handle>: 12 restored Shopify-era posts at their original URLs
 * (SEO recovery s01). Current Journal design, body read from Shopify and
 * cleaned server-side. Not listed on the /blog index.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAllPublishedPosts } from "../../../blog/posts";
import { ShopPageShell } from "../../../shop/components/ShopPageShell";
import { LEGACY_HANDLES, LEGACY_POSTS, getLegacyPost, type LegacyPost } from "@/lib/legacyBlog";
import "./legacy-post.css";

export const revalidate = 86400;
export const dynamicParams = false;

interface Props { params: Promise<{ handle: string }> }

const SITE = "https://www.mymully.com";

export function generateStaticParams() {
  return LEGACY_HANDLES.map((handle) => ({ handle }));
}

async function load(handle: string): Promise<LegacyPost | null> {
  try {
    return await getLegacyPost(handle);
  } catch (err) {
    console.error("[legacy blog] Storefront fetch failed", handle, err);
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const post = await load(handle);
  if (!post) return {};
  const url = `${SITE}/blogs/news/${handle}`;
  const description = post.seoDescription || post.excerpt || undefined;
  return {
    title: `${post.title} | Mully Journal`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: post.title,
      description,
      url,
      type: "article",
      publishedTime: post.publishedAt,
      images: post.image ? [{ url: post.image.url, alt: post.image.altText ?? post.title }] : undefined,
    },
  };
}

function monthYear(iso: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "America/Detroit" }).format(new Date(iso));
}

export default async function LegacyPostPage({ params }: Props) {
  const { handle } = await params;
  if (!LEGACY_POSTS[handle]) notFound();
  const post = await load(handle);
  // Content missing or Shopify unreachable: send readers to the Journal (temporary).
  if (!post) redirect("/blog");
  const next = LEGACY_POSTS[handle];
  const related = (await getAllPublishedPosts()).slice(0, 3);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    datePublished: post.publishedAt,
    image: post.image ? [post.image.url] : undefined,
    mainEntityOfPage: `${SITE}/blogs/news/${handle}`,
    publisher: { "@type": "Organization", name: "Mully", url: SITE },
  };

  return <ShopPageShell>
    <main className="shop-page-main">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <article className="shop-article">
        <nav className="shop-legacy-crumbs" aria-label="Breadcrumb">
          <Link href="/">Mully</Link><span>/</span><Link href="/blog">The Journal</Link><span>/</span><span>From the archive</span>
        </nav>
        <header className="shop-page-heading">
          <div className="shop-journal-meta mb-4"><span>From the archive</span><span>{monthYear(post.publishedAt)}</span><span>{post.readMinutes} min read</span></div>
          <h1>{post.title}</h1>
        </header>
        {post.image && <img className="shop-article-image" src={post.image.url} alt={post.image.altText ?? post.title} width={960} height={640} fetchPriority="high" />}
        <div className="shop-article-copy shop-legacy-copy">
          <div dangerouslySetInnerHTML={{ __html: post.html }} />
          <Link className="shop-legacy-next" href={next.href}>
            <span>Next from Mully</span>
            <strong>{next.headline} →</strong>
          </Link>
          <Link className="shop-text-link text-sm" href="/">← Back to Mully home</Link>
        </div>
      </article>
      {related.length > 0 && <section className="mt-16" aria-labelledby="more-stories">
        <h2 id="more-stories" className="font-serif text-3xl mb-8">More from the Journal</h2>
        <div className="shop-journal-grid">{related.map(item => <Link className="shop-journal-card" href={`/blog/${item.slug}`} key={item.slug}>
          <img src={item.image} alt={item.imageAlt} width={600} height={400} loading="lazy" />
          <div className="shop-journal-meta"><span>{item.category}</span><span>{item.readTime}</span></div>
          <h3>{item.title}</h3>
        </Link>)}</div>
      </section>}
    </main>
  </ShopPageShell>;
}
