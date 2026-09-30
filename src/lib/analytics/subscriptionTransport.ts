import { createHash, timingSafeEqual } from "node:crypto";
import type { SubscriptionTransport } from "./subscriptionCollection";

export const SUBSCRIPTION_SHOP = "mullybox-store.myshopify.com";
const origin = "https://api.loopsubscriptions.com";
const endpoint = "/admin/2026-04/subscription";

/** Owner-attested token fingerprint binds this transport to one approved shop.
 * This is not provider introspection. Never inherit the operational Loop token.
 */
export function createSubscriptionTransport(config: {
  enabled?: boolean; shop: string; token: string; tokenSha256: string; bindingRef: string;
}, fetcher: typeof fetch = fetch): SubscriptionTransport {
  if (typeof window !== "undefined") throw new Error("subscription_server_only");
  if (config.enabled !== true) return async () => { throw new Error("subscription_transport_disabled"); };
  if (config.shop !== SUBSCRIPTION_SHOP || !/^[a-f0-9]{64}$/.test(config.tokenSha256) ||
      !/^[A-Za-z0-9:/._-]{1,200}$/.test(config.bindingRef) ||
      typeof config.token !== "string" || config.token.length < 16 || config.token.length > 4096 ||
      /[\s\x00-\x1f\x7f]/.test(config.token)) throw new Error("subscription_source_binding");
  const actual = createHash("sha256").update(config.token).digest();
  if (!timingSafeEqual(actual, Buffer.from(config.tokenSha256, "hex"))) throw new Error("subscription_source_binding");
  const token = config.token; // Freeze the approved credential; never include it in a result/error.
  return async request => {
    let url: URL;
    try { url = new URL(request.path, origin); }
    catch { throw new Error("subscription_source_request"); }
    const params = [...url.searchParams.keys()];
    if (request.method !== "GET" || request.redirect !== "error" ||
        url.origin !== origin || url.pathname !== endpoint || url.hash ||
        request.path !== url.pathname + url.search ||
        params.some(p => !["pageSize", "status", "afterCursor"].includes(p)) ||
        new Set(params).size !== params.length ||
        !/^(?:[1-9]\d?|100)$/.test(url.searchParams.get("pageSize") ?? "") ||
        url.searchParams.has("status") && !["ACTIVE", "PAUSED", "CANCELLED", "EXPIRED"].includes(url.searchParams.get("status")!) ||
        url.searchParams.has("afterCursor") && (!url.searchParams.get("afterCursor") ||
          Buffer.byteLength(url.searchParams.get("afterCursor")!) > 4096))
      throw new Error("subscription_source_request");
    if (request.signal.aborted) throw new Error("subscription_source_aborted");
    try {
      const response = await fetcher(url.href, {
        method: "GET", redirect: "error", cache: "no-store",
        headers: { Accept: "application/json", "X-Loop-Token": token },
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
      });
      if (!response.ok || response.redirected) {
        void response.body?.cancel().catch(() => {});
        throw new Error(); // Never read or forward an auth/rate-limit/provider error body.
      }
      return response;
    } catch { throw new Error("subscription_source_unavailable"); }
  };
}
