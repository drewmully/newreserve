import { evidenceDigest } from "./evidenceIntake";
import type { FullBuildEvidence } from "./fullReportBuild";
import { verifyCheckoutContext } from "./checkout-context";
import { key, nyDate } from "./primitives";
import { shopifyId, shopifyShop, type ShopifyOrderDocument } from "./shopifySource";
export type JourneyReceipt = {
  cartToken: string; contextToken: string; capturedAt: string; subjectId: string;
  sessionId: string; posthogProject: string; validFrom: string; expiresAt: string;
  revokedAt: string | null; permissionEvidenceRef: string;
};
export type JourneySnapshot = {
  projectRef: string; shop: string; capturedAt: string; requestedCarts: string[];
  receipts: JourneyReceipt[]; digest: string;
};
export function orderCartTokens(orders: ShopifyOrderDocument[]) {
  if (orders.length > 100) throw new Error("journey_order_budget");
  return [...new Set(orders.flatMap(doc => {
    const value = doc.order.cartToken;
    if (value === null) return [];
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value))
      throw new Error("journey_cart_not_selected_or_invalid");
    return [value];
  }))].sort();
}
/** Fixed read-only RPC: no arbitrary table, filter, URL or SQL. Missing receipts
 * are allowed and remain missing, never substituted by email/identity matches. */
export async function readJourneyReceipts(config: {
  projectRef: string; shop: string; capturedAt: string; requestedCarts: string[];
}, readKey: string, request: typeof fetch = fetch): Promise<JourneySnapshot> {
  shopifyShop(config.shop); nyDate(config.capturedAt);
  if (!/^[a-z]{20}$/.test(config.projectRef) || !readKey.trim() || config.requestedCarts.length > 100 ||
      new Set(config.requestedCarts).size !== config.requestedCarts.length ||
      config.requestedCarts.some(c => !/^[a-zA-Z0-9_-]{1,200}$/.test(c))) throw new Error("journey_read_scope");
  const response = await request(`https://${config.projectRef}.supabase.co/rest/v1/rpc/lean_checkout_receipts_read`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { apikey: readKey, Authorization: `Bearer ${readKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_project: config.projectRef, p_shop: config.shop, p_carts: config.requestedCarts }),
  });
  if (!response.ok) throw new Error("journey_read_unavailable");
  const reader = response.body?.getReader(); if (!reader) throw new Error("journey_read_empty");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 500000) { await reader.cancel(); throw new Error("journey_read_budget"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!Array.isArray(raw) || raw.length > config.requestedCarts.length) throw new Error("journey_read_shape");
  const seen = new Set<string>();
  const receipts: JourneyReceipt[] = raw.map(r => {
    if (!r || !config.requestedCarts.includes(r.cartToken) || seen.has(r.cartToken) ||
        typeof r.contextToken !== "string" || r.contextToken.length > 3000 ||
        typeof r.subjectId !== "string" || typeof r.sessionId !== "string" ||
        typeof r.posthogProject !== "string" || typeof r.permissionEvidenceRef !== "string")
      throw new Error("journey_read_shape");
    seen.add(r.cartToken);
    const utc = (v: unknown) => {
      if (typeof v !== "string") throw new Error("journey_read_timestamp");
      const text = v.replace(/\+00:00$/, "Z"); nyDate(text); return text;
    };
    // Select the defined fields, never retain unexpected private RPC columns.
    return { cartToken: r.cartToken, contextToken: r.contextToken, subjectId: r.subjectId,
      sessionId: r.sessionId, posthogProject: r.posthogProject, permissionEvidenceRef: r.permissionEvidenceRef,
      capturedAt: utc(r.capturedAt), validFrom: utc(r.validFrom), expiresAt: utc(r.expiresAt),
      revokedAt: r.revokedAt === null ? null : utc(r.revokedAt) };
  });
  const payload = { projectRef: config.projectRef, shop: config.shop, capturedAt: config.capturedAt,
    requestedCarts: [...config.requestedCarts].sort(), receipts };
  return { ...payload, digest: evidenceDigest(payload) };
}
/** Signature + retained receipt + independently read order.cartToken are all
 * required. Verify at purchase time, not at the later report-build time.
 * A revoked grant is never used, including for historical linkage. */
export function mapJourneyCheckout(orders: ShopifyOrderDocument[], snapshot: JourneySnapshot, config: {
  projectRef: string; shop: string; posthogProject: string; sessionVersion: string; asOf: string;
}, secret: string): FullBuildEvidence["checkout"] {
  const { digest, ...payload } = snapshot;
  shopifyShop(config.shop); nyDate(config.asOf); nyDate(snapshot.capturedAt);
  if (secret.length < 32 || digest !== evidenceDigest(payload) || snapshot.projectRef !== config.projectRef ||
      snapshot.shop !== config.shop || !config.posthogProject.trim() || !config.sessionVersion.trim() ||
      Date.parse(snapshot.capturedAt) > Date.parse(config.asOf) ||
      JSON.stringify(orderCartTokens(orders)) !== JSON.stringify(snapshot.requestedCarts))
    throw new Error("journey_snapshot_scope");
  const receipts = new Map<string, JourneyReceipt>();
  for (const r of snapshot.receipts) {
    if (!snapshot.requestedCarts.includes(r.cartToken) || receipts.has(r.cartToken) ||
        r.posthogProject !== config.posthogProject || !r.permissionEvidenceRef?.trim() ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(r.subjectId)) throw new Error("journey_receipt_scope");
    [r.capturedAt, r.validFrom, r.expiresAt].forEach(nyDate);
    if (r.revokedAt !== null) nyDate(r.revokedAt);
    if (Date.parse(r.capturedAt) < Date.parse(r.validFrom) || Date.parse(r.capturedAt) >= Date.parse(r.expiresAt) ||
        Date.parse(r.expiresAt) - Date.parse(r.validFrom) > 86400000 ||
        Date.parse(r.capturedAt) > Date.parse(snapshot.capturedAt)) throw new Error("journey_receipt_time");
    receipts.set(r.cartToken, r);
  }
  const result: FullBuildEvidence["checkout"] = [], seen = new Set<string>();
  for (const doc of orders) {
    if (doc.shop !== config.shop) throw new Error("journey_order_shop");
    const orderId = key(doc.shop, shopifyId(doc.order.id, "Order"));
    if (seen.has(orderId)) throw new Error("journey_duplicate_order"); seen.add(orderId);
    const r = receipts.get(String(doc.order.cartToken));
    if (!r || r.revokedAt !== null) continue;
    if (typeof doc.order.createdAt !== "string") throw new Error("journey_order_time");
    nyDate(doc.order.createdAt);
    const time = Date.parse(doc.order.createdAt);
    if (time < Date.parse(r.capturedAt) || time >= Date.parse(r.expiresAt) || time > Date.parse(config.asOf)) continue;
    // Verify authenticity while the receipt was issued. A genuinely expired
    // context is an unlinked later purchase, not corrupt evidence that blocks
    // the entire batch. Tampering, target/session mismatch still fail closed.
    const verified = verifyCheckoutContext(r.contextToken, { project: config.posthogProject, shop: config.shop,
      checkoutId: r.cartToken, serverSubject: r.subjectId, analyticsPermitted: true,
      now: Math.floor(Date.parse(r.capturedAt) / 1000) }, secret);
    if (!verified || verified.sessionId !== r.sessionId ||
        verified.expiresAt * 1000 > Date.parse(r.expiresAt)) throw new Error("journey_invalid_context");
    if (verified.expiresAt <= Math.floor(time / 1000)) continue;
    result.push({ orderId, sessionKey: key(config.posthogProject, config.sessionVersion, r.sessionId),
      method: "verified_first_party_context", evidenceRef: `journey-receipt:sha256:${evidenceDigest(r)}` });
  }
  return result;
}
