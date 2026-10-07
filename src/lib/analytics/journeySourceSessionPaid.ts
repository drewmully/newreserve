import { verifyShopifyHmac } from "@/lib/events/verify";
import { boundedJourneyRpc, reserveRuntime as target } from "./journeyPolicyRuntime";
import { journeyDefaults, type JourneyRuntime } from "./journeyRuntime";
import { sourceSessionConfig, sourceSessionDigest } from "./journeySourceSessionRuntime";
import { nativeSourceSessionId } from "./journeySourceSessionContract";

/** Called after route HMAC and before business deduplication. Re-verifies exact
 * body bytes with the fingerprint-bound secret. Never logs/stores the body. */
export async function recordSourceSessionPaid(headers: Headers, rawBody: string,
  r: JourneyRuntime = journeyDefaults()): Promise<"off" | "retained" | "unconfirmed"> {
  if (r.env.LEAN_ANALYTICS_SOURCE_SESSIONS_ENABLED !== "true") return "off";
  try {
    const p = await sourceSessionConfig(r);
    if (!p) return "unconfirmed";
    const delivery = headers.get("x-shopify-webhook-id");
    if (headers.get("x-shopify-shop-domain") !== target.shop || headers.get("x-shopify-topic") !== "orders/paid" ||
      !delivery || !nativeSourceSessionId.test(delivery) || Buffer.byteLength(rawBody) > 2000000 ||
      !verifyShopifyHmac(headers, rawBody, r.env.LEAN_SHOPIFY_WEBHOOK_SECRET)) return "unconfirmed";
    const root = JSON.parse(rawBody);
    if (!root || typeof root !== "object" || Array.isArray(root)) return "unconfirmed";
    const numeric = typeof root.id === "string" && /^[1-9]\d{0,24}$/.test(root.id) ? root.id :
      typeof root.id === "number" && Number.isSafeInteger(root.id) && root.id > 0 ? String(root.id) : null;
    if (!numeric || root.admin_graphql_api_id !== `gid://shopify/Order/${numeric}` || root.financial_status !== "paid" ||
      typeof root.cart_token !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(root.cart_token)) return "unconfirmed";
    const clock = (v: unknown, optional = false) => {
      if (optional && (v === null || v === undefined)) return null;
      if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(Z|[+-]\d\d:\d\d)$/.test(v) ||
        !Number.isFinite(Date.parse(v)) || Date.parse(v) > r.now()) throw new Error("source_clock");
      return v; // Keep the supplied clock semantics. The DB normalizes timezone, not its meaning.
    };
    const result = await boundedJourneyRpc(r, "lean_source_session_paid", { p_config: p.configToken,
      p_order: root.admin_graphql_api_id, p_cart: root.cart_token, p_delivery: delivery,
      p_digest: sourceSessionDigest(rawBody), p_created: clock(root.created_at),
      p_processed: clock(root.processed_at, true), p_updated: clock(root.updated_at, true) });
    return !result.error && result.data === true ? "retained" : "unconfirmed";
  } catch { return "unconfirmed"; }
}
