import { createHash, randomBytes, randomUUID } from "node:crypto";
import { boundedJourneyRpc, journeyDefaults, journeyGrant, journeyToken, type JourneyRuntime } from "./journeyRuntime";
import { shopifyShop } from "./shopifySource";

export const journeyCookieName = "__Host-mully_analytics";
/** Explicit consent is an action on our same-origin route under an installed
 * operator-approved policy. No marketing flag or customer ID is accepted. */
export async function decideJourney(req: Request, decision: "allow" | "withdraw",
  verifiedUid?: string, runtime: JourneyRuntime = journeyDefaults()) {
  const e = runtime.env, project = e.LEAN_ANALYTICS_PIPELINE_PROJECT_REF;
  if ((decision !== "withdraw" && e.LEAN_ANALYTICS_JOURNEYS_ENABLED !== "true") || !/^[a-z]{20}$/.test(project ?? "") ||
      e.LEAN_ANALYTICS_SUPABASE_URL !== `https://${project}.supabase.co`)
    throw new Error("permission_unavailable");
  const shop = shopifyShop(e.LEAN_SHOPIFY_SHOP_DOMAIN ?? "");
  const old = journeyToken(req);
  if (decision === "withdraw") {
    if (old) {
      const result = await boundedJourneyRpc(runtime, "lean_journey_withdraw", {
        p_project: project, p_shop: shop, p_token_hash: createHash("sha256").update(old).digest("hex"),
      });
      if (result.error || result.data !== true) throw new Error("withdrawal_unconfirmed");
    }
    return { token: "", maxAge: 0 };
  }
  if (decision !== "allow" || req.headers.get("sec-gpc") === "1" || req.headers.get("dnt") === "1")
    throw new Error("permission_declined");
  const existing = await journeyGrant(req, verifiedUid, runtime);
  if (existing && old) return { token: old, maxAge: Math.floor((Date.parse(existing.expiresAt) - runtime.now()) / 1000) };
  if (!e.LEAN_ANALYTICS_PERMISSION_POLICY?.trim() || !/^[1-9]\d{0,9}$/.test(e.LEAN_POSTHOG_PROJECT_ID ?? ""))
    throw new Error("permission_unavailable");
  const token = randomBytes(32).toString("hex");
  const result = await boundedJourneyRpc(runtime, "lean_journey_issue", {
    p_project: project, p_shop: shop, p_posthog: e.LEAN_POSTHOG_PROJECT_ID,
    p_policy: e.LEAN_ANALYTICS_PERMISSION_POLICY, p_token_hash: createHash("sha256").update(token).digest("hex"),
    p_subject: randomBytes(32).toString("hex"), p_session: randomUUID(), p_uid: verifiedUid ?? null,
  });
  const value = result.data as { expiresAt?: unknown } | null;
  const ttl = typeof value?.expiresAt === "string" ? Math.floor((Date.parse(value.expiresAt) - runtime.now()) / 1000) : NaN;
  if (result.error || !Number.isFinite(ttl) || ttl < 1 || ttl > 86400) throw new Error("permission_unconfirmed");
  return { token, maxAge: ttl };
}
