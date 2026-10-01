import { productionWorkbookRuntimeGet } from "@/lib/analytics/productionWorkbookRuntime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return productionWorkbookRuntimeGet(req); }
