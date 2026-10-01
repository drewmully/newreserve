import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runScheduledSubscriptions } from "../../../../../../scripts/analytics/scheduled-subscriptions.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // Existing helper caps one request at90s or window expiry.
const headers = { "Cache-Control": "no-store" };
// Independent of commerce and only protective within this isolate.
let running = false;

/** No schedule, plan registration, source permit or automatic retry is added. */
export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV !== "production" ||
      process.env.LEAN_SUBSCRIPTIONS_VERCEL_SCHEDULE_ENABLED !== "true")
    return new NextResponse(null, { status: 404, headers });
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16) return new NextResponse(null, { status: 503, headers });
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    return new NextResponse(null, { status: 401, headers });
  if (req.method !== "GET") return new NextResponse(null, { status: 405, headers });
  if (req.nextUrl.search || req.body !== null || req.headers.has("transfer-encoding") ||
      (req.headers.has("content-length") && req.headers.get("content-length") !== "0"))
    return new NextResponse(null, { status: 400, headers });
  if (process.env.LEAN_ANALYTICS_SUBSCRIPTIONS_ENABLED !== "true" ||
      process.env.LEAN_SUBSCRIPTIONS_DISPATCH_ENABLED !== "true")
    return new NextResponse(null, { status: 503, headers });
  if (running) return NextResponse.json({ state: "busy" }, { status: 409, headers });
  running = true;
  try {
    const result = await runScheduledSubscriptions({
      ...process.env,
      LEAN_SUBSCRIPTIONS_SCHEDULE_ENABLED: process.env.LEAN_SUBSCRIPTIONS_VERCEL_SCHEDULE_ENABLED,
      LEAN_ANALYTICS_RUNNER_ORIGIN: process.env.LEAN_ANALYTICS_RUNNER_ORIGIN ?? "https://www.mymully.com",
    }, { signal: req.signal });
    console.info(JSON.stringify({ event: "analytics_vercel_subscription_invocation", ...result }));
    const allowed = ["disabled", "not_started", "expired", "waiting", "busy",
      "completed", "complete", "observation_saved"];
    return NextResponse.json(result, { status: allowed.includes(result.state) ? 200 : 503, headers });
  } catch {
    console.info(JSON.stringify({ event: "analytics_vercel_subscription_invocation", state: "unavailable" }));
    return NextResponse.json({ state: "unavailable" }, { status: 503, headers });
  } finally {
    running = false;
  }
}
