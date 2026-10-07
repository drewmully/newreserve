import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/app/api/_lib/clientIp";
import { productionJourneyBase, reserveRuntime } from "./journeyPolicyRuntime";
import { resolveJourneyRuntime, isReserveCartRuntime } from "./journeyCheckoutPolicy";
import { journeyDefaults } from "./journeyRuntime";
export const journeyResponse = (status: number) =>
  new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });
/** Shared fail-closed request boundary for auxiliary first-party endpoints. */
export async function journeyRequest(req: NextRequest, fields: string[], permitWithdrawal = false, permitCartPolicy = false) {
  const dbCart = permitCartPolicy && process.env.LEAN_ANALYTICS_JOURNEYS_ENABLED !== "true" &&
    productionJourneyBase(process.env);
  if (process.env.LEAN_ANALYTICS_JOURNEYS_ENABLED !== "true" && !permitWithdrawal && !dbCart)
    return { response: journeyResponse(404) };
  const dbDecision = permitWithdrawal && process.env.LEAN_ANALYTICS_JOURNEYS_ENABLED !== "true" &&
    productionJourneyBase(process.env);
  const origin = dbDecision || dbCart ? reserveRuntime.origin : process.env.LEAN_ANALYTICS_SITE_ORIGIN;
  if (!origin || !origin.startsWith("https://") || req.headers.get("origin") !== origin || req.nextUrl.origin !== origin)
    return { response: journeyResponse(403) };
  if (!checkRateLimit("lean_journey", getClientIp(req.headers) ?? "unknown", { maxHits: 60, windowMs: 60000 }).allowed)
    return { response: journeyResponse(429) };
  const reader = req.body?.getReader(); if (!reader) return { response: journeyResponse(400) };
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 1024) { await reader.cancel(); return { response: journeyResponse(413) }; }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return { response: journeyResponse(400) }; }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(k => !fields.includes(k)))
    return { response: journeyResponse(400) };
  if (dbCart && !isReserveCartRuntime(await resolveJourneyRuntime(journeyDefaults())))
    return { response: journeyResponse(404) };
  if (process.env.LEAN_ANALYTICS_JOURNEYS_ENABLED !== "true" && !dbDecision && !dbCart &&
    (body as Record<string, unknown>).decision !== "withdraw") return { response: journeyResponse(404) };
  let uid: string | undefined;
  const bearer = req.headers.get("authorization");
  if (bearer) {
    if (!bearer.startsWith("Bearer ")) return { response: journeyResponse(401) };
    try { uid = (await adminAuth.verifyIdToken(bearer.slice(7), true)).uid; }
    catch { return { response: journeyResponse(401) }; }
  }
  return { body: body as Record<string, unknown>, uid };
}
