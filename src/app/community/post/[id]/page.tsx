import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { posts, getPostById } from "../../posts";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateStaticParams() {
  return posts.map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const post = getPostById(id);
  if (!post) return {};
  return {
    title: `${post.title} — ${post.author} | Mully Reserve Community`,
    description: post.body.slice(0, 160),
    openGraph: {
      title: post.title,
      description: post.body.slice(0, 160),
      type: "article",
      authors: [post.author],
    },
  };
}

export default async function PostPage({ params }: Props) {
  const { id } = await params;
  const post = getPostById(id);
  if (!post) notFound();

  return (
    <div className="min-h-screen bg-bone">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/20">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 text-forest">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-2xl font-bold tracking-wide">mully.</span>
          </Link>
          <Link
            href="/onboarding"
            className="h-9 px-5 rounded-lg bg-forest text-bone text-xs font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 flex items-center"
          >
            Join Free
          </Link>
        </div>
      </header>

      <main className="pt-28 pb-24 px-6 md:px-12">
        <div className="max-w-3xl mx-auto">
          {/* Back */}
          <Link
            href="/community"
            className="inline-flex items-center gap-1.5 text-sm text-charcoal/40 hover:text-forest transition-colors duration-300 mb-8"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back to Community
          </Link>

          {/* Post */}
          <article>
            {/* Author & Meta */}
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-full bg-forest/10 flex items-center justify-center shrink-0">
                <span className="text-sm font-medium text-forest">{post.avatar}</span>
              </div>
              <div>
                <p className="text-sm font-medium text-obsidian">{post.author}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-charcoal/35">{post.timestamp}</span>
                  <span className="text-xs text-sage bg-sage/10 px-2 py-0.5 rounded">{post.tag}</span>
                </div>
              </div>
            </div>

            {/* Title */}
            <h1 className="font-serif text-2xl md:text-3xl text-obsidian leading-tight mb-4">
              {post.title}
            </h1>

            {/* Body */}
            <div className="text-base text-charcoal/65 leading-relaxed mb-6">
              <p>{post.body}</p>
            </div>

            {/* Images */}
            {post.images && post.images.length > 0 && (
              <div className={`mb-6 grid gap-3 ${post.images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                {post.images.map((src, i) => (
                  <div key={i} className="relative aspect-[3/2] rounded-xl overflow-hidden bg-cream border border-taupe/15">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`${post.title} photo ${i + 1}`} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            )}

            {/* Stats */}
            <div className="flex items-center gap-6 py-4 border-t border-b border-taupe/15 mb-8 text-sm text-charcoal/50">
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3.18a2.055 2.055 0 01.357-1.093A2.78 2.78 0 0115.455 1c1.725 0 2.295 1.467 2.295 2.913v2.437c0 .532-.065 1.06-.218 1.551l-1.474 4.74a3.375 3.375 0 00.851 3.421l.426.388M6.633 10.5H4.869a2.376 2.376 0 00-2.344 2.752l.88 5.749A2.376 2.376 0 005.749 21h1.102M6.633 10.5v10.5" />
                </svg>
                {post.likes} likes
              </span>
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
                </svg>
                {post.comments.length} {post.comments.length === 1 ? "comment" : "comments"}
              </span>
            </div>

            {/* Comments — rendered as static HTML for SEO */}
            <section aria-label="Comments">
              <h2 className="text-sm font-medium text-obsidian tracking-wide mb-5">
                Comments ({post.comments.length})
              </h2>

              <div className="space-y-5">
                {post.comments.map((comment) => (
                  <div key={comment.id} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-forest/8 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[10px] font-medium text-forest">{comment.avatar}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-obsidian">{comment.author}</span>
                        <span className="text-[10px] text-charcoal/30">{comment.timestamp}</span>
                      </div>
                      <p className="text-sm text-charcoal/60 leading-relaxed">{comment.body}</p>
                      <span className="text-[11px] text-charcoal/30 mt-1.5 inline-flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3.18a2.055 2.055 0 01.357-1.093A2.78 2.78 0 0115.455 1c1.725 0 2.295 1.467 2.295 2.913v2.437c0 .532-.065 1.06-.218 1.551l-1.474 4.74a3.375 3.375 0 00.851 3.421l.426.388M6.633 10.5H4.869a2.376 2.376 0 00-2.344 2.752l.88 5.749A2.376 2.376 0 005.749 21h1.102M6.633 10.5v10.5" />
                        </svg>
                        {comment.likes}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Sign-up prompt instead of reply box */}
              <div className="mt-8 bg-cream rounded-xl border border-taupe/15 p-6 text-center">
                <p className="text-sm text-charcoal/50 mb-3">
                  Want to join the conversation?
                </p>
                <Link
                  href="/onboarding"
                  className="inline-flex items-center justify-center h-10 px-6 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300"
                >
                  Sign Up to Reply
                </Link>
              </div>
            </section>
          </article>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-10 px-6 md:px-12 bg-forest">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <span className="flex items-center gap-2 text-bone">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-4 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-xl font-bold tracking-wide">mully.</span>
          </span>
          <div className="flex items-center gap-8">
            <Link href="/policies/terms" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300">Terms</Link>
            <Link href="/policies/privacy" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300">Privacy</Link>
            <Link href="/faq" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300">FAQ</Link>
          </div>
          <p className="text-xs text-bone/30">&copy; {new Date().getFullYear()} Mully Group, Inc.</p>
        </div>
      </footer>

      {/* JSON-LD structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "DiscussionForumPosting",
            "headline": post.title,
            "text": post.body,
            "author": { "@type": "Person", "name": post.author },
            "interactionStatistic": [
              { "@type": "InteractionCounter", "interactionType": "https://schema.org/LikeAction", "userInteractionCount": post.likes },
              { "@type": "InteractionCounter", "interactionType": "https://schema.org/CommentAction", "userInteractionCount": post.comments.length },
            ],
            "comment": post.comments.map((c) => ({
              "@type": "Comment",
              "text": c.body,
              "author": { "@type": "Person", "name": c.author },
            })),
          }),
        }}
      />
    </div>
  );
}
