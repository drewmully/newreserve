import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runSubscriptionRuntime } from "@/lib/analytics/subscriptionRuntime";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export async function POST(req: NextRequest) {
  if (process.env.LEAN_ANALYTICS_SUBSCRIPTIONS_ENABLED !== "true")
    return new NextResponse(null, { status: 404, headers });
  const secret = process.env.LEAN_ANALYTICS_SUBSCRIPTIONS_SECRET ?? "";
  if (secret.length < 32 || secret.length > 512) return new NextResponse(null, { status: 503, headers });
  const a = Buffer.from(`Bearer ${secret}`), b = Buffer.from(req.headers.get("authorization") ?? "");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return new NextResponse(null, { status: 401, headers });
  if (req.nextUrl.search || req.body !== null || req.headers.has("transfer-encoding") ||
      req.headers.has("content-length") && req.headers.get("content-length") !== "0")
    return new NextResponse(null, { status: 400, headers });
  try { return NextResponse.json(await runSubscriptionRuntime({ signal: req.signal }), { headers }); }
  catch { return NextResponse.json({ state: "unavailable" }, { status: 503, headers }); }
}
