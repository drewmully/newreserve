import Link from "next/link";
import {
  BLOG_LIST_POSTS,
  CATEGORY_COLORS,
  FEATURED_POST,
} from "./posts";
import { AuthAwareSignIn } from "../components/AuthAwareSignIn";

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-bone">
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/15">
        <div className="max-w-7xl mx-auto px-5 md:px-12 flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2 text-forest">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-4 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-xl font-bold tracking-wide">mully.</span>
          </Link>
          <AuthAwareSignIn className="text-sm tracking-wider uppercase text-forest font-medium hover:text-forest-dark transition-colors duration-300" />
        </div>
      </header>

      <main className="pt-24 pb-20 px-5 md:px-12">
        <div className="max-w-6xl mx-auto">
          <section className="relative overflow-hidden rounded-3xl bg-forest px-6 py-10 md:px-10 md:py-12 mb-10">
            <div
              className="absolute inset-0 opacity-[0.10] pointer-events-none"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 1px 1px, #F5F1E8 1px, transparent 0)",
                backgroundSize: "22px 22px",
              }}
            />
            <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-sage/30 blur-3xl pointer-events-none" />
            <div className="relative">
              <span className="inline-flex items-center gap-2.5 text-[11px] tracking-[0.35em] uppercase text-sage font-medium mb-4">
                <span className="w-6 h-px bg-sage/60" />
                The Journal
                <span className="w-6 h-px bg-sage/60" />
              </span>
              <h1 className="font-serif text-3xl md:text-5xl text-bone mb-4">
                Stories for the Modern Golfer
              </h1>
              <p className="text-sm md:text-base text-bone/70 leading-relaxed max-w-2xl">
                Product drops, fit guides, partner spotlights, and community stories from the Mully Reserve ecosystem.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/onboarding"
                  className="inline-flex items-center justify-center h-10 px-6 rounded-xl bg-bone text-forest text-xs font-medium tracking-[0.2em] uppercase hover:bg-bone/90 transition-colors duration-300 btn-press"
                >
                  Join Reserve
                </Link>
                <Link
                  href="/faq"
                  className="inline-flex items-center justify-center h-10 px-6 rounded-xl border border-bone/25 text-bone text-xs font-medium tracking-[0.2em] uppercase hover:border-bone/45 transition-colors duration-300"
                >
                  Visit FAQ
                </Link>
              </div>
            </div>
          </section>

          <Link
            href={`/blog/${FEATURED_POST.slug}`}
            className="block rounded-2xl border border-taupe/15 bg-cream overflow-hidden mb-10 group card-hover transition-all duration-300"
          >
            <div className="relative aspect-[2.15/1] overflow-hidden">
              <div
                className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-[1.03]"
                style={{ backgroundImage: `url(${FEATURED_POST.image})` }}
                role="img"
                aria-label={FEATURED_POST.imageAlt}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-obsidian/65 via-obsidian/15 to-transparent" />
              <div className="absolute top-4 left-4">
                <span className="inline-flex items-center rounded-full bg-bone/90 px-3 py-1 text-[10px] tracking-[0.15em] uppercase text-forest font-medium">
                  Featured Story
                </span>
              </div>
            </div>
            <div className="p-6 md:p-7">
              <div className="flex flex-wrap items-center gap-2.5 mb-3">
                <span className={`text-[10px] tracking-[0.15em] uppercase font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[FEATURED_POST.category]}`}>
                  {FEATURED_POST.category}
                </span>
                <span className="text-[11px] text-charcoal/30">{FEATURED_POST.date}</span>
                <span className="text-[11px] text-charcoal/30">&middot;</span>
                <span className="text-[11px] text-charcoal/30">{FEATURED_POST.readTime}</span>
              </div>
              <h2 className="font-serif text-2xl md:text-3xl text-obsidian mb-3 group-hover:text-forest transition-colors duration-300">
                {FEATURED_POST.title}
              </h2>
              <p className="text-sm md:text-base text-charcoal/55 leading-relaxed max-w-3xl">
                {FEATURED_POST.excerpt}
              </p>
            </div>
          </Link>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {BLOG_LIST_POSTS.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="block rounded-xl border border-taupe/12 bg-cream overflow-hidden group card-hover transition-all duration-300 h-full"
              >
                <div className="relative aspect-[16/10] overflow-hidden">
                  <div
                    className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-[1.04]"
                    style={{ backgroundImage: `url(${post.image})` }}
                    role="img"
                    aria-label={post.imageAlt}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-obsidian/45 via-obsidian/10 to-transparent" />
                </div>
                <div className="p-4 md:p-5 flex flex-col h-[calc(100%-10rem)]">
                  <div className="flex flex-wrap items-center gap-2.5 mb-2">
                    <span className={`text-[10px] tracking-[0.15em] uppercase font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[post.category]}`}>
                      {post.category}
                    </span>
                    <span className="text-[11px] text-charcoal/30">{post.date}</span>
                    <span className="text-[11px] text-charcoal/30">&middot;</span>
                    <span className="text-[11px] text-charcoal/30">{post.readTime}</span>
                  </div>
                  <h2 className="font-serif text-lg text-obsidian mb-2 group-hover:text-forest transition-colors duration-300">
                    {post.title}
                  </h2>
                  <p className="text-sm text-charcoal/50 leading-relaxed flex-1">{post.excerpt}</p>
                  <p className="text-xs tracking-[0.2em] uppercase text-forest/70 mt-4">
                    Read Article
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
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
