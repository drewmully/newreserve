import { getAnalyticsSupabase } from "@/lib/analytics/serverClient";
import { googleAutomaticPost } from "@/lib/analytics/googleAutomaticRuntime";
export const runtime = "nodejs";
export const maxDuration = 90;
export async function POST(req: Request) {
  if (process.env.LEAN_GOOGLE_AUTOMATIC_ENABLED !== "true") return new Response(null, { status: 404 });
  try { return await googleAutomaticPost(req, process.env, getAnalyticsSupabase()); }
  catch { return Response.json({ state: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
