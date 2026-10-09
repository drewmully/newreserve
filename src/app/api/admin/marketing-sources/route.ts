import type { NextRequest } from "next/server";
import { requireAdmin } from "../../_lib/adminAuth";
import { marketingAdmin } from "@/lib/analytics/marketingSourceRefresh";
import { marketingSourceServer } from "@/lib/analytics/marketingSourceServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
async function handle(request: NextRequest) {
  const result = await marketingAdmin(request, async () => {
    const auth = await requireAdmin(request); return auth.ok ? { uid: auth.uid } : null;
  }, marketingSourceServer);
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
export const GET = handle;
export const POST = handle;
