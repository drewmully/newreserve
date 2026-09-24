import { NextRequest } from "next/server";
import { captureJourney } from "@/lib/analytics/journeyRuntime";
import { journeyRequest, journeyResponse } from "@/lib/analytics/journeyRoute";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    const parsed = await journeyRequest(req, ["eventName", "actionId"]);
    if (parsed.response) return parsed.response;
    if (typeof parsed.body!.eventName !== "string") return journeyResponse(400);
    await captureJourney(req, parsed.body!.eventName, parsed.body!.actionId, parsed.uid);
    return journeyResponse(204);
  } catch { return journeyResponse(400); }
}
