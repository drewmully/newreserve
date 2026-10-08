import { savedMarketingGet } from "@/lib/analytics/savedMarketingRuntime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return savedMarketingGet(req); }
