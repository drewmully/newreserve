import type { Metadata } from "next";
import Link from "next/link";
import { adminDb } from "@/lib/firebase-admin";
import { FORUM_TAGS, formatRelativeTime, type ForumPost } from "./posts";
import { ensureCommunitySeedPosts } from "@/lib/communitySeed";
import { CommunityNav } from "./CommunityNav";
import { serializeJsonLd } from "@/lib/safeJsonLd";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Community | Mully Reserve",
  description:
    "Connect with fellow Reserve members. Gear reviews, guest play coordination, and more from the Mully Reserve golf community.",
  openGraph: {
    title: "Mully Reserve Community",
    description:
      "Gear reviews, guest play, and more from real Reserve members.",
    type: "website",
  },
};

async function getPosts(): Promise<ForumPost[]> {
  try {
    await ensureCommunitySeedPosts();

    const snapshot = await adminDb
      .collection("communityPosts")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    return await Promise.all(
      snapshot.docs.map(async (doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          author: d.author as string,
          avatar: d.avatar as string,
          timestamp: d.createdAt
            ? formatRelativeTime((d.createdAt as { toDate(): Date }).toDate())
            : "just now",
          title: d.title as string,
          body: d.body as string,
          likes: (d.likes as number) || 0,
          commentCount: (d.commentCount as number) || 0,
          comments: [],
          tag: d.tag as string,
          images: (d.images as string[]) || [],
        };
      })
    );
  } catch {
    return [];
  }
}

export default async function CommunityPage() {
  const posts = await getPosts();

  return (
    <div className="min-h-screen bg-bone">
      {/* Navigation — shows persistent nav for signed-in users, simple header for guests */}
      <CommunityNav />

      <main className="community-main pb-24 px-6 md:px-12">
        <div className="max-w-3xl mx-auto">
          {/* Heading */}
          <div className="mb-10">
            <h1 className="font-serif text-3xl md:text-4xl text-obsidian mb-3">
              Community
            </h1>
            <p className="text-base text-charcoal/55 leading-relaxed max-w-xl">
              Real conversations from Reserve members: gear reviews,
              guest play coordination, and more.
            </p>
          </div>

          {/* Tag navigation */}
          <nav className="flex items-center gap-2 mb-8 overflow-x-auto pb-1" aria-label="Post categories">
            {FORUM_TAGS.filter((t) => t !== "All").map((tag) => (
              <span
                key={tag}
                className="px-4 py-2 rounded-lg text-xs tracking-wide bg-cream border border-taupe/20 text-charcoal/50 whitespace-nowrap"
              >
                {tag}
              </span>
            ))}
          </nav>

          {/* Post list — server-rendered for SEO */}
          {posts.length === 0 ? (
            <div className="text-center py-16 bg-cream rounded-2xl border border-taupe/15">
              <p className="text-sm text-charcoal/40 mb-2">No posts yet.</p>
              <p className="text-xs text-charcoal/30">Be the first to join and share something.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {posts.map((post) => (
                <article
                  key={post.id}
                  className="bg-cream rounded-xl border border-taupe/15 hover:border-taupe/30 overflow-hidden tile-hover"
                >
                  <Link href={`/community/post/${post.id}`} className="block p-6">
                    <div className="flex items-start gap-4">
                      {/* Avatar */}
                      <div className="w-10 h-10 rounded-full bg-forest/10 flex items-center justify-center shrink-0">
                        <span className="text-xs font-medium text-forest">{post.avatar}</span>
                      </div>

                      <div className="flex-1 min-w-0">
                        {/* Meta */}
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-sm font-medium text-obsidian">{post.author}</span>
                          <span className="text-xs text-charcoal/30">&middot;</span>
                          <span className="text-xs text-charcoal/35">{post.timestamp}</span>
                          <span className="text-xs text-sage bg-sage/10 px-2 py-0.5 rounded ml-auto">{post.tag}</span>
                        </div>

                        {/* Title */}
                        <h2 className="text-base font-medium text-obsidian mb-2 leading-snug">
                          {post.title}
                        </h2>

                        {/* Body preview */}
                        <p className="text-sm text-charcoal/55 leading-relaxed line-clamp-2">
                          {post.body}
                        </p>

                        {/* Images */}
                        {post.images && post.images.length > 0 && (
                          <div className={`mt-3 grid gap-2 ${post.images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                            {post.images.map((src, i) => (
                              <div key={i} className="relative aspect-[3/2] rounded-lg overflow-hidden bg-bone border border-taupe/15">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={src} alt={`${post.title} photo ${i + 1}`} className="w-full h-full object-cover" />
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Stats */}
                        <div className="flex items-center gap-5 mt-4 text-xs text-charcoal/40">
                          <span className="flex items-center gap-1.5">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3.18a2.055 2.055 0 01.357-1.093A2.78 2.78 0 0115.455 1c1.725 0 2.295 1.467 2.295 2.913v2.437c0 .532-.065 1.06-.218 1.551l-1.474 4.74a3.375 3.375 0 00.851 3.421l.426.388M6.633 10.5H4.869a2.376 2.376 0 00-2.344 2.752l.88 5.749A2.376 2.376 0 005.749 21h1.102M6.633 10.5v10.5" />
                            </svg>
                            {post.likes}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
                            </svg>
                            {(post.commentCount ?? post.comments.length)} {(post.commentCount ?? post.comments.length) === 1 ? "comment" : "comments"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          )}

          {/* CTA */}
          <div className="mt-12 text-center bg-forest rounded-2xl p-8 md:p-10 relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.04] pointer-events-none" style={{
              backgroundImage: `radial-gradient(circle at 1px 1px, #F5F1E8 0.5px, transparent 0)`,
              backgroundSize: "24px 24px",
            }} />
            <div className="relative">
              <h2 className="font-serif text-2xl text-bone mb-2">
                Join the conversation.
              </h2>
              <p className="text-sm text-bone/55 mb-6 max-w-md mx-auto">
                Sign up for free to like, comment, share reviews, and connect with fellow golfers.
              </p>
              <Link
                href="/onboarding"
                className="inline-flex items-center justify-center h-11 px-8 rounded-xl bg-bone text-forest text-sm font-medium tracking-wider uppercase hover:bg-bone-dark transition-colors duration-300 btn-press"
              >
                Sign Up Free
              </Link>
            </div>
          </div>
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
            <Link href="/policies/terms" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">Terms</Link>
            <Link href="/policies/privacy" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">Privacy</Link>
            <Link href="/faq" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">FAQ</Link>
          </div>
          <p className="text-xs text-bone/30">&copy; {new Date().getFullYear()} Mully Group, Inc.</p>
        </div>
      </footer>

      {/* JSON-LD structured data for Google */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd({
            "@context": "https://schema.org",
            "@type": "DiscussionForumPosting",
            "name": "Mully Reserve Community",
            "description": "Golf community discussions from Mully Reserve members.",
            "mainEntity": posts.map((post) => ({
              "@type": "DiscussionForumPosting",
              "headline": post.title,
              "text": post.body,
              "author": { "@type": "Person", "name": post.author },
              "interactionStatistic": [
                { "@type": "InteractionCounter", "interactionType": "https://schema.org/LikeAction", "userInteractionCount": post.likes },
                { "@type": "InteractionCounter", "interactionType": "https://schema.org/CommentAction", "userInteractionCount": post.commentCount ?? post.comments.length },
              ],
            })),
          }),
        }}
      />
    </div>
  );
}
