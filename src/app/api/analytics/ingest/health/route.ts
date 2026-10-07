import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsSupabase } from "@/lib/analytics/serverClient";
import { pipelineRpc, validatePipelineTarget } from "@/lib/analytics/shopifyPipeline";
import { shopifyShop, sourceObject } from "@/lib/analytics/shopifySource";
import { googleStandingBinding } from "@/lib/analytics/googleStandingBinding";
export const runtime = "nodejs";
export const maxDuration = 15;
/** Separate read-only monitor credential. No request-supplied project/shop,
 * customer rows, queue mutation, source calls, retries or alert delivery.
 */
export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  if (process.env.LEAN_ANALYTICS_MONITOR_ENABLED !== "true") return new NextResponse(null, { status: 404, headers });
  const secret = process.env.LEAN_ANALYTICS_MONITOR_SECRET ?? "";
  if (secret.length < 32) return new NextResponse(null, { status: 503, headers });
  const expected = Buffer.from(`Bearer ${secret}`), supplied = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    return new NextResponse(null, { status: 401, headers });
  if (req.nextUrl.search || req.body !== null) return new NextResponse(null, { status: 400, headers });
  try {
    const project = process.env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF ?? "";
    validatePipelineTarget(project, process.env.LEAN_ANALYTICS_SUPABASE_URL ?? "");
    const shop = shopifyShop(process.env.LEAN_SHOPIFY_SHOP_DOMAIN ?? "");
    const result = sourceObject(await pipelineRpc(getAnalyticsSupabase(), "lean_refresh_health",
      { p_project_ref: project, p_shop: shop }));
    if (!["healthy", "attention", "disabled", "unconfigured"].includes(String(result.state)) || !Array.isArray(result.issues))
      throw new Error("invalid_health_response");
    if (process.env.LEAN_GOOGLE_STANDING_ENABLED === "true") {
      const policy = googleStandingBinding(process.env);
      const google = sourceObject(await pipelineRpc(getAnalyticsSupabase(), "lean_google_standing_health",
        { p_project_ref: project, p_policy: policy.policy, p_revision: policy.revision }));
      if (!["healthy", "attention"].includes(String(google.state)) || !Array.isArray(google.issues) ||
        google.issues.some(x => typeof x !== "string" || !/^google_[a-z_]+$/.test(x)) ||
        typeof google.googleImportAcceptanceVerified !== "boolean" ||
        (google.state === "healthy") !== (google.issues.length === 0 && google.googleImportAcceptanceVerified === true))
        throw new Error("google_health_response");
      result.issues = [...new Set([...result.issues, ...google.issues])].sort();
      if (google.state !== "healthy") result.state = "attention";
      result.googleImportAcceptanceVerified = google.googleImportAcceptanceVerified;
      // Existing five-domain and actual live-provider claims are not promoted.
      result.posthogReadbackVerified = false;
    }
    return NextResponse.json(result, { status: result.state === "healthy" ? 200 : 503, headers });
  } catch {
    return NextResponse.json({ state: "unavailable" }, { status: 503, headers });
  }
}
