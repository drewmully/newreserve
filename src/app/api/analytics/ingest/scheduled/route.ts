import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runScheduledPipeline, scheduledPipelineConfig } from "../../../../../../scripts/analytics/scheduled-pipeline.mjs";
import { getAnalyticsSupabase } from "@/lib/analytics/serverClient";
import { runScheduledFinancialCheckpoint } from "@/lib/analytics/scheduledFinancialCheckpoint";
import { runScheduledPipelineCatchup } from "@/lib/analytics/scheduledPipelineCatchup";
import { readOrdinaryBatchAdmission, runOrdinaryPipelineBatch } from "@/lib/analytics/ordinaryPipelineBatch";

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
    const scheduleEnvironment = {
      ...process.env,
      LEAN_ANALYTICS_SCHEDULE_ENABLED: process.env.LEAN_ANALYTICS_VERCEL_SCHEDULE_ENABLED,
      LEAN_ANALYTICS_RUNNER_ORIGIN: process.env.LEAN_ANALYTICS_RUNNER_ORIGIN ?? "https://www.mymully.com",
    };
    // Reuse, rather than bypass or duplicate, the supervisor's fixed origin,
    // project/URL, process-secret and continuous-mode configuration checks.
    const prepared = scheduledPipelineConfig(scheduleEnvironment, admittedAt);
    if (prepared.state !== "ready")
      return NextResponse.json({ state: prepared.state, calls: 0 }, { status: 503, headers });
    // Read-only/default-off owner control, after all existing caller and source
    // identity gates. Never fall back after an unknown admission failure.
    const active = AbortSignal.any([req.signal, invocationDeadline]);
    let ordinary;
    try {
      ordinary = await readOrdinaryBatchAdmission(getAnalyticsSupabase(),
        AbortSignal.any([active, AbortSignal.timeout(5000)]));
    } catch {
      return NextResponse.json({ state: "capacity_unavailable", calls: 0 }, { status: 503, headers });
    }
    if (ordinary.state !== "off") {
      if (ordinary.state !== "ready")
        return NextResponse.json({ state: ordinary.state, calls: 0 }, { status: 503, headers });
      const batch = await runOrdinaryPipelineBatch({
        client: getAnalyticsSupabase(),
        projectRef: process.env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF ?? "",
        databaseUrl: process.env.LEAN_ANALYTICS_SUPABASE_URL ?? "",
        shop: process.env.LEAN_SHOPIFY_SHOP_DOMAIN ?? "",
        accessToken: process.env.LEAN_SHOPIFY_ANALYTICS_READ_TOKEN ?? "",
        admission: ordinary, signal: active, deadline: admittedAt + 80000,
      });
      const response = { ...batch, calls: 0 }; // No proxy POST/GET; native starts are separate.
      console.info(JSON.stringify({ event: "analytics_vercel_scheduled_invocation", ...response }));
      // The standing branch owns this invocation. Never also run EXTRA or the
      // optional financial lane, even after a settled failure or lost response.
      return NextResponse.json(response, {
        status: batch.state === "complete" || batch.state === "idle" ? 200 : 503, headers,
      });
    }
    const result = await runScheduledPipeline(scheduleEnvironment, { signal: active });
    // Commerce retains its cycle first. A separate owner-bound financial lane
    // may then use spare time despite backlog, never alongside it in this
    // invocation. Health is an observation, not a cross-worker source lock.
    let financialCheckpoint: { state: string; calls?: number } | undefined;
    const admission = result.financialAdmission;
    const health = admission?.health;
    const validHealth = health?.enabled === true &&
      ["pending", "leased", "dead", "done", "expiredLeases"].every(key =>
        Number.isSafeInteger(health[key]) && health[key] >= 0) &&
      Number.isFinite(health.oldestPendingSeconds) && health.oldestPendingSeconds >= 0 &&
      health.leased === 0 && health.dead === 0 && health.expiredLeases === 0;
    const idle = result.state === "idle" && admission?.phase === "idle" && health?.pending === 0;
    const completedCycle = admission?.phase === "post_cycle" &&
      ["done", "excluded", "idle"].includes(admission.postState) &&
      (result.state === "complete" || (result.state === "unhealthy" &&
        health?.pending > 0 && health.oldestPendingSeconds >= 900));
    let catchup: Awaited<ReturnType<typeof runScheduledPipelineCatchup>> | undefined;
    if (validHealth && completedCycle && health.pending > 0) {
      try {
        catchup = await runScheduledPipelineCatchup({
          client: getAnalyticsSupabase(),
          projectRef: process.env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF ?? "",
          databaseUrl: process.env.LEAN_ANALYTICS_SUPABASE_URL ?? "",
          shop: process.env.LEAN_SHOPIFY_SHOP_DOMAIN ?? "",
          accessToken: process.env.LEAN_SHOPIFY_ANALYTICS_READ_TOKEN ?? "",
          deadline: admittedAt + 180000, signal: AbortSignal.any([req.signal, invocationDeadline]),
        });
      } catch { catchup = { state: "held", extraClaims: 0, exclusions: 0,
        retainedSourceSteps: 0, nativeHydrations: 0, nativeRequests: 0 }; }
    }
    // A separately approved throughput grant owns this invocation's spare
    // capacity. Never run the optional financial lane alongside a burst/hold.
    if ((!catchup || catchup.state === "off") && validHealth && (idle || completedCycle)) {
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
    const response = { ...result, ...(catchup ? { catchup } : {}),
      ...(financialCheckpoint ? { financialCheckpoint } : {}) };
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
