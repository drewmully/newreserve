import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsSupabase } from "@/lib/analytics/serverClient";
import { googleSpendAuthFromEnv } from "@/lib/analytics/googleSpendSource";
import { advanceGoogleSpendPilot } from "@/lib/analytics/googleSpendPilot";
export const runtime = "nodejs";
export const maxDuration = 90;
export async function POST(req: NextRequest) {
  if (process.env.LEAN_ANALYTICS_SPEND_PILOT_ENABLED !== "true") return new NextResponse(null, { status: 404 });
  const secret = process.env.LEAN_ANALYTICS_SPEND_PILOT_SECRET ?? "";
  if (secret.length < 32) return new NextResponse(null, { status: 503 });
  const expected = Buffer.from(`Bearer ${secret}`), supplied = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    return new NextResponse(null, { status: 401 });
  if (req.nextUrl.search || req.body !== null) return new NextResponse(null, { status: 400 });
  try {
    const result = await advanceGoogleSpendPilot({
      client: getAnalyticsSupabase(), projectRef: process.env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF ?? "",
      databaseUrl: process.env.LEAN_ANALYTICS_SUPABASE_URL ?? "",
      pilotId: process.env.LEAN_ANALYTICS_SPEND_PILOT_ID ?? "",
      auth: googleSpendAuthFromEnv(process.env), developerToken: process.env.LEAN_GOOGLE_ADS_DEVELOPER_TOKEN,
      now: new Date().toISOString(), signal: AbortSignal.any([req.signal, AbortSignal.timeout(65000)]),
    });
    return NextResponse.json(result, { status: ["failed", "blocked", "lost_lease"].includes(result.state) ? 422 : 200,
      headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ state: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
