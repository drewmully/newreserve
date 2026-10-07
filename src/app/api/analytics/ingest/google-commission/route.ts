import { getAnalyticsSupabase } from "@/lib/analytics/serverClient";
import { googleCommissioningPost } from "@/lib/analytics/googleCommissioningRuntime";
export const runtime = "nodejs";
export const maxDuration = 90;
export async function POST(req: Request) {
  if (process.env.LEAN_GOOGLE_COMMISSION_ENABLED !== "true") return new Response(null, { status: 404 });
  try { return await googleCommissioningPost(req, process.env, getAnalyticsSupabase()); }
  catch { return Response.json({ state: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
