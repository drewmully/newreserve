import { marketingCron, marketingCronAuthorized } from "@/lib/analytics/marketingSourceRefresh";
import { marketingSourceServer } from "@/lib/analytics/marketingSourceServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  if (!marketingCronAuthorized(request, process.env))
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const { provider } = await context.params;
    const r = marketingSourceServer();
    const result = await marketingCron(request, provider, r);
    return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "marketing_source_unavailable" }, { status: 503 });
  }
}
