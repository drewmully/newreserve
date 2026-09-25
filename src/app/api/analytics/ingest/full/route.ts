import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsSupabase } from "@/lib/analytics/serverClient";
import { runFullPipeline } from "@/lib/analytics/fullPipeline";
import { googleSpendAuthFromEnv } from "@/lib/analytics/googleSpendSource";
export const runtime = "nodejs";
export const maxDuration = 90;
export async function POST(req: NextRequest) {
  if (process.env.LEAN_ANALYTICS_FULL_ENABLED !== "true") return new NextResponse(null, { status: 404 });
  const secret = process.env.LEAN_ANALYTICS_FULL_SECRET ?? "";
  if (secret.length < 32) return new NextResponse(null, { status: 503 });
  const expected = Buffer.from(`Bearer ${secret}`), supplied = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    return new NextResponse(null, { status: 401 });
  if (req.nextUrl.search || req.body !== null) return new NextResponse(null, { status: 400 });
  try {
    const result = await runFullPipeline({
      client: getAnalyticsSupabase(), projectRef: process.env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF ?? "",
      databaseUrl: process.env.LEAN_ANALYTICS_SUPABASE_URL ?? "",
      runId: process.env.LEAN_ANALYTICS_FULL_RUN_ID ?? "",
      posthogKey: process.env.LEAN_POSTHOG_QUERY_READ_KEY ?? "",
      shop: process.env.LEAN_SHOPIFY_SHOP_DOMAIN ?? "",
      shopifyToken: process.env.LEAN_SHOPIFY_ANALYTICS_READ_TOKEN ?? "",
      googleClientId: process.env.LEAN_GOOGLE_ADS_OAUTH_CLIENT_ID ?? "",
      googleClientSecret: process.env.LEAN_GOOGLE_ADS_OAUTH_CLIENT_SECRET ?? "",
      googleRefreshToken: process.env.LEAN_GOOGLE_ADS_REFRESH_TOKEN ?? "",
      googleAuth: googleSpendAuthFromEnv(process.env),
      googleDeveloperToken: process.env.LEAN_GOOGLE_ADS_DEVELOPER_TOKEN,
      now: new Date().toISOString(),
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ state: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
