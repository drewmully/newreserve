import { createHash } from "node:crypto";
import type { JourneyRuntime } from "./journeyRuntime";
import { boundedJourneyRpc, productionJourneyBase, reserveRuntime,
  resolveJourneyRuntime as resolveReserveRuntime, type JourneyPolicy } from "./journeyPolicyRuntime";

/** Separate, default-empty successor. The original Reserve resolver is unchanged. */
export const reserveCartPolicy = "reserve-cart-runtime-v2";
export const reserveCartGrantPrefix = `explicit-browser-choice:${reserveCartPolicy}:`;
export const isReserveCartRuntime = (r: JourneyRuntime) => r.policy?.policyVersion === reserveCartPolicy;

export async function resolveJourneyRuntime(runtime: JourneyRuntime): Promise<JourneyRuntime> {
  const original = await resolveReserveRuntime(runtime);
  // Existing v1 or legacy configuration wins unchanged. Never reinterpret its grants.
  if (original.policy || runtime.policyResolved || runtime.env.LEAN_ANALYTICS_JOURNEYS_ENABLED === "true" ||
      !productionJourneyBase(runtime.env)) return original;
  try {
    const result = await boundedJourneyRpc(runtime, "lean_journey_checkout_config", {});
    const p = result.data as JourneyPolicy | null;
    if (result.error || !p || Object.keys(p).sort().join(",") !==
        "approvalRef,captureKeySha256,configToken,policyVersion,ttlSeconds,validUntil" ||
        p.policyVersion !== reserveCartPolicy || typeof p.approvalRef !== "string" ||
        !p.approvalRef.trim() || p.approvalRef.length > 512 ||
        !Number.isInteger(p.ttlSeconds) || p.ttlSeconds < 60 || p.ttlSeconds > 86400 ||
        !/^[a-f0-9]{64}$/.test(p.captureKeySha256) || !/^[a-f0-9]{32}$/.test(p.configToken) ||
        !Number.isFinite(Date.parse(p.validUntil)) || Date.parse(p.validUntil) <= runtime.now()) return original;
    const key = runtime.captureKeyCandidates?.find(k => k?.trim() &&
      createHash("sha256").update(k).digest("hex") === p.captureKeySha256);
    if (!key) return original;
    return { ...runtime, policyResolved: true, policy: p, env: { ...runtime.env,
      LEAN_ANALYTICS_JOURNEYS_ENABLED: "true", LEAN_ANALYTICS_SITE_ORIGIN: reserveRuntime.origin,
      LEAN_SHOPIFY_SHOP_DOMAIN: reserveRuntime.shop, LEAN_POSTHOG_PROJECT_ID: reserveRuntime.posthog,
      LEAN_ANALYTICS_PERMISSION_POLICY: reserveCartPolicy,
      LEAN_POSTHOG_CAPTURE_ORIGIN: reserveRuntime.captureOrigin, LEAN_POSTHOG_CAPTURE_KEY: key,
    } };
  } catch { return original; }
}
