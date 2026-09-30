/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPostBySlug, getRelatedPosts } from "../posts";
import { ShopPageShell } from "../../shop/components/ShopPageShell";

export const dynamic = "force-dynamic";
interface Props { params: Promise<{ slug: string }> }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getPostBySlug((await params).slug);
  if (!post) return {};
  return { title: `${post.title} | Mully Journal`, description: post.excerpt,
    openGraph: { title: post.title, description: post.excerpt, type: "article", images: [{ url: post.image, alt: post.imageAlt }] } };
}
export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();
  const related = await getRelatedPosts(slug);
  return <ShopPageShell>
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
          {post.sections.map(section => <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.paragraphs.map(p => <p key={p}>{p}</p>)}
          </section>)}
          <div className="shop-article-highlights"><p>{post.closing}</p></div>
          <Link className="shop-text-link text-sm" href="/shop">Explore the Mully Edit →</Link>
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
