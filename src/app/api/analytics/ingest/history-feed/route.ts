import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsSupabase } from "@/lib/analytics/serverClient";
import { runHistoryFeed } from "@/lib/analytics/historyFeed";
export const runtime = "nodejs";
export const maxDuration = 90;
export async function POST(req: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  if (process.env.LEAN_ANALYTICS_HISTORY_FEED_ENABLED !== "true")
    return new NextResponse(null, { status: 404, headers });
  const secret = process.env.LEAN_ANALYTICS_HISTORY_FEED_SECRET ?? "";
  if (secret.length < 32) return new NextResponse(null, { status: 503, headers });
  const expected = Buffer.from(`Bearer ${secret}`), supplied = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    return new NextResponse(null, { status: 401, headers });
  if (req.nextUrl.search || req.body !== null) return new NextResponse(null, { status: 400, headers });
  try {
    return NextResponse.json(await runHistoryFeed({
      client: getAnalyticsSupabase(), projectRef: process.env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF ?? "",
      databaseUrl: process.env.LEAN_ANALYTICS_SUPABASE_URL ?? "",
      shop: process.env.LEAN_SHOPIFY_SHOP_DOMAIN ?? "",
      feedId: process.env.LEAN_ANALYTICS_HISTORY_FEED_ID ?? "",
      accessToken: process.env.LEAN_SHOPIFY_ANALYTICS_READ_TOKEN ?? "",
      now: new Date().toISOString(), signal: AbortSignal.timeout(65000),
    }), { headers });
  } catch { return NextResponse.json({ state: "unavailable" }, { status: 503, headers }); }
}
