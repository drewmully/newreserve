/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import Link from "next/link";
import { getAllPublishedPosts, getFeaturedPost } from "./posts";
import { ShopPageShell } from "../shop/components/ShopPageShell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "The Journal | Mully", description: "Good reads for the course and everything around it." };

export default async function BlogPage() {
  const [featuredResult, allPosts] = await Promise.all([getFeaturedPost(), getAllPublishedPosts()]);
  const featured = featuredResult ?? allPosts[0] ?? null;
  const posts = allPosts.filter(p => p.slug !== featured?.slug);
  return (
    <ShopPageShell>
      <main className="shop-page-main">
        <header className="shop-page-heading">
          <h1>The Journal</h1>
          <p>Good reads for the course and everything around it.</p>
        </header>
        {featured && <Link href={`/blog/${featured.slug}`} className="shop-journal-feature">
          <img src={featured.image} alt={featured.imageAlt} width={900} height={600} fetchPriority="high" />
          <div>
            <div className="shop-journal-meta"><span>{featured.category}</span><span>{featured.readTime}</span></div>
            <h2>{featured.title}</h2>
            <p>{featured.excerpt}</p>
            <span className="shop-text-link text-xs mt-4">Read the story →</span>
          </div>
        </Link>}
        <div className="shop-journal-grid">
          {posts.map(post => <Link key={post.slug} href={`/blog/${post.slug}`} className="shop-journal-card">
            <img src={post.image} alt={post.imageAlt} width={600} height={400} loading="lazy" />
            <div className="shop-journal-meta"><span>{post.category}</span><span>{post.date}</span></div>
            <h2>{post.title}</h2>
            <p>{post.excerpt}</p>
            <span className="shop-text-link text-xs mt-2">Read the story →</span>
          </Link>)}
        </div>
        {!featured && <p>New stories are on the way. <Link className="shop-text-link" href="/shop">Explore the edit →</Link></p>}
      </main>
    </ShopPageShell>
  );
}
