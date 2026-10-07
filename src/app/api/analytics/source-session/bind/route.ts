import { NextRequest } from "next/server";
import { sourceSessionRoute } from "@/lib/analytics/journeySourceSessionRoute";
export const runtime = "nodejs";
export async function POST(req: NextRequest) { return sourceSessionRoute(req, "bind"); }
