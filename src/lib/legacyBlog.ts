/**
 * Restored Shopify-era Journal posts (SEO recovery s01).
 *
 * Twelve old /blogs/news/<handle> posts that carried most of the blog's search
 * traffic are served again at their original URL. Content is read (never
 * written) from the Shopify blog "news" via the Storefront API, cleaned
 * server-side, and rendered in the current Journal design.
 * Spec: mully/mully-seo-geo/site-specs-s01-s05.md in the Promethean Project.
 */
import sanitizeHtml from "sanitize-html";
import legacyRedirects from "./legacyRedirects.json";

export interface LegacyNextCard {
  headline: string;
  href: string;
}

export const LEGACY_POSTS: Record<string, LegacyNextCard> = {
  "how-the-official-world-golf-rankings-determine-golfs-top-players-a-deep-dive-into-the-ranking-system": { headline: "Golf, sent to your door", href: "/subscription" },
  "how-is-a-golf-handicap-calculated-the-complete-guide": { headline: "Golf, sent to your door", href: "/subscription" },
  "the-fix-heres-how-to-finally-stop-hitting-the-ball-off-the-hosel": { headline: "Training aids we actually use", href: "/lp/mully100" },
  "best-formats-for-golf-trips-with-your-buddies": { headline: "Outfit the whole group", href: "/outings" },
  "golf-formats-explained-different-ways-to-play-the-game": { headline: "Outfit the whole group", href: "/outings" },
  "top-5-golf-resorts-in-michigan": { headline: "Courses worth the trip", href: "/lp/editorial" },
  "what-is-a-cadet-glove-size": { headline: "Shop gear", href: "/shop/collection/shop-gear" },
  "choosing-the-perfect-golf-hat-tips-for-comfort-and-performance": { headline: "Shop hats and accessories", href: "/shop/collection/shop-accessories" },
  "5-essential-golf-wearables-every-player-should-know-about": { headline: "The Mully 100", href: "/lp/mully100" },
  "golf-ball-rollback": { headline: "The Mully 100", href: "/lp/mully100" },
  "how-to-properly-transition-from-the-backswing-to-the-downswing": { headline: "Training aids we actually use", href: "/lp/mully100" },
  "golf-outing-ideas-35-formats-themes-contests-and-extras-with-a-planning-checklist": { headline: "Outfit the whole group", href: "/outings" },
};

export const LEGACY_HANDLES = Object.keys(LEGACY_POSTS);

export interface LegacyPost {
  handle: string;
  title: string;
  html: string;
  excerpt: string;
  publishedAt: string;
  image: { url: string; altText: string | null } | null;
  seoTitle: string | null;
  seoDescription: string | null;
  readMinutes: number;
}

const QUERY = `query LegacyArticle($h: String!) {
  blog(handle: "news") {
    articleByHandle(handle: $h) {
      title contentHtml excerpt publishedAt
      image { url altText }
      seo { title description }
    }
  }
}`;

type ArticleNode = {
  title: string;
  contentHtml: string;
  excerpt: string | null;
  publishedAt: string;
  image: { url: string; altText: string | null } | null;
  seo: { title: string | null; description: string | null } | null;
};

const REDIRECTS = new Map(legacyRedirects.map((r) => [r.source, r.destination]));
const OLD_HOSTS = /^(https?:\/\/)?(www\.)?(mymully\.com|mullybox\.com|mullybox-store\.myshopify\.com)(?=\/|$)/i;

/** Final live URL for a link found in an old post body. */
export function rewriteLegacyHref(href: string): string {
  const raw = href.trim();
  if (/^https?:\/\/outings\.mymully\.com/i.test(raw)) return "/outings";
  const isOld = OLD_HOSTS.test(raw);
  if (!isOld && !raw.startsWith("/")) return raw; // external, mailto, anchors
  const path = (isOld ? raw.replace(OLD_HOSTS, "") : raw).split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  const local = path.replace(/^\/en-[a-z]{2}(?=\/|$)/, "") || "/";
  if (local === "/products/mully-outing-boxes") return "/outings";
  if (local.startsWith("/products/")) return "/shop"; // retired Shopify-era SKUs
  if (local.startsWith("/blogs/news/")) {
    const handle = local.slice("/blogs/news/".length);
    if (LEGACY_POSTS[handle]) return local;
    return REDIRECTS.get(local) ?? "/blog";
  }
  return REDIRECTS.get(local) ?? local;
}

/** Strip Bloggle scripts/styles and old markup, keep a small safe tag set. */
export function cleanLegacyHtml(html: string): string {
  let out = sanitizeHtml(html, {
    allowedTags: ["p", "h2", "h3", "h4", "ul", "ol", "li", "a", "strong", "em", "blockquote", "img"],
    allowedAttributes: { a: ["href", "rel", "target"], img: ["src", "alt", "loading"] },
    allowedSchemes: ["https", "http", "mailto"],
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "button", "svg", "title"],
    transformTags: {
      h3: "h2",
      h4: "h2",
      b: "strong",
      i: "em",
      a: (tagName, attribs) => {
        const href = rewriteLegacyHref(attribs.href ?? "");
        const external = /^https?:\/\//i.test(href);
        const out: Record<string, string> = { href };
        if (external) Object.assign(out, { rel: "noopener", target: "_blank" });
        return { tagName, attribs: out };
      },
      img: (tagName, attribs) => ({
        tagName,
        attribs: {
          src: (attribs.src ?? "").replace(/^\/\//, "https://"),
          alt: brandSwap(attribs.alt ?? ""),
          loading: "lazy",
        },
      }),
    },
    // Brand swap on visible text only, never inside URLs.
    textFilter: (text) => brandSwap(text),
    exclusiveFilter: (frame) => frame.tag === "img" && !/^https:\/\//.test(frame.attribs.src ?? ""),
  });
  // Collapse whitespace and drop tags left empty after cleaning.
  out = out.replace(/\s+/g, " ");
  const empty = /<(p|h2|strong|em|li|blockquote|a)(\s[^>]*)?>\s*<\/\1>/g;
  for (let i = 0; i < 4; i++) {
    const next = out.replace(empty, "");
    if (next === out) break;
    out = next;
  }
  out = out.replace(/<(ul|ol)>\s*<\/\1>/g, "");
  return out;
}

/** Display-only: older posts say "Mullybox"; the brand is Mully. */
export function brandSwap(text: string): string {
  return text
    .replace(/(www\.)?Mully\s?box\.com/gi, "mymully.com")
    .replace(/Mully\s?box/gi, "Mully");
}

export async function getLegacyPost(handle: string): Promise<LegacyPost | null> {
  if (!LEGACY_POSTS[handle]) return null;
  const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
  const token = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
  if (!domain || !token) throw new Error("Shopify Storefront env missing");
  const res = await fetch(`https://${domain}/api/2024-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": token },
    body: JSON.stringify({ query: QUERY, variables: { h: handle } }),
    next: { revalidate: 86400 },
  });
  if (!res.ok) throw new Error(`Storefront ${res.status}`);
  const json = (await res.json()) as {
    data?: { blog: { articleByHandle: ArticleNode | null } | null };
    errors?: { message: string }[];
  };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  const a = json.data?.blog?.articleByHandle;
  if (!a) return null;
  const html = cleanLegacyHtml(a.contentHtml);
  const words = html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  return {
    handle,
    title: brandSwap(a.title),
    html,
    excerpt: brandSwap(a.excerpt ?? ""),
    publishedAt: a.publishedAt,
    image: a.image ? { url: a.image.url, altText: a.image.altText ? brandSwap(a.image.altText) : null } : null,
    seoTitle: a.seo?.title ? brandSwap(a.seo.title) : null,
    seoDescription: a.seo?.description ? brandSwap(a.seo.description) : null,
    readMinutes: Math.max(1, Math.round(words / 230)),
  };
}
