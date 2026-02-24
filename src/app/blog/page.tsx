import Link from "next/link";

/* ═══════════════════════════════════════════
   BLOG PAGE — Template
   ═══════════════════════════════════════════ */

const FEATURED_POST = {
  slug: "welcome-to-mully-reserve",
  title: "Welcome to Mully Reserve",
  excerpt: "We built Mully Reserve because the best of golf shouldn\u2019t require a six-figure initiation. Here\u2019s what we\u2019re building and why.",
  category: "Announcements",
  date: "Feb 20, 2026",
  readTime: "4 min read",
  image: null as string | null,
};

const POSTS = [
  {
    slug: "spring-2026-drop-preview",
    title: "Spring 2026 Drop Preview",
    excerpt: "A first look at what\u2019s landing this quarter\u2014from Greyson polos to Titleist Tour Soft by the dozen.",
    category: "Drops",
    date: "Feb 18, 2026",
    readTime: "3 min read",
  },
  {
    slug: "fit-profile-guide",
    title: "How Your Fit Profile Works",
    excerpt: "We use seven data points to make sure every item we send fits perfectly. Here\u2019s the breakdown.",
    category: "Guides",
    date: "Feb 15, 2026",
    readTime: "2 min read",
  },
  {
    slug: "top-5-courses-michigan",
    title: "Top 5 Public Courses in Michigan",
    excerpt: "From Arcadia Bluffs to Forest Dunes\u2014our team\u2019s picks for the best rounds you can book today.",
    category: "Community",
    date: "Feb 12, 2026",
    readTime: "5 min read",
  },
  {
    slug: "member-box-unboxing-q1",
    title: "Q1 Member Box Unboxing",
    excerpt: "See what our Reserve Members received this quarter and the story behind each item.",
    category: "Member Life",
    date: "Feb 8, 2026",
    readTime: "3 min read",
  },
  {
    slug: "peter-millar-partnership",
    title: "Partner Spotlight: Peter Millar",
    excerpt: "Why we chose Peter Millar as a founding partner and what it means for Reserve pricing.",
    category: "Partners",
    date: "Feb 5, 2026",
    readTime: "3 min read",
  },
];

const CATEGORY_COLORS: Record<string, string> = {
  Announcements: "bg-forest/10 text-forest",
  Drops: "bg-sage/15 text-sage",
  Guides: "bg-ember/10 text-ember",
  Community: "bg-forest/10 text-forest",
  "Member Life": "bg-sage/15 text-sage",
  Partners: "bg-taupe/20 text-charcoal/60",
};

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-bone">
      {/* ─── HEADER ─── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/15">
        <div className="max-w-7xl mx-auto px-5 md:px-12 flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2 text-forest">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-4 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-xl font-bold tracking-wide">mully.</span>
          </Link>
          <Link href="/login" className="text-sm tracking-wider uppercase text-forest font-medium hover:text-forest-dark transition-colors duration-300">
            Sign In
          </Link>
        </div>
      </header>

      <main className="pt-24 pb-20 px-5 md:px-12">
        <div className="max-w-4xl mx-auto">
          {/* Page header */}
          <div className="text-center mb-14">
            <span className="inline-flex items-center gap-2.5 text-[11px] tracking-[0.35em] uppercase text-sage font-medium mb-4">
              <span className="w-6 h-px bg-sage/40" />
              The Journal
              <span className="w-6 h-px bg-sage/40" />
            </span>
            <h1 className="font-serif text-3xl md:text-4xl text-obsidian mb-3">Blog</h1>
            <p className="text-sm text-charcoal/50 leading-relaxed max-w-md mx-auto">
              Drops, guides, course reviews, and stories from the Mully community.
            </p>
          </div>

          {/* Featured post */}
          <Link
            href={`/blog/${FEATURED_POST.slug}`}
            className="block rounded-xl border border-taupe/12 bg-cream overflow-hidden mb-10 group card-hover transition-all duration-300"
          >
            {/* Image placeholder */}
            <div className="aspect-[2.4/1] bg-gradient-to-br from-forest/8 to-sage/10 flex items-center justify-center">
              <span className="text-xs tracking-[0.3em] uppercase text-forest/25 font-medium">Featured</span>
            </div>
            <div className="p-5 md:p-6">
              <div className="flex items-center gap-3 mb-2.5">
                <span className={`text-[10px] tracking-[0.15em] uppercase font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[FEATURED_POST.category] || "bg-taupe/15 text-charcoal/50"}`}>
                  {FEATURED_POST.category}
                </span>
                <span className="text-[11px] text-charcoal/30">{FEATURED_POST.date}</span>
                <span className="text-[11px] text-charcoal/30">&middot;</span>
                <span className="text-[11px] text-charcoal/30">{FEATURED_POST.readTime}</span>
              </div>
              <h2 className="font-serif text-xl md:text-2xl text-obsidian mb-2 group-hover:text-forest transition-colors duration-300">
                {FEATURED_POST.title}
              </h2>
              <p className="text-sm text-charcoal/50 leading-relaxed">{FEATURED_POST.excerpt}</p>
            </div>
          </Link>

          {/* Post grid */}
          <div className="grid md:grid-cols-2 gap-5">
            {POSTS.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="block rounded-xl border border-taupe/12 bg-cream overflow-hidden group card-hover transition-all duration-300"
              >
                {/* Image placeholder */}
                <div className="aspect-[2/1] bg-gradient-to-br from-forest/5 to-sage/8 flex items-center justify-center">
                  <svg className="w-8 h-8 text-forest/10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                  </svg>
                </div>
                <div className="p-4 md:p-5">
                  <div className="flex items-center gap-2.5 mb-2">
                    <span className={`text-[10px] tracking-[0.15em] uppercase font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[post.category] || "bg-taupe/15 text-charcoal/50"}`}>
                      {post.category}
                    </span>
                    <span className="text-[11px] text-charcoal/30">{post.readTime}</span>
                  </div>
                  <h3 className="font-serif text-base text-obsidian mb-1.5 group-hover:text-forest transition-colors duration-300">
                    {post.title}
                  </h3>
                  <p className="text-xs text-charcoal/45 leading-relaxed line-clamp-2">{post.excerpt}</p>
                  <p className="text-[11px] text-charcoal/25 mt-3">{post.date}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </main>

      {/* ─── FOOTER ─── */}
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
