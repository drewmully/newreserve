import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsSupabase } from "@/lib/analytics/serverClient";
import { pipelineRpc, runShopifyPipeline, validatePipelineTarget } from "@/lib/analytics/shopifyPipeline";

export const runtime = "nodejs";
export const maxDuration = 90;
function configuration(req: NextRequest) {
  if (process.env.LEAN_ANALYTICS_PIPELINE_ENABLED !== "true")
    return new NextResponse(null, { status: 404 });
  const secret = process.env.LEAN_ANALYTICS_PIPELINE_SECRET ?? "";
  if (secret.length < 32) return new NextResponse(null, { status: 503 });
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    return new NextResponse(null, { status: 401 });
  // Neither scope, policy, target nor order can be changed by an HTTP caller.
  if (req.nextUrl.search) return new NextResponse(null, { status: 400 });
  const projectRef = process.env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF ?? "";
  const databaseUrl = process.env.LEAN_ANALYTICS_SUPABASE_URL ?? "";
  validatePipelineTarget(projectRef, databaseUrl);
  return { projectRef, databaseUrl, shop: process.env.LEAN_SHOPIFY_SHOP_DOMAIN ?? "",
    accessToken: process.env.LEAN_SHOPIFY_ANALYTICS_READ_TOKEN ?? "" };
}
export async function POST(req: NextRequest) {
  try {
    const config = configuration(req);
    if (config instanceof NextResponse) return config;
    const result = await runShopifyPipeline({ ...config, client: getAnalyticsSupabase() });
    return NextResponse.json(result, { status: result.state === "failed" ? 422 :
      result.state === "lost_lease" ? 409 : 200 });
  } catch { return NextResponse.json({ state: "unavailable" }, { status: 503 }); }
}
/** Counts only: no payloads, catalog policy, customer IDs or credentials. */
export async function GET(req: NextRequest) {
  try {
    const config = configuration(req);
    if (config instanceof NextResponse) return config;
    const data = await pipelineRpc(getAnalyticsSupabase(), "lean_pipeline_health", {
      p_project_ref: config.projectRef, p_shop: config.shop,
    });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ state: "unavailable" }, { status: 503 }); }
}
