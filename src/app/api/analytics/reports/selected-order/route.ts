import { selectedOrderGet } from "@/lib/analytics/selectedOrderDelivery";
export const runtime = "nodejs";
export async function GET(req: Request) { return selectedOrderGet(req); }
