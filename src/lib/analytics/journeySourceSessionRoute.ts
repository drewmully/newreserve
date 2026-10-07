import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/app/api/_lib/clientIp";
import { journeyDefaults } from "./journeyRuntime";
import { attachSourceSessionCart, bindSourceSession, decideSourceSession, sourceSessionConfig,
  sourceSessionCookie, sourceSessionGrant, sourceSessionOrigin } from "./journeySourceSessionRuntime";
export type SourceSessionRoute = "decision" | "status" | "bind" | "cart";
const fields: Record<SourceSessionRoute, string[]> = { decision: ["decision", "policyVersion"], status: [], bind: ["nativeSessionId"], cart: ["nativeSessionId", "cartId"] };
const response = (status: number) => new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });
export async function sourceSessionRoute(req: NextRequest, action: SourceSessionRoute) {
  if (!sourceSessionOrigin(req)) return response(403);
  if (!checkRateLimit("lean_source_session", getClientIp(req.headers) ?? "unknown", { maxHits: 60, windowMs: 60000 }).allowed)
    return response(429);
  try {
    const reader = req.body?.getReader(); if (!reader) return response(400);
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.length;
        if (size > 1024) { await reader.cancel(); return response(413); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(k => !fields[action].includes(k)))
      return response(400);
    const r = journeyDefaults();
    if (action === "decision") {
      const choice = await decideSourceSession(req, body.decision, body.policyVersion, r);
      const result = NextResponse.json({ expiresAt: choice.expiresAt }, { headers: { "Cache-Control": "no-store" } });
      result.cookies.set(sourceSessionCookie, choice.token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: choice.maxAge });
      return result;
    }
    if (action === "status") {
      const p = await sourceSessionConfig(r), g = p ? await sourceSessionGrant(req, p, r) : null;
      return NextResponse.json({ active: !!g, expiresAt: g?.expiresAt ?? null }, { headers: { "Cache-Control": "no-store" } });
    }
    const saved = action === "bind" ? await bindSourceSession(req, body.nativeSessionId, r)
      : await attachSourceSessionCart(req, body.nativeSessionId, body.cartId, r);
    if (!saved) console.warn("[lean-source-session] auxiliary_receipt_unconfirmed");
    return response(saved ? 204 : 202); // 202 is explicitly not a retained receipt.
  } catch {
    return response(action === "decision" ? 503 : 400);
  }
}
