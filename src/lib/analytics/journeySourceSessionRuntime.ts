import { createHash, randomBytes, randomUUID } from "node:crypto";
import { journeyDefaults, type JourneyGrant, type JourneyRuntime } from "./journeyRuntime";
import { boundedJourneyRpc, productionJourneyBase, reserveRuntime as target } from "./journeyPolicyRuntime";
import { signCheckoutContext } from "./checkout-context";
import { sourceSessionVersion, sourceSessionCookie, nativeSourceSessionId as uuid } from "./journeySourceSessionContract";
import { readNativeSessionForBinding } from "./journeyNativeSessionRead";
import { nativeFilterRules } from "./journeyNativeFilterConfig";
export { sourceSessionVersion, sourceSessionCookie } from "./journeySourceSessionContract";

export type SourceSessionPolicy = { policyVersion: string; approvalRef: string; ttlSeconds: number;
  validUntil: string; configToken: string; webhookKeySha256: string; sourceReadKeySha256: string };
export const sourceSessionDigest = (v: string) => createHash("sha256").update(v).digest("hex");
const withdrawalCookieSeconds = (expiresAt: string, now: number) => {
  const micros = Number((expiresAt.match(/\.(\d{1,6})Z$/)?.[1] ?? "").padEnd(6,"0").slice(3));
  return Math.ceil((Date.parse(expiresAt) + micros/1000 - now)/1000) + 9*86400;
};
function token(req: Request) {
  const values = (req.headers.get("cookie") ?? "").split(";").map(v => v.trim())
    .filter(v => v.startsWith(`${sourceSessionCookie}=`)).map(v => v.slice(sourceSessionCookie.length + 1));
  return values.length === 1 && /^[a-f0-9]{64}$/.test(values[0]) ? values[0] : null;
}
export function sourceSessionOrigin(req: Request) {
  return req.headers.get("origin") === target.origin && new URL(req.url).origin === target.origin;
}
/** A separate opt-in policy. Neither old environment flags nor a v2 cookie enables it. */
export async function sourceSessionConfig(r: JourneyRuntime = journeyDefaults()): Promise<SourceSessionPolicy | null> {
  if (r.env.LEAN_ANALYTICS_SOURCE_SESSIONS_ENABLED !== "true" || !productionJourneyBase(r.env) || !nativeFilterRules(r.env)) return null;
  try {
    const result = await boundedJourneyRpc(r, "lean_source_session_config", {}), p = result.data as SourceSessionPolicy | null;
    if (result.error || !p || Object.keys(p).sort().join(",") !==
      "approvalRef,configToken,policyVersion,sourceReadKeySha256,ttlSeconds,validUntil,webhookKeySha256" ||
      p.policyVersion !== sourceSessionVersion || !p.approvalRef?.trim() || p.approvalRef.length > 512 ||
      !Number.isSafeInteger(p.ttlSeconds) || p.ttlSeconds < 60 || p.ttlSeconds > 86400 ||
      !/^[a-f0-9]{32}$/.test(p.configToken) || !/^[a-f0-9]{64}$/.test(p.webhookKeySha256) ||
      !Number.isFinite(Date.parse(p.validUntil)) || Date.parse(p.validUntil) <= r.now() ||
      !r.env.LEAN_SHOPIFY_WEBHOOK_SECRET || sourceSessionDigest(r.env.LEAN_SHOPIFY_WEBHOOK_SECRET) !== p.webhookKeySha256)
      return null;
    if (!/^[a-f0-9]{64}$/.test(p.sourceReadKeySha256) || !r.env.LEAN_POSTHOG_QUERY_READ_KEY ||
      sourceSessionDigest(r.env.LEAN_POSTHOG_QUERY_READ_KEY) !== p.sourceReadKeySha256) return null;
    return p;
  } catch { return null; }
}
export async function sourceSessionGrant(req: Request, p: SourceSessionPolicy,
  r: JourneyRuntime): Promise<JourneyGrant | null> {
  const opaque = token(req);
  if (!opaque || !sourceSessionOrigin(req) || req.headers.get("sec-gpc") === "1" || req.headers.get("dnt") === "1") return null;
  try {
    const tokenHash = sourceSessionDigest(opaque);
    const result = await boundedJourneyRpc(r, "lean_source_session_grant", { p_config: p.configToken, p_token_hash: tokenHash });
    const g = result.data as JourneyGrant | null;
    if (result.error || !g || g.projectRef !== target.project || g.shop !== target.shop ||
      g.posthogProject !== target.posthog || g.firebaseUid !== null || !uuid.test(g.sessionId) ||
      !/^[a-f0-9]{64}$/.test(g.subjectId) ||
      g.permissionEvidenceRef !== `explicit-browser-choice:${sourceSessionVersion}:${g.subjectId}` ||
      !Number.isFinite(Date.parse(g.validFrom)) || !Number.isFinite(Date.parse(g.expiresAt)) ||
      Date.parse(g.validFrom) > r.now() || Date.parse(g.expiresAt) <= r.now() ||
      Date.parse(g.expiresAt) - Date.parse(g.validFrom) > 86400000 || Date.parse(p.validUntil) <= r.now()) return null;
    return { ...g, tokenHash };
  } catch { return null; }
}
export async function decideSourceSession(req: Request, decision: unknown, requestedPolicy: unknown,
  r: JourneyRuntime = journeyDefaults()) {
  if (!productionJourneyBase(r.env) || !sourceSessionOrigin(req)) throw new Error("source_choice_unavailable");
  const old = token(req);
  if (decision === "withdraw") {
    if (old) {
      const result = await boundedJourneyRpc(r, "lean_journey_withdraw", { p_project: target.project,
        p_shop: target.shop, p_token_hash: sourceSessionDigest(old) });
      if (result.error || result.data !== true) throw new Error("source_withdrawal_unconfirmed");
    }
    return { token: "", maxAge: 0, expiresAt: null };
  }
  if (decision !== "allow" || requestedPolicy !== sourceSessionVersion || req.headers.get("sec-gpc") === "1" ||
    req.headers.get("dnt") === "1") throw new Error("source_choice_declined");
  const p = await sourceSessionConfig(r);
  if (!p) throw new Error("source_choice_unavailable");
  const current = await sourceSessionGrant(req, p, r);
  // Keep the withdrawal handle through the latest possible paid-link deadline.
  // This does not extend the DB grant's new-session/cart capture interval.
  if (current && old) return { token: old, maxAge: withdrawalCookieSeconds(current.expiresAt,r.now()), expiresAt: current.expiresAt };
  // A new explicit choice replaces an expired choice rather than stranding its
  // still-live later-order matching authority behind an overwritten cookie.
  if (old) {
    const withdrawn = await boundedJourneyRpc(r, "lean_journey_withdraw", { p_project: target.project,
      p_shop: target.shop, p_token_hash: sourceSessionDigest(old) });
    if (withdrawn.error || withdrawn.data !== true) throw new Error("source_withdrawal_unconfirmed");
  }
  const opaque = randomBytes(32).toString("hex");
  const result = await boundedJourneyRpc(r, "lean_source_session_issue", { p_config: p.configToken,
    p_token_hash: sourceSessionDigest(opaque), p_subject: randomBytes(32).toString("hex"), p_session: randomUUID() });
  const value = result.data as { expiresAt?: string } | null;
  const ttl = value?.expiresAt ? Math.floor((Date.parse(value.expiresAt) - r.now()) / 1000) : NaN;
  if (result.error || !Number.isFinite(ttl) || ttl < 1 || ttl > 86400) throw new Error("source_choice_unconfirmed");
  return { token: opaque, maxAge: withdrawalCookieSeconds(value!.expiresAt!,r.now()), expiresAt: value!.expiresAt! };
}
/** Bind the browser's SDK namespace only after independent native entry verification. */
export async function bindSourceSession(req: Request, nativeSessionId: unknown, r: JourneyRuntime = journeyDefaults()) {
  if (typeof nativeSessionId !== "string" || !uuid.test(nativeSessionId)) return false;
  const p = await sourceSessionConfig(r), g = p ? await sourceSessionGrant(req, p, r) : null;
  if (!g || !p) return false;
  try {
    const prior = await boundedJourneyRpc(r,"lean_source_session_existing",{
      p_config:p.configToken,p_token_hash:g.tokenHash,p_native:nativeSessionId });
    if (prior.error) return false;
    if (prior.data === "verified") return true;
    if (prior.data !== "missing") return false;
    const source = await readNativeSessionForBinding(nativeSessionId, g, r);
    if (!source) return false;
    const result = await boundedJourneyRpc(r, "lean_source_session_bind", {
      p_config: p.configToken, p_token_hash: g.tokenHash, p_native: nativeSessionId,
      p_entry: source.entryUuid, p_started: source.startedAt, p_ended: source.endedAt,
      p_read_digest: source.readDigest, p_filters: source.filterResults });
    return !result.error && result.data === true;
  } catch { return false; }
}
/** Separate v3 table; v1/v2 cart functions and their reader format are unchanged. */
export async function attachSourceSessionCart(req: Request, nativeSessionId: unknown, cartId: unknown,
  r: JourneyRuntime = journeyDefaults()) {
  try {
    if (typeof nativeSessionId !== "string" || !uuid.test(nativeSessionId) ||
      typeof cartId !== "string" || cartId.length > 600) return false;
    const match = cartId.match(/^gid:\/\/shopify\/Cart\/([a-zA-Z0-9_-]{1,200})\?key=[a-zA-Z0-9_-]{1,300}$/);
    if (!match) return false;
    const p = await sourceSessionConfig(r), g = p ? await sourceSessionGrant(req, p, r) : null;
    const secret = r.env.LEAN_CHECKOUT_CONTEXT_SECRET ?? "", storefront = r.env.LEAN_SHOPIFY_STOREFRONT_TOKEN;
    if (!p || !g || secret.length < 32 || !storefront?.trim()) return false;
    const now = Math.floor(r.now() / 1000), ttl = Math.min(3600,
      Math.floor(Date.parse(g.expiresAt) / 1000) - now, Math.floor(Date.parse(p.validUntil) / 1000) - now);
    if (ttl < 60) return false;
    const context = signCheckoutContext({ project: target.posthog, shop: target.shop, checkoutId: match[1],
      sessionId: nativeSessionId, serverSubject: g.subjectId, analyticsPermitted: true, now, ttlSeconds: ttl }, secret)!;
    const response = await r.request(`https://${target.shop}/api/2026-07/graphql.json`, { method: "POST", redirect: "error",
      signal: AbortSignal.timeout(1500), headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": storefront },
      body: JSON.stringify({ query: "query LeanSourceCart($cartId: ID!) { cart(id: $cartId) { id } }", variables: { cartId } }) });
    if (!response.ok) return false;
    const data = await response.json();
    if (data.errors?.length || data.data?.cart?.id !== cartId || r.now() >= (now + ttl) * 1000 ||
      !(await sourceSessionGrant(req, p, r))) return false;
    const saved = await boundedJourneyRpc(r, "lean_source_session_cart", { p_config: p.configToken,
      p_token_hash: g.tokenHash, p_native: nativeSessionId, p_cart: match[1], p_context: context });
    return !saved.error && saved.data === true;
  } catch { return false; }
}
