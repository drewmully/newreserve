/**
 * Product lookup for slotting an exchange item into a return.
 *
 * GET /api/admin/returns/variants?productId=gid://...  → that product + its sizes
 * GET /api/admin/returns/variants?q=polo               → active products matching
 *                                                         title / SKU / vendor, with sizes
 *
 * Always returns { products: [{ id, title, vendor, imageUrl, variants[] }] }.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_lib/adminAuth";
import { adminGraphql, PRODUCT_SEARCH_QUERY, PRODUCT_VARIANTS_QUERY, toProductSearch } from "@/lib/returnsAdmin";

export const dynamic = "force-dynamic";

type V = { id: string; title: string; sku: string | null; price: string; inventoryQuantity: number | null; availableForSale: boolean };
type P = {
  id: string;
  title: string;
  vendor: string | null;
  featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  variants: { nodes: V[] };
};

function shape(p: P) {
  return {
    id: p.id,
    title: p.title,
    vendor: p.vendor,
    imageUrl: p.featuredMedia?.preview?.image?.url ?? null,
    variants: p.variants.nodes.map((v) => ({ ...v, price: Number(v.price) })),
  };
}

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;
  const productId = req.nextUrl.searchParams.get("productId");
  const q = req.nextUrl.searchParams.get("q")?.trim();

  try {
    if (productId) {
      const data = await adminGraphql<{ product: P | null }>(PRODUCT_VARIANTS_QUERY, { id: productId });
      return NextResponse.json({ products: data.product ? [shape(data.product)] : [] });
    }
    if (q && q.length >= 2) {
      const data = await adminGraphql<{ products: { nodes: P[] } }>(PRODUCT_SEARCH_QUERY, { q: toProductSearch(q) });
      return NextResponse.json({ products: data.products.nodes.map(shape) });
    }
    return NextResponse.json({ products: [] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
