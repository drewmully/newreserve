import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsSupabase } from "@/lib/analytics/serverClient";
import { runShopifyPilot, validatePilotTarget } from "@/lib/analytics/shopifyPilotRunner";

export const runtime = "nodejs";
export const maxDuration = 90;
/** Disabled by default, manual-only. The URL identifies an operator-registered
 * immutable run, not a user-supplied shop, SQL statement, policy, or order.
 */
export async function POST(req: NextRequest) {
  if (process.env.LEAN_ANALYTICS_PILOT_ENABLED !== "true") return new NextResponse(null, { status: 404 });
  const secret = process.env.LEAN_ANALYTICS_PILOT_RUNNER_SECRET ?? "";
  if (secret.length < 32 || process.env.LEAN_ANALYTICS_ENVIRONMENT !== "isolated-test")
    return new NextResponse(null, { status: 503 });
  const supplied = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    return new NextResponse(null, { status: 401 });
  const runId = req.nextUrl.searchParams.get("run_id") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(runId))
    return new NextResponse(null, { status: 400 });
  try {
    const projectRef = process.env.LEAN_ANALYTICS_PILOT_PROJECT_REF ?? "";
    const databaseUrl = process.env.LEAN_ANALYTICS_SUPABASE_URL ?? "";
    validatePilotTarget(projectRef, databaseUrl);
    const result = await runShopifyPilot({ client: getAnalyticsSupabase(), runId, projectRef, databaseUrl,
      shop: process.env.LEAN_SHOPIFY_SHOP_DOMAIN ?? "",
      accessToken: process.env.LEAN_SHOPIFY_ANALYTICS_READ_TOKEN ?? "" });
    return NextResponse.json(result, { status: result.state === "done" ? 200 :
      result.state === "busy" || result.state === "lost_lease" ? 409 : 422 });
  } catch { return NextResponse.json({ state: "unavailable" }, { status: 503 }); }
}
