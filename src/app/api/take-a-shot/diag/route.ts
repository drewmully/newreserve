/**
 * GET /api/take-a-shot/diag. Preview-only check of which Shopify token can
 * write discounts. Returns presence, app title and scope per token source;
 * never token values. 404 in production.
 */
import { NextResponse } from "next/server";
import { probeDiscountTokens } from "@/lib/takeAShot/discountToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.VERCEL_ENV === "production") return NextResponse.json({ error: "not_found" }, { status: 404 });
  const sources = await probeDiscountTokens();
  return NextResponse.json({ sources }, { headers: { "Cache-Control": "no-store" } });
}
