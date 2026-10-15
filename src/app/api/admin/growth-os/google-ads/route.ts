/**
 * POST /api/admin/growth-os/google-ads
 * Auth: Authorization: Bearer $GROWTH_OS_GOOGLE_SECRET (min 32 chars).
 * See src/lib/growthOs/googleAdsGateway.ts for the hard limits.
 */
import { NextRequest, NextResponse } from "next/server";
import { GatewayError, isAuthorized, parseRequest, runGateway } from "@/lib/growthOs/googleAdsGateway";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req.headers.get("authorization"), process.env)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const parsed = parseRequest(await req.json().catch(() => null), process.env);
    const result = await runGateway(parsed, process.env);
    console.info("growth-os google-ads", parsed.action, "ok");
    return NextResponse.json({ ok: true, action: parsed.action, result });
  } catch (e) {
    if (e instanceof GatewayError) {
      console.warn("growth-os google-ads", e.message);
      return NextResponse.json({ ok: false, error: e.message, detail: e.detail ?? null }, { status: e.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
