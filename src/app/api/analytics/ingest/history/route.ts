import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsSupabase } from "@/lib/analytics/serverClient";
import { runHistoryJob } from "@/lib/analytics/historyJob";

export const runtime = "nodejs";
export const maxDuration = 90;
export async function POST(req: NextRequest) {
  if (process.env.LEAN_ANALYTICS_HISTORY_ENABLED !== "true") return new NextResponse(null, { status: 404 });
  const secret = process.env.LEAN_ANALYTICS_HISTORY_SECRET ?? "";
  if (secret.length < 32) return new NextResponse(null, { status: 503 });
  const expected = Buffer.from(`Bearer ${secret}`), supplied = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    return new NextResponse(null, { status: 401 });
  // No request-supplied scope; even a valid caller cannot raise the saved budget.
  if (req.nextUrl.search || req.body !== null) return new NextResponse(null, { status: 400 });
  try {
    const result = await runHistoryJob({
      client: getAnalyticsSupabase(),
      projectRef: process.env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF ?? "",
      databaseUrl: process.env.LEAN_ANALYTICS_SUPABASE_URL ?? "",
      shop: process.env.LEAN_SHOPIFY_SHOP_DOMAIN ?? "",
      runId: process.env.LEAN_ANALYTICS_HISTORY_RUN_ID ?? "",
      accessToken: process.env.LEAN_SHOPIFY_ANALYTICS_READ_TOKEN ?? "",
      now: new Date().toISOString(), signal: AbortSignal.timeout(65000),
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ state: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
