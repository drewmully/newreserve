/**
 * GET /api/feeds/klaviyo/new-arrivals
 *
 * Public JSON web feed for Klaviyo templates ("What's new in the Pro Shop"
 * monthly drop and any dynamic product block). Reads the live Storefront
 * catalog, newest first, so emails always show current products, photos and
 * prices with no template edits.
 *
 *   ?limit=8          1..24 products (default 8)
 *   ?collection=...   Shopify collection handle (default "shop-all")
 *
 * In Klaviyo: Content > Web feeds > URL = https://www.mymully.com/api/feeds/klaviyo/new-arrivals
 * Template: {% for p in feeds.new_arrivals.products|slice:":4" %} {{ p.title }} {% endfor %}
 *
 * Contains only public catalog data.
 */

import { NextResponse } from "next/server";
import { getCollectionProducts } from "@/lib/shopify";
import { SITE_URL } from "@/lib/klaviyo/lifecycleConfig";

export const runtime = "nodejs";
export const revalidate = 600;

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(24, Math.max(1, Number(url.searchParams.get("limit")) || 8));
  const requested = url.searchParams.get("collection") ?? "shop-all";
  const collection = HANDLE_RE.test(requested) ? requested : "shop-all";

  try {
    const products = await getCollectionProducts(collection, true);
    const items = products
      .filter((p) => p.price > 0 && p.images.length > 0 && p.variants.some((v) => v.availableForSale))
      .slice(0, limit)
      .map((p) => ({
        id: p.slug,
        title: p.name,
        brand: p.brand,
        category: p.collection,
        url: `${SITE_URL}/shop/${p.slug}`,
        image_url: p.images[0],
        price: p.price,
        member_price: p.reservePrice,
        headline: p.editorialHeadline || undefined,
        preorder: p.variants.every((v) => !v.availableForSale || v.currentlyNotInStock === true),
      }));

    return NextResponse.json(
      { generated_at: new Date().toISOString(), collection, count: items.length, products: items },
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } },
    );
  } catch {
    console.error("[klaviyo-feed] catalog unavailable");
    return NextResponse.json({ error: "catalog_unavailable", products: [] }, { status: 503 });
  }
}
