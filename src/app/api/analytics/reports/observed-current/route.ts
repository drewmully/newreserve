import { productionObservedDeliveryGet } from "@/lib/analytics/productionObservedDelivery";
export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return productionObservedDeliveryGet(req); }
