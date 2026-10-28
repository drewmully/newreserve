/**
 * /sitemap.xml (SEO recovery s05). Lists every public, indexable page.
 * Products come from the Storefront collections the shop renders, Journal
 * posts from Supabase, restored archive posts from the legacy allowlist.
 * lastModified is only set where the source has a real date.
 */
import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";
import { SHOP_CATEGORY_HANDLES, GIFT_TIERS } from "./shop/shopCollections";
import { LEGACY_HANDLES, getLegacyPost } from "@/lib/legacyBlog";
import { PRO_SHOP_COLLECTION_HANDLE, PRIVATE_RELEASES_COLLECTION_HANDLE } from "@/lib/shopify";

export const revalidate = 3600;

const SITE = "https://www.mymully.com";

const STATIC_PATHS = [
  "/", "/subscription", "/shop", "/shop/new-arrivals", "/blog",
  "/lp/editorial", "/lp/mully100", "/lp/gift", "/outings", "/faq", "/contact",
  "/policies/terms", "/policies/privacy", "/policies/refund", "/policies/shipping",
];

async function shopProducts(): Promise<{ handle: string; updatedAt: string }[]> {
  const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
  const token = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
  if (!domain || !token) return [];
  const handles = ["shop-all", PRO_SHOP_COLLECTION_HANDLE, PRIVATE_RELEASES_COLLECTION_HANDLE];
  const seen = new Map<string, string>();
  await Promise.all(handles.map(async (h) => {
    try {
      const res = await fetch(`https://${domain}/api/2024-10/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": token },
        body: JSON.stringify({
          query: `query($h:String!){ collection(handle:$h){ products(first:250){ nodes{ handle updatedAt availableForSale } } } }`,
          variables: { h },
        }),
        next: { revalidate: 3600 },
      });
      const json = await res.json();
      for (const p of json?.data?.collection?.products?.nodes ?? []) {
        const prev = seen.get(p.handle);
        if (!prev || prev < p.updatedAt) seen.set(p.handle, p.updatedAt);
      }
    } catch (err) {
      console.error("[sitemap] Storefront collection failed", h, err);
    }
  }));
  return [...seen].map(([handle, updatedAt]) => ({ handle, updatedAt }));
}

async function journalPosts(): Promise<{ slug: string; updated: string | null }[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return [];
  const { data, error } = await createClient(url, key)
    .from("blog_posts")
    .select("slug, updated_at, publish_date")
    .eq("status", "published");
  if (error || !data) return [];
  return data.map((r) => ({ slug: r.slug as string, updated: (r.updated_at ?? r.publish_date ?? null) as string | null }));
}

async function legacyPosts(): Promise<{ handle: string; date: string | null }[]> {
  return Promise.all(LEGACY_HANDLES.map(async (handle) => {
    try { return { handle, date: (await getLegacyPost(handle))?.publishedAt ?? null }; }
    catch { return { handle, date: null }; }
  }));
}

const when = (d: string | null | undefined) => (d ? new Date(d) : undefined);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, posts, legacy] = await Promise.all([shopProducts(), journalPosts(), legacyPosts()]);
  const categoryPaths = ["shop-all", ...Object.values(SHOP_CATEGORY_HANDLES)].map((h) => `/shop/collection/${h}`);
  const giftPaths = GIFT_TIERS.map((t) => `/shop/gifts/${t.key}`);
  return [
    ...[...STATIC_PATHS, ...categoryPaths, ...giftPaths].map((p) => ({ url: `${SITE}${p === "/" ? "" : p}` })),
    ...products.map((p) => ({ url: `${SITE}/shop/${p.handle}`, lastModified: when(p.updatedAt) })),
    ...posts.map((p) => ({ url: `${SITE}/blog/${p.slug}`, lastModified: when(p.updated) })),
    ...legacy.map((p) => ({ url: `${SITE}/blogs/news/${p.handle}`, lastModified: when(p.date) })),
  ];
}
