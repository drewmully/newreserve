import { observedReportGet } from "@/lib/analytics/observedReportDelivery";
export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return observedReportGet(req); }
