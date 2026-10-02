import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { SHOP_INTERESTS, SHOP_CONSENT_VERSION, EMAIL_CONSENT, SMS_CONSENT, normalizeSignupPhone } from "@/lib/shopSignup";
import { issueSignupReward } from "@/lib/shopSignupReward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const respond = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Capture consent and issue a single-use shop reward. No provider subscription,
 * outbound message or automation is triggered. */
export async function POST(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin) return respond({ error: "invalid_origin" }, 403);
  if (!req.headers.get("content-type")?.includes("application/json")) return respond({ error: "invalid_content_type" }, 415);
  if (Number(req.headers.get("content-length")) > 4096) return respond({ error: "too_large" }, 413);
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 4096) return respond({ error: "too_large" }, 413);
    body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch { return respond({ error: "invalid_request" }, 400); }
  if (body.company) return respond({ ok: true });
  const stage = body.stage;
  const source = body.source === "shop-newsletter" ? "shop-newsletter" : "shop-edit-popup";
  if (stage !== "email" && stage !== "sms") return respond({ error: "invalid_stage" }, 400);
  if (body.consent !== true) return respond({ error: "consent_required" }, 400);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const interest = SHOP_INTERESTS.find(item => item.id === body.interest)?.id;
  const phone = normalizeSignupPhone(body.phone);
  if (stage === "email" && (!interest || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
    return respond({ error: "invalid_email_or_interest" }, 400);
  if (stage === "sms" && (!phone || typeof body.receipt !== "string" || !/^[a-f0-9]{64}$/.test(body.receipt)))
    return respond({ error: "invalid_phone_or_receipt" }, 400);

  const now = Date.now();
  const windowKey = Math.floor(now / 600_000);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rate = adminDb.collection("shop_signup_rate_limits").doc(digest(`${ip}:${windowKey}`));
  const receipt = stage === "email" ? randomBytes(32).toString("hex") : String(body.receipt);
  const session = adminDb.collection("shop_signup_sessions").doc(digest(receipt));
  try {
    const leadId = await adminDb.runTransaction(async tx => {
      const limit = await tx.get(rate);
      if ((limit.data()?.count || 0) >= 12) throw new Error("rate_limited");
      const priorSession = stage === "sms" ? await tx.get(session) : null;
      if (stage === "sms" && (!priorSession?.exists || priorSession.data()?.expiresAtMs < now ||
        (priorSession.data()?.used && priorSession.data()?.phone !== phone)))
        throw new Error("expired_receipt");
      const id = stage === "email" ? digest(email) : priorSession!.data()!.leadId;
      const lead = adminDb.collection("shop_marketing_leads").doc(id);
      const existing = await tx.get(lead);
      const evidence = {
        channel: stage, granted: true, version: SHOP_CONSENT_VERSION,
        text: stage === "email" ? EMAIL_CONSENT : SMS_CONSENT,
        capturedAt: FieldValue.serverTimestamp(), source,
        userAgent: (req.headers.get("user-agent") || "").slice(0, 300),
      };
      tx.set(rate, { count: (limit.data()?.count || 0) + 1, expiresAt: new Date(now + 86400_000) });
      tx.set(lead, {
        ...(stage === "email" ? { email, interest, emailConsent: evidence } : { phone, smsConsent: evidence }),
        ...(!existing.exists ? { createdAt: FieldValue.serverTimestamp(), sendingStatus: "not_synced" } : {}),
        updatedAt: FieldValue.serverTimestamp(), source,
      }, { merge: true });
      tx.set(lead.collection("consent_events").doc(), {
        ...evidence, ...(stage === "email" ? { email, interest } : { phone }),
      });
      if (stage === "email") tx.set(session, { leadId: id, expiresAtMs: now + 1800_000, expiresAt: new Date(now + 1800_000), used: false });
      else tx.update(session, { used: true, phone });
      return id as string;
    });
    try {
      const reward = await issueSignupReward(leadId);
      return respond({ ok: true, reward, ...(stage === "email" ? { receipt } : {}) });
    } catch {
      // Consent has been saved. Retry reuses the same code/receipt rather than
      // losing consent or minting another reward after a Shopify timeout.
      return respond({ error: "reward_unavailable" }, 503);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason === "rate_limited") return respond({ error: reason }, 429);
    if (reason === "expired_receipt") return respond({ error: reason }, 403);
    // Never log email, phone, request bodies, consent receipts or provider errors.
    console.error("[shop-signup] storage unavailable");
    return respond({ error: "save_failed" }, 503);
  }
}
