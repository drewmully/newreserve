import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runScheduledPipeline } from "../../../../../../scripts/analytics/scheduled-pipeline.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Existing supervisor has one shared180s deadline; allow time for the response.
export const maxDuration = 240;
const headers = { "Cache-Control": "no-store" };
// Same-isolate protection only. Database leases remain the cross-instance fence.
let running = false;

/** No schedule is installed by this route. Commerce only; never subscriptions.
 * Existing /ingest/process GET remains read-only health. */
export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV !== "production" ||
      process.env.LEAN_ANALYTICS_VERCEL_SCHEDULE_ENABLED !== "true")
    return new NextResponse(null, { status: 404, headers });
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16) return new NextResponse(null, { status: 503, headers });
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    return new NextResponse(null, { status: 401, headers });
  if (req.nextUrl.search || req.body !== null)
    return new NextResponse(null, { status: 400, headers });
  // This fallback is exclusively for an explicitly configured standing scope.
  // Its opt-in maps to the existing supervisor's schedule admission switch.
  if (process.env.LEAN_ANALYTICS_PIPELINE_ENABLED !== "true" ||
      process.env.LEAN_ANALYTICS_DISPATCH_ENABLED !== "true" ||
      process.env.LEAN_ANALYTICS_SCHEDULE_MODE !== "continuous")
    return new NextResponse(null, { status: 503, headers });
  if (running) return NextResponse.json({ state: "busy" }, { status: 409, headers });
  running = true;
  try {
    const result = await runScheduledPipeline({
      ...process.env,
      LEAN_ANALYTICS_SCHEDULE_ENABLED: process.env.LEAN_ANALYTICS_VERCEL_SCHEDULE_ENABLED,
      LEAN_ANALYTICS_RUNNER_ORIGIN: process.env.LEAN_ANALYTICS_RUNNER_ORIGIN ?? "https://www.mymully.com",
    }, { signal: req.signal });
    // Only the existing supervisor's aggregate state/counts are returned.
    // "complete" means one bounded invocation ended, not a report was published.
    console.info(JSON.stringify({ event: "analytics_vercel_scheduled_invocation", ...result }));
    return NextResponse.json(result, {
      status: result.state === "idle" || result.state === "complete" ? 200 : 503, headers,
    });
  } catch {
    console.info(JSON.stringify({ event: "analytics_vercel_scheduled_invocation", state: "unavailable" }));
    return NextResponse.json({ state: "unavailable" }, { status: 503, headers });
  } finally {
    running = false;
  }
}
