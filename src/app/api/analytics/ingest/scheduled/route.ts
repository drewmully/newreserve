import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runScheduledPipeline } from "../../../../../../scripts/analytics/scheduled-pipeline.mjs";
import { getAnalyticsSupabase } from "@/lib/analytics/serverClient";
import { runScheduledFinancialCheckpoint } from "@/lib/analytics/scheduledFinancialCheckpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Existing supervisor has one shared180s deadline; allow time for the response.
export const maxDuration = 240;
const headers = { "Cache-Control": "no-store" };
// Same-isolate protection only. Database leases remain the cross-instance fence.
let running = false;

/** No schedule is installed by this route. Never processes subscriptions.
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
  if (req.method !== "GET") return new NextResponse(null, { status: 405, headers });
  if (req.nextUrl.search || req.body !== null || req.headers.has("transfer-encoding") ||
      (req.headers.has("content-length") && req.headers.get("content-length") !== "0"))
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
    const admittedAt = Date.now();
    const invocationDeadline = AbortSignal.timeout(180000);
    const result = await runScheduledPipeline({
      ...process.env,
      LEAN_ANALYTICS_SCHEDULE_ENABLED: process.env.LEAN_ANALYTICS_VERCEL_SCHEDULE_ENABLED,
      LEAN_ANALYTICS_RUNNER_ORIGIN: process.env.LEAN_ANALYTICS_RUNNER_ORIGIN ?? "https://www.mymully.com",
    }, { signal: AbortSignal.any([req.signal, invocationDeadline]) });
    // A separate empty-by-default DB binding can admit one finite financial
    // read using the existing native token. Never compete with commerce work.
    let financialCheckpoint: { state: string; calls?: number } | undefined;
    if (result.state === "idle") {
      if (invocationDeadline.aborted || Date.now() - admittedAt > 110000) {
        financialCheckpoint = { state: "deadline", calls: 0 };
      } else try {
        financialCheckpoint = await runScheduledFinancialCheckpoint({
          client: getAnalyticsSupabase(),
          projectRef: process.env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF ?? "",
          databaseUrl: process.env.LEAN_ANALYTICS_SUPABASE_URL ?? "",
          shop: process.env.LEAN_SHOPIFY_SHOP_DOMAIN ?? "",
          accessToken: process.env.LEAN_SHOPIFY_ANALYTICS_READ_TOKEN ?? "",
          now: new Date().toISOString(), signal: AbortSignal.any([req.signal, invocationDeadline]),
        });
      } catch { financialCheckpoint = { state: "unavailable" }; }
    }
    const response = { ...result, ...(financialCheckpoint ? { financialCheckpoint } : {}) };
    // Only the existing supervisor's aggregate state/counts are returned.
    // "complete" means one bounded invocation ended, not a report was published.
    console.info(JSON.stringify({ event: "analytics_vercel_scheduled_invocation", ...response }));
    return NextResponse.json(response, {
      status: result.state === "idle" || result.state === "complete" ? 200 : 503, headers,
    });
  } catch {
    console.info(JSON.stringify({ event: "analytics_vercel_scheduled_invocation", state: "unavailable" }));
    return NextResponse.json({ state: "unavailable" }, { status: 503, headers });
  } finally {
    running = false;
  }
}
