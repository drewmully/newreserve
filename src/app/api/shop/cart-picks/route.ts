/**
 * GET /api/shop/cart-picks
 *
 * Lean list of BOGO15-eligible shop products for the cart's "pairs well
 * with" row. Ranking and rotation happen client side (src/lib/cartPicks.ts)
 * so each shopper's bag and fatigue history shape what they see.
 */

import { NextResponse } from "next/server";
import { getCollectionProducts } from "@/lib/shopify";
import { shopProductPhoto } from "@/lib/shopProductPhotos";
import { toCartPickProduct, type CartPickProduct } from "@/lib/cartPicks";

export const revalidate = 300;

export async function GET() {
  try {
    const products = await getCollectionProducts("shop-all");
    const picks = products
      .map((p) => toCartPickProduct({ ...p, image: shopProductPhoto(p) }))
      .filter((p): p is CartPickProduct => p !== null);
    return NextResponse.json(
      { products: picks },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" } }
    );
  } catch (err) {
    console.error("[cart-picks] catalog fetch failed:", err);
    // The cart still works without picks; the nudge just hides its row.
    return NextResponse.json({ products: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
