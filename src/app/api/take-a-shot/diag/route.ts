/**
 * GET /api/take-a-shot/diag. Checks which Shopify token can write discounts.
 * Returns presence, app title and scope per token source; never token
 * values. Served only on *.vercel.app hosts, so mymully.com never exposes it.
 */
import { NextResponse } from "next/server";
import { probeDiscountTokens } from "@/lib/takeAShot/discountToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Every host header present must be a *.vercel.app host.
  const hosts = [req.headers.get("host"), req.headers.get("x-forwarded-host"), new URL(req.url).hostname]
    .filter((h): h is string => Boolean(h)).map((h) => h.split(":")[0].trim().toLowerCase());
  if (!hosts.length || !hosts.every((h) => h.endsWith(".vercel.app"))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const sources = await probeDiscountTokens();
  return NextResponse.json({ sources }, { headers: { "Cache-Control": "no-store" } });
}
