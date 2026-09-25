import { createHash } from "node:crypto";
import { collectionEvent, type Journey } from "./collection";
import { getAnalyticsSupabase } from "./serverClient";
import { signCheckoutContext } from "./checkout-context";
import { shopifyShop } from "./shopifySource";

export type JourneyGrant = {
  projectRef: string; posthogProject: string; shop: string; subjectId: string;
  sessionId: string; firebaseUid: string | null; validFrom: string; expiresAt: string;
  permissionEvidenceRef: string; tokenHash: string;
};
export type JourneyRuntime = { env: NodeJS.ProcessEnv; request: typeof fetch; now: () => number;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
export const journeyDefaults = (): JourneyRuntime => ({ env: process.env, request: fetch, now: Date.now,
  rpc: async (name, args) => getAnalyticsSupabase().rpc(name, args).abortSignal(AbortSignal.timeout(1000)) });
// Bound callers even if a custom transport ignores cancellation. Production
// RPCs also abort their HTTP request; no retry after an ambiguous write.
export async function boundedJourneyRpc(runtime: JourneyRuntime, name: string, args: Record<string, unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([runtime.rpc(name, args), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("journey_timeout")), 1000);
    })]);
  } finally { clearTimeout(timer); }
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function journeyToken(req: Request) {
  const values = (req.headers.get("cookie") ?? "").split(";").map(v => v.trim())
    .filter(v => v.startsWith("__Host-mully_analytics=")).map(v => v.slice("__Host-mully_analytics=".length));
  return values.length === 1 && /^[a-f0-9]{64}$/.test(values[0]) ? values[0] : null;
}
/** Cookie is a random opaque bearer issued by the analytics authority, NOT a
 * client consent boolean, Firebase token, marketing flag or arbitrary user ID.
 * The DB checks current permission on every event/context operation.
 */
export async function journeyGrant(req: Request, verifiedUid?: string, runtime: JourneyRuntime = journeyDefaults()): Promise<JourneyGrant | null> {
  const e = runtime.env;
  if (e.LEAN_ANALYTICS_JOURNEYS_ENABLED !== "true" || req.headers.get("sec-gpc") === "1" ||
      req.headers.get("dnt") === "1") return null;
  const token = journeyToken(req);
  if (!token || !/^[a-z]{20}$/.test(e.LEAN_ANALYTICS_PIPELINE_PROJECT_REF ?? "") ||
      e.LEAN_ANALYTICS_SUPABASE_URL !== `https://${e.LEAN_ANALYTICS_PIPELINE_PROJECT_REF}.supabase.co`) return null;
  try {
    const shop = shopifyShop(e.LEAN_SHOPIFY_SHOP_DOMAIN ?? "");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const result = await boundedJourneyRpc(runtime, "lean_journey_grant", { p_project: e.LEAN_ANALYTICS_PIPELINE_PROJECT_REF,
      p_shop: shop, p_token_hash: tokenHash });
    const g = result.data as Omit<JourneyGrant, "tokenHash"> | null, now = runtime.now();
    if (result.error || !g || g.projectRef !== e.LEAN_ANALYTICS_PIPELINE_PROJECT_REF ||
        g.posthogProject !== e.LEAN_POSTHOG_PROJECT_ID || g.shop !== shop ||
        !uuid.test(g.sessionId) || !/^[a-zA-Z0-9_-]{1,128}$/.test(g.subjectId) ||
        !g.permissionEvidenceRef?.trim() || !Number.isFinite(Date.parse(g.validFrom)) ||
        !Number.isFinite(Date.parse(g.expiresAt)) || Date.parse(g.validFrom) > now ||
        Date.parse(g.expiresAt) <= now || Date.parse(g.expiresAt) - Date.parse(g.validFrom) > 86400000 ||
        g.firebaseUid !== null && g.firebaseUid !== verifiedUid) return null;
    return { ...g, tokenHash };
  } catch { return null; }
}
const legacySteps: Record<string, [Journey, string]> = {
  quiz_started: ["reserve", "started"], reveal_viewed: ["reserve", "reveal"],
  checkout_clicked: ["reserve", "checkout"],
  lp_text_mully_view: ["text_mully", "started"],
  sg_begin: ["style_game", "started"], sg_played: ["style_game", "completed"],
  sg_checkout_start: ["style_game", "checkout"],
};
/** New privacy-minimal lane; never changes the existing advertising dispatch.
 * sms_click is deliberately NOT mapped to "activated": intent isn't activation.
 */
export async function captureJourney(req: Request, name: string, actionId: unknown,
  verifiedUid?: string, runtime: JourneyRuntime = journeyDefaults()): Promise<boolean> {
  try {
    const step = legacySteps[name];
    const id = typeof actionId === "string" ? actionId.replace(/^evt-/, "") : "";
    if (!step || !uuid.test(id)) return false;
    const g = await journeyGrant(req, verifiedUid, runtime);
    if (!g) return false;
    const eventId = stableJourneyAction(`${g.sessionId}:${name}:${id}`);
    const event = collectionEvent({ journey: step[0], step: step[1], eventId,
      sessionId: g.sessionId, analyticsPermitted: true })!;
    const host = runtime.env.LEAN_POSTHOG_CAPTURE_ORIGIN;
    const key = runtime.env.LEAN_POSTHOG_CAPTURE_KEY;
    if (!["https://us.i.posthog.com", "https://eu.i.posthog.com"].includes(host ?? "") || !key?.trim()) return false;
    const action = await boundedJourneyRpc(runtime, "lean_journey_action", { p_project: g.projectRef, p_shop: g.shop,
      p_token_hash: g.tokenHash, p_action: id, p_family: event.event });
    if (action.error || typeof action.data !== "string" || !Number.isFinite(Date.parse(action.data)) ||
        Date.parse(action.data) < Date.parse(g.validFrom) || Date.parse(action.data) >= Date.parse(g.expiresAt) ||
        Date.parse(action.data) > runtime.now()) return false;
    const response = await runtime.request(`${host}/capture/`, { method: "POST", redirect: "error",
      signal: AbortSignal.timeout(1500), headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, event: event.event, properties: { ...event.properties,
        distinct_id: g.subjectId, $process_person_profile: false }, timestamp: new Date(action.data).toISOString() }) });
    return response.ok;
  } catch { return false; }
}
/** Deterministic UUID-shaped idempotency key; not a random identity or join. */
export function stableJourneyAction(value: string) {
  const h = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** Corroborate a real cart returned by Shopify, without mutating its attributes.
 * The secret cart key is sent only to its fixed shop and never stored.
 * Source mapping requires the order's independently read cartToken too.
 */
export async function attachJourneyCart(req: Request, cartId: unknown, verifiedUid?: string,
  runtime: JourneyRuntime = journeyDefaults()): Promise<boolean> {
  try {
    if (runtime.env.LEAN_ANALYTICS_JOURNEYS_ENABLED !== "true" ||
        typeof cartId !== "string" || cartId.length > 600) return false;
    const match = cartId.match(/^gid:\/\/shopify\/Cart\/([a-zA-Z0-9_-]{1,200})\?key=[a-zA-Z0-9_-]{1,300}$/);
    if (!match) return false;
    const g = await journeyGrant(req, verifiedUid, runtime);
    const secret = runtime.env.LEAN_CHECKOUT_CONTEXT_SECRET ?? "";
    const storefront = runtime.env.LEAN_SHOPIFY_STOREFRONT_TOKEN;
    if (!g || secret.length < 32 || !storefront?.trim()) return false;
    const now = Math.floor(runtime.now() / 1000), ttl = Math.min(3600, Math.floor(Date.parse(g.expiresAt) / 1000) - now);
    if (ttl < 60) return false;
    const token = signCheckoutContext({ project: g.posthogProject, shop: g.shop, checkoutId: match[1],
      sessionId: g.sessionId, serverSubject: g.subjectId, analyticsPermitted: true, now, ttlSeconds: ttl }, secret)!;
    const response = await runtime.request(`https://${g.shop}/api/2026-07/graphql.json`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(1500),
      headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": storefront },
      body: JSON.stringify({ query: `query LeanCartContext($cartId: ID!) { cart(id: $cartId) { id } }`,
        variables: { cartId } }),
    });
    if (!response.ok) return false;
    const result = await response.json();
    if (result.errors?.length || result.data?.cart?.id !== cartId) return false;
    const saved = await boundedJourneyRpc(runtime, "lean_checkout_receipt", { p_project: g.projectRef, p_shop: g.shop,
      p_token_hash: g.tokenHash, p_cart: match[1], p_context: token });
    return !saved.error && saved.data === true;
  } catch { return false; }
}
/** Only called after this server successfully creates/updates the authenticated
 * member's draft. Never accepts a draft ID from a public analytics request. */
export async function attachJourneyDraft(req: Request, draftId: unknown, actualShop: string, verifiedUid: string,
  runtime: JourneyRuntime = journeyDefaults()): Promise<boolean> {
  try {
    if (typeof draftId !== "string" || !/^[1-9]\d{0,24}$/.test(draftId) || !verifiedUid) return false;
    const g = await journeyGrant(req, verifiedUid, runtime), secret = runtime.env.LEAN_CHECKOUT_CONTEXT_SECRET ?? "";
    if (!g || g.shop !== actualShop || secret.length < 32) return false;
    const now = Math.floor(runtime.now() / 1000), ttl = Math.min(3600, Math.floor(Date.parse(g.expiresAt) / 1000) - now);
    if (ttl < 60) return false;
    const token = signCheckoutContext({ project: g.posthogProject, shop: g.shop, checkoutId: `draft_${draftId}`,
      sessionId: g.sessionId, serverSubject: g.subjectId, analyticsPermitted: true, now, ttlSeconds: ttl }, secret)!;
    const saved = await boundedJourneyRpc(runtime, "lean_draft_receipt", { p_project: g.projectRef, p_shop: g.shop,
      p_token_hash: g.tokenHash, p_draft: draftId, p_context: token });
    return !saved.error && saved.data === true;
  } catch { return false; }
}
