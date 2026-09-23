import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsSupabase } from "@/lib/analytics/serverClient";
import { runGoogleSpendJob } from "@/lib/analytics/googleSpendJob";
export const runtime = "nodejs";
export const maxDuration = 90;
export async function POST(req: NextRequest) {
  if (process.env.LEAN_ANALYTICS_SPEND_ENABLED !== "true") return new NextResponse(null, { status: 404 });
  const secret = process.env.LEAN_ANALYTICS_SPEND_SECRET ?? "";
  if (secret.length < 32) return new NextResponse(null, { status: 503 });
  const expected = Buffer.from(`Bearer ${secret}`), supplied = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    return new NextResponse(null, { status: 401 });
  if (req.nextUrl.search || req.body !== null) return new NextResponse(null, { status: 400 });
  try {
    const result = await runGoogleSpendJob({
      client: getAnalyticsSupabase(), projectRef: process.env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF ?? "",
      databaseUrl: process.env.LEAN_ANALYTICS_SUPABASE_URL ?? "",
      runId: process.env.LEAN_ANALYTICS_SPEND_RUN_ID ?? "",
      clientId: process.env.LEAN_GOOGLE_ADS_OAUTH_CLIENT_ID ?? "",
      clientSecret: process.env.LEAN_GOOGLE_ADS_OAUTH_CLIENT_SECRET ?? "",
      refreshToken: process.env.LEAN_GOOGLE_ADS_REFRESH_TOKEN ?? "",
      now: new Date().toISOString(), signal: AbortSignal.timeout(65000),
    });
    return NextResponse.json(result, { status: result.state === "failed" ? 422 : 200,
      headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ state: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
