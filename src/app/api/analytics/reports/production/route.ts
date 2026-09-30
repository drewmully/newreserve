import { productionReportGet } from "@/lib/analytics/productionReportDelivery";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return productionReportGet(req); }
