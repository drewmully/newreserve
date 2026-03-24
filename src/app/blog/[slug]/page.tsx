import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BLOG_POSTS,
  CATEGORY_COLORS,
  getBlogPostBySlug,
} from "../posts";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPostBySlug(slug);

  if (!post) {
    return {};
  }

  return {
    title: `${post.title} | Mully Reserve Journal`,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: "article",
      images: [{ url: post.image, alt: post.imageAlt }],
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getBlogPostBySlug(slug);

  if (!post) {
    notFound();
  }

  const relatedPosts = BLOG_POSTS.filter((item) => item.slug !== post.slug).slice(
    0,
    3,
  );

  return (
    <div className="min-h-screen bg-bone">
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/15">
        <div className="max-w-7xl mx-auto px-5 md:px-12 flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2 text-forest">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-4 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-xl font-bold tracking-wide">mully.</span>
          </Link>
          <Link href="/blog" className="text-sm tracking-wider uppercase text-forest font-medium hover:text-forest-dark transition-colors duration-300">
            Journal
          </Link>
        </div>
      </header>

      <main className="pt-24 pb-20 px-5 md:px-12">
        <article className="max-w-4xl mx-auto">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-charcoal/45 hover:text-forest transition-colors duration-300 mb-5"
          >
            <span aria-hidden="true">&larr;</span>
            Back to Blog
          </Link>

          <div className="mb-6">
            <div className="flex flex-wrap items-center gap-2.5 mb-3">
              <span className={`text-[10px] tracking-[0.15em] uppercase font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[post.category]}`}>
                {post.category}
              </span>
              <span className="text-[11px] text-charcoal/30">{post.date}</span>
              <span className="text-[11px] text-charcoal/30">&middot;</span>
              <span className="text-[11px] text-charcoal/30">{post.readTime}</span>
            </div>

            <h1 className="font-serif text-3xl md:text-5xl text-obsidian leading-tight mb-4">
              {post.title}
            </h1>

            <p className="text-sm md:text-base text-charcoal/55 leading-relaxed max-w-3xl">
              {post.excerpt}
            </p>
          </div>

          <div className="relative aspect-[2.1/1] rounded-2xl overflow-hidden border border-taupe/15 mb-8">
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${post.image})` }}
              role="img"
              aria-label={post.imageAlt}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-obsidian/60 via-obsidian/10 to-transparent" />
          </div>

          <div className="rounded-2xl border border-taupe/12 bg-cream p-6 md:p-8 mb-6">
            <p className="text-base text-charcoal/65 leading-relaxed">{post.intro}</p>
          </div>

          <section className="rounded-2xl border border-taupe/12 bg-cream p-6 md:p-8 mb-6">
            <h2 className="text-[11px] tracking-[0.25em] uppercase text-sage font-medium mb-4">
              Key Points
            </h2>
            <div className="space-y-3">
              {post.highlights.map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-xl border border-taupe/12 bg-bone p-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-forest mt-2.5 shrink-0" />
                  <p className="text-sm text-charcoal/55 leading-relaxed">{item}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-6">
            {post.sections.map((section) => (
              <div key={section.heading} className="rounded-2xl border border-taupe/12 bg-cream p-6 md:p-8">
                <h2 className="font-serif text-2xl text-obsidian mb-3">{section.heading}</h2>
                <div className="space-y-3">
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph} className="text-sm md:text-base text-charcoal/60 leading-relaxed">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </section>

          <div className="rounded-2xl bg-forest text-bone p-6 md:p-8 mt-6">
            <p className="text-sm md:text-base leading-relaxed text-bone/90">{post.closing}</p>
          </div>
        </article>

        <section className="max-w-6xl mx-auto mt-14">
          <div className="flex items-center justify-between gap-4 mb-5">
            <h2 className="font-serif text-2xl text-obsidian">More from the Journal</h2>
            <Link href="/blog" className="text-xs tracking-[0.2em] uppercase text-charcoal/45 hover:text-forest transition-colors duration-300">
              View All
            </Link>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {relatedPosts.map((item) => (
              <Link
                key={item.slug}
                href={`/blog/${item.slug}`}
                className="rounded-xl border border-taupe/12 bg-cream overflow-hidden group card-hover transition-all duration-300"
              >
                <div className="relative aspect-[16/10] overflow-hidden">
                  <div
                    className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-[1.04]"
                    style={{ backgroundImage: `url(${item.image})` }}
                    role="img"
                    aria-label={item.imageAlt}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-obsidian/45 via-transparent to-transparent" />
                </div>
                <div className="p-4">
                  <p className="text-[10px] tracking-[0.15em] uppercase text-charcoal/35 mb-2">{item.readTime}</p>
                  <h3 className="font-serif text-lg text-obsidian group-hover:text-forest transition-colors duration-300 mb-1">
                    {item.title}
                  </h3>
                  <p className="text-sm text-charcoal/50 leading-relaxed">{item.excerpt}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </main>

      <footer className="py-8 px-6 bg-forest">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <span className="flex items-center gap-2 text-bone">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-3.5 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-lg font-bold tracking-wide">mully.</span>
          </span>
          <p className="text-xs text-bone/35">&copy; {new Date().getFullYear()} Mully Group, Inc. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
