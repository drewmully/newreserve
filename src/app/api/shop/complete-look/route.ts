/**
 * GET /api/shop/complete-look?slugs=handle-a,handle-b
 *
 * Cart data for the `pdp_complete_look` test arm:
 *   eligible   which bag products are in Shop — All (tag "shop"), i.e. the
 *              BOGO15 buy/get collection
 *   pairings   live pairing items for any test vest in the bag
 *   fallbacks  live gift guide fallback items, in list order
 *
 * Each product is read by handle, so eligibility is not limited by the
 * 50-product collection page size.
 */

import { NextRequest, NextResponse } from "next/server";
import { COMPLETE_LOOK_PAIRINGS, type LookItem } from "@/lib/pdpCompleteLook";
import { completeLookFallbackHandles, loadLookItem } from "@/lib/pdpCompleteLookServer";
import { getProductByHandle } from "@/lib/shopify";

export const revalidate = 300;

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,120}$/;

export async function GET(req: NextRequest) {
  const slugs = (req.nextUrl.searchParams.get("slugs") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => HANDLE_RE.test(s))
    .slice(0, 20);
  try {
    const eligibleEntries = await Promise.all(
      slugs.map(async (slug) => {
        const product = await getProductByHandle(slug).catch(() => null);
        return [slug, !!product?.tags?.includes("shop")] as const;
      })
    );
    const vests = slugs.filter((s) => COMPLETE_LOOK_PAIRINGS[s]);
    const pairingEntries = await Promise.all(
      vests.map(async (vest) => [vest, await Promise.all(COMPLETE_LOOK_PAIRINGS[vest].map(loadLookItem))] as const)
    );
    const fallbacks = (await Promise.all(completeLookFallbackHandles().map(loadLookItem)))
      .filter((i): i is LookItem => i !== null);
    return NextResponse.json(
      {
        eligible: Object.fromEntries(eligibleEntries),
        pairings: Object.fromEntries(pairingEntries),
        fallbacks,
      },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
    );
  } catch (err) {
    console.error("[complete-look] cart data failed:", err);
    // The cart works without it; the test line just stays hidden.
    return NextResponse.json({ eligible: {}, pairings: {}, fallbacks: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
