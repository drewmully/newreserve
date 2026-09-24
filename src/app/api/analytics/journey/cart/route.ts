import { NextRequest } from "next/server";
import { attachJourneyCart } from "@/lib/analytics/journeyRuntime";
import { journeyRequest, journeyResponse } from "@/lib/analytics/journeyRoute";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    const parsed = await journeyRequest(req, ["cartId"]);
    if (parsed.response) return parsed.response;
    await attachJourneyCart(req, parsed.body!.cartId, parsed.uid);
    // Do not expose grant existence, identity or permission through responses.
    return journeyResponse(204);
  } catch { return journeyResponse(400); }
}
