import { orderSizeReportGet } from "@/lib/analytics/orderSizeReportDelivery";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return orderSizeReportGet(req); }
