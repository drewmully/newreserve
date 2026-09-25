import { NextRequest, NextResponse } from "next/server";
import { journeyRequest, journeyResponse } from "@/lib/analytics/journeyRoute";
import { decideJourney, journeyCookieName } from "@/lib/analytics/journeyDecision";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  try {
    const parsed = await journeyRequest(req, ["decision"], true);
    if (parsed.response) return parsed.response;
    if (!["allow", "withdraw"].includes(String(parsed.body?.decision))) return journeyResponse(400);
    const decision = await decideJourney(req, parsed.body!.decision as "allow" | "withdraw", parsed.uid);
    const response = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    response.cookies.set(journeyCookieName, decision.token, {
      secure: true, httpOnly: true, sameSite: "strict", path: "/", maxAge: decision.maxAge,
    });
    return response;
  } catch { return journeyResponse(503); }
}
