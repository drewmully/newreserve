/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { getPostBySlug, getRelatedPosts } from "../posts";
import { ShopPageShell } from "../../shop/components/ShopPageShell";
import { applyAddenda, BLOG_POST_OVERRIDES } from "@/lib/blogAddenda";
import { InlineText } from "../InlineText";
import { GiftSeasonLink } from "../GiftSeasonLink";
import { canonical } from "@/lib/seo";
import { BLOG_COMMERCE, endIntentFor, productHandlesFor, splitRows } from "@/lib/blogCommerce";
import { EndPanel, EndShopLink, ProductRow, ReserveMid, getBlogCommerceProducts } from "../commerce/BlogCommerce";
import { BlogCommerceProvider } from "../commerce/BlogCommerceClient";

export const dynamic = "force-dynamic";
interface Props { params: Promise<{ slug: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getPostBySlug((await params).slug);
  if (!post) return {};
  return { title: `${post.title} | Mully Journal`, description: post.excerpt, alternates: canonical(`/blog/${post.slug}`),
    openGraph: { title: post.title, description: post.excerpt, type: "article", images: [{ url: post.image, alt: post.imageAlt }] } };
}
export default async function BlogPostPage({ params, searchParams }: Props) {
  const { slug } = await params;
  // ?gift_season=1 previews the seasonal gift link outside Nov 15 to Dec 24.
  const forceGiftSeason = (await searchParams)?.gift_season === "1";
  const found = await getPostBySlug(slug);
  if (!found) notFound();
  const post = { ...found, ...BLOG_POST_OVERRIDES[found.slug] };
  const sections = applyAddenda(post.slug, post.sections);
  // Blog commerce: product rows and intent-matched end block (server-rendered).
  const commerce = BLOG_COMMERCE[post.slug];
  const intent = endIntentFor(post.slug, post.category, commerce);
  const [related, products] = await Promise.all([
    getRelatedPosts(slug),
    getBlogCommerceProducts(productHandlesFor(sections, commerce)),
  ]);
  const rows = splitRows(products);
  return <ShopPageShell>
    <BlogCommerceProvider slug={post.slug} template="blog">
    <main className="shop-page-main">
      <article className="shop-article">
        <Link href="/blog" className="shop-text-link text-xs">← The Journal</Link>
        <header className="shop-page-heading">
          <div className="shop-journal-meta mb-4"><span>{post.category}</span><span>{post.date}</span><span>{post.readTime}</span></div>
          <h1>{post.title}</h1><p>{post.excerpt}</p>
        </header>
        <img className="shop-article-image" src={post.image} alt={post.imageAlt} width={960} height={640} fetchPriority="high" />
        <div className="shop-article-copy">
          <p>{post.intro}</p>
          {post.highlights.length > 0 && <aside className="shop-article-highlights" aria-label="Key points">
            <ul>{post.highlights.map(point => <li key={point}>{point}</li>)}</ul>
          </aside>}
          <ProductRow products={rows.top} block="product_row_top" size="compact" />
          {sections.map((section, i) => <Fragment key={section.heading}>
            <section>
              <h2>{section.heading}</h2>
              {section.paragraphs.map(p => <p key={p}><InlineText text={p} /></p>)}
            </section>
            {i === 1 && commerce?.reserveMid && <ReserveMid />}
          </Fragment>)}
          <div className="shop-article-highlights"><p>{post.closing}</p></div>
          <EndPanel intent={intent} />
          {intent === "shop" && rows.bottom.length === 0 && <EndShopLink />}
        </div>
        <ProductRow products={rows.bottom} block="product_row_bottom" size="full" />
        {intent === "shop" && rows.bottom.length > 0 && <EndShopLink />}
        <GiftSeasonLink force={forceGiftSeason} />
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
    </BlogCommerceProvider>
  </ShopPageShell>;
}
