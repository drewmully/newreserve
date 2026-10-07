import { customerHistoryPost } from "@/lib/analytics/customerHistoryRuntime";

export const runtime = "nodejs";
export const maxDuration = 90;
export async function POST(req: Request) { return customerHistoryPost(req); }
