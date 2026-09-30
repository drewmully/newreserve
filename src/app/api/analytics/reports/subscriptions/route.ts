import { subscriptionReportGet } from "@/lib/analytics/subscriptionReportDelivery";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return subscriptionReportGet(req); }
