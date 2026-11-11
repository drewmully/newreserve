/**
 * The Mully Letter: every editorial email Mully sends, republished as a
 * permanent Journal post (/blog/<slug>) and listed at /blog/letters.
 *
 * Issues are ordinary Supabase `blog_posts` rows. Membership is code-level:
 * the slug is listed in src/lib/letterIssues.ts (the category column has a
 * check constraint, so no new category value and no migration).
 * `publish_date` is the Klaviyo send time. New issues come from
 * scripts/newsletter-to-post.ts (see docs/newsletter-archive.md).
 */
import type { BlogPost } from "@/app/blog/posts";
import { SITE_URL } from "@/lib/seo";

export const LETTER_CATEGORY = "The Mully Letter" as const;

export const LETTER_COLLECTION = {
  path: "/blog/letters",
  name: "The Mully Letter",
  title: "The Mully Letter: Golf Style and News Newsletter Archive | Mully",
  description:
    "Every issue of The Mully Letter, the Mully golf newsletter: tour news, course restorations, the rules, and the golf clothes worth owning, archived in full.",
  intro:
    "The Mully Letter is our golf newsletter. Tour news, course stories, the rules, and the clothes worth owning. Every issue lives here once it has gone out.",
  /** Series published under the collection, newest cadence first. */
  series: ["This Past Week in Golf", "The Mully Letter", "The Mully Edit"],
};

/**
 * Real newsletter signup: /join posts to /api/editorial/drop-signup with
 * explicit consent. No `?source=` so it uses the page default.
 */
export const LETTER_SUBSCRIBE = {
  eyebrow: "The Mully Letter",
  heading: "Get the next issue in your inbox.",
  body: "Golf news, course stories and the clothes worth owning, a couple of times a week.",
  cta: "Sign up for the newsletter",
  href: "/join",
};

export function isLetter(post: Pick<BlogPost, "category">): boolean {
  return post.category === LETTER_CATEGORY;
}

const SENT_FMT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "America/New_York",
});

/** "November 8, 2026" in Eastern time, from the send timestamp. */
export function sentDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : SENT_FMT.format(d);
}

/** "Originally sent to Mully subscribers on November 8, 2026." */
export function sentLine(iso: string | undefined): string | null {
  const d = sentDate(iso);
  return d ? `Originally sent to Mully subscribers on ${d}.` : null;
}

/** Article JSON-LD for an issue; datePublished is the send time. */
export function letterArticleJsonLd(post: BlogPost) {
  const url = `${SITE_URL}/blog/${post.slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.publishedAt,
    image: post.image ? [post.image] : undefined,
    mainEntityOfPage: url,
    url,
    isPartOf: { "@type": "CollectionPage", name: LETTER_COLLECTION.name, url: `${SITE_URL}${LETTER_COLLECTION.path}` },
    author: { "@type": "Organization", name: "Mully", url: SITE_URL },
    publisher: { "@type": "Organization", name: "Mully", url: SITE_URL },
  };
}
