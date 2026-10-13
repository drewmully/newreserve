/**
 * GET /api/admin/returns/variants?productId=gid://...   → that product's sizes
 * GET /api/admin/returns/variants?q=polo                → search any variant
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_lib/adminAuth";
import { adminGraphql, PRODUCT_VARIANTS_QUERY, VARIANT_SEARCH_QUERY } from "@/lib/returnsAdmin";

export const dynamic = "force-dynamic";

type V = { id: string; title: string; sku: string | null; price: string; inventoryQuantity: number | null; availableForSale: boolean };

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;
  const productId = req.nextUrl.searchParams.get("productId");
  const q = req.nextUrl.searchParams.get("q")?.trim();

  try {
    if (productId) {
      const data = await adminGraphql<{ product: { id: string; title: string; variants: { nodes: V[] } } | null }>(
        PRODUCT_VARIANTS_QUERY,
        { id: productId },
      );
      const p = data.product;
      return NextResponse.json({
        variants: (p?.variants.nodes ?? []).map((v) => ({ ...v, productTitle: p!.title })),
      });
    }
    if (q && q.length >= 2) {
      const data = await adminGraphql<{
        productVariants: { nodes: (V & { product: { id: string; title: string; status: string } })[] };
      }>(VARIANT_SEARCH_QUERY, { q: `${q} AND product_status:active` });
      return NextResponse.json({
        variants: data.productVariants.nodes.map(({ product, ...v }) => ({ ...v, productTitle: product.title })),
      });
    }
    return NextResponse.json({ variants: [] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
