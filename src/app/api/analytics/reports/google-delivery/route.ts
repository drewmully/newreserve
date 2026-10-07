import { googleDeliveryGet } from "@/lib/analytics/googleDeliveryRuntime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return googleDeliveryGet(req); }
