import { createHash } from "node:crypto";
import type { JourneyRuntime } from "./journeyRuntime";

export const reserveRuntime = Object.freeze({
  project: "xnfjdbpjuaezxjgargto", shop: "mullybox-store.myshopify.com",
  origin: "https://www.mymully.com", posthog: "353503",
  captureOrigin: "https://us.i.posthog.com", policy: "reserve-runtime-v1",
});
export type JourneyPolicy = {
  policyVersion: string; approvalRef: string; ttlSeconds: number;
  validUntil: string; captureKeySha256: string; configToken: string;
};
export const reserveFamilies = new Set(["lean_reserve_started", "lean_reserve_reveal", "lean_reserve_checkout"]);
export const reserveGrantPrefix = `explicit-browser-choice:${reserveRuntime.policy}:`;

export function productionJourneyBase(env: NodeJS.ProcessEnv) {
  return env.VERCEL_ENV === "production" && env.VERCEL_GIT_COMMIT_REF === "main" &&
    env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF === reserveRuntime.project &&
    env.LEAN_ANALYTICS_SUPABASE_URL === `https://${reserveRuntime.project}.supabase.co` &&
    !!env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY?.trim();
}
export async function boundedJourneyRpc(runtime: JourneyRuntime, name: string, args: Record<string, unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([runtime.rpc(name, args), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("journey_timeout")), 1000);
    })]);
  } finally { clearTimeout(timer); }
}
/** No cache, generic-client fallback or public configuration endpoint. A disabled
 * env lane is NOT authority: only the separate, exact owner-approved DB row is. */
export async function resolveJourneyRuntime(runtime: JourneyRuntime): Promise<JourneyRuntime> {
  if (runtime.policyResolved || runtime.env.LEAN_ANALYTICS_JOURNEYS_ENABLED === "true" ||
      !productionJourneyBase(runtime.env)) return runtime;
  const off = { ...runtime, policyResolved: true };
  try {
    const result = await boundedJourneyRpc(runtime, "lean_journey_runtime_config", {});
    const p = result.data as JourneyPolicy | null;
    if (result.error || !p || Object.keys(p).sort().join(",") !==
        "approvalRef,captureKeySha256,configToken,policyVersion,ttlSeconds,validUntil" ||
        p.policyVersion !== reserveRuntime.policy || typeof p.approvalRef !== "string" ||
        !p.approvalRef.trim() || p.approvalRef.length > 512 ||
        !Number.isInteger(p.ttlSeconds) || p.ttlSeconds < 60 || p.ttlSeconds > 86400 ||
        !/^[a-f0-9]{64}$/.test(p.captureKeySha256) || !/^[a-f0-9]{32}$/.test(p.configToken) ||
        !Number.isFinite(Date.parse(p.validUntil)) || Date.parse(p.validUntil) <= runtime.now()) return off;
    const key = runtime.captureKeyCandidates?.find(k => k?.trim() &&
      createHash("sha256").update(k).digest("hex") === p.captureKeySha256);
    if (!key) return off;
    return { ...runtime, policyResolved: true, policy: p, env: { ...runtime.env,
      LEAN_ANALYTICS_JOURNEYS_ENABLED: "true", LEAN_ANALYTICS_SITE_ORIGIN: reserveRuntime.origin,
      LEAN_SHOPIFY_SHOP_DOMAIN: reserveRuntime.shop, LEAN_POSTHOG_PROJECT_ID: reserveRuntime.posthog,
      LEAN_ANALYTICS_PERMISSION_POLICY: reserveRuntime.policy,
      LEAN_POSTHOG_CAPTURE_ORIGIN: reserveRuntime.captureOrigin, LEAN_POSTHOG_CAPTURE_KEY: key,
    } };
  } catch { return off; }
}
/** Withdrawal must survive disabled/expired policy and missing capture keys.
 * This returns only a fixed target, never permission to issue or collect. */
export function withdrawalRuntime(runtime: JourneyRuntime): JourneyRuntime {
  if (runtime.env.LEAN_ANALYTICS_JOURNEYS_ENABLED === "true" || !productionJourneyBase(runtime.env)) return runtime;
  return { ...runtime, env: { ...runtime.env, LEAN_SHOPIFY_SHOP_DOMAIN: reserveRuntime.shop } };
}
