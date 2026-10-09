/**
 * Which subscription application owns each selling plan / renewal order.
 *
 * Verified October 9, 2026 against live Shopify orders (read-only):
 *  - Every `subscription_contract_checkout_one` renewal since Aug 21 came from
 *    Loop Subscriptions, Shopify app 5284869.
 *  - Headless (channel:7831744) first orders carry Loop plans 3241476288 /
 *    3241443520, or the Shopify Subscriptions outfit plan 6627721408.
 *  - Native outfit contracts are owned by Shopify's first-party Subscriptions
 *    app, so no custom app (including mully-subscriptions-api) can list them.
 *
 * Unknown plans or apps are never guessed: they return `null` and callers hold.
 */
export type SubscriptionProvider = "loop" | "shopify_native";

export const LOOP_SUBSCRIPTIONS_APP_ID = "5284869";
/** Recharge Subscriptions: the store's provider from 2021 until March 2025. */
export const RECHARGE_APP_ID = "294517";
export const RENEWAL_SOURCE_NAME = "subscription_contract_checkout_one";
/** Loop renewals used `subscription_contract` until September 2025. */
export const RENEWAL_SOURCES: ReadonlySet<string> = new Set([RENEWAL_SOURCE_NAME, "subscription_contract"]);
/** Before this date, deleted (ID-less) plans can only be legacy Recharge-era plans. */
export const LOOP_CUTOVER_AT = Date.parse("2025-03-01T00:00:00Z");
/** Placeholder for a line whose plan object exists but has no ID (plan deleted). */
export const UNIDENTIFIED_PLAN = "unidentified_plan";

// Loop plans proven by Loop-app (5284869) renewal orders: all 4,000 renewals
// from 2025-10-16 to 2026-10-09 were created by Loop (read-only, Oct 9 2026).
const LOOP_RENEWAL_PROVEN = ["2609447104", "2609479872", "2614526144", "2614558912", "2620522688", "2669215936", "2669281472", "2700312768", "2700345536", "2700378304", "2819883200", "2839904448", "2871132352", "2902098112", "2989392064", "2989424832", "3004891328", "3004924096", "3004956864", "3241476288"];

const PLAN_PROVIDERS: Readonly<Record<string, SubscriptionProvider>> = Object.freeze({
  ...Object.fromEntries(LOOP_RENEWAL_PROVEN.map((id) => [id, "loop" as const])),
  "3241443520": "loop", // Annual Reserve Access (Loop change-plan option; no renewal yet)
  "3671163072": "loop", // Style game (Loop pause/cancel routes)
  "6627721408": "shopify_native", // Mully Reserve | The Seasonal Edit (outfit builder)
  // Unverified, intentionally absent (held): 3654713536 Swing Box, 3259433152 "Deliver every year".
});

const numericId = (value: unknown, resource: string): string | null => {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(?:gid:\/\/shopify\/([A-Za-z]+)\/)?([1-9]\d*)$/);
  if (!match || (match[1] && match[1] !== resource)) return null;
  return match[2];
};

export function sellingPlanProvider(planId: unknown): SubscriptionProvider | null {
  const id = numericId(planId, "SellingPlan");
  return id ? PLAN_PROVIDERS[id] ?? null : null;
}

export interface ProviderInput {
  sourceName: string | null;
  appId: string | null;
  sellingPlanIds: Array<string | null>;
  createdAt?: string | null;
}

export type ProviderDecision =
  | { kind: "one_time" }
  | { kind: "subscription"; provider: SubscriptionProvider; renewal: boolean }
  /** Pre-Loop Recharge membership: proves past membership, never a current cycle. */
  | { kind: "legacy_subscription" }
  | { kind: "hold"; reason: string };

/** Decide the owning subscription provider for one order. */
export function decideOrderProvider(input: ProviderInput): ProviderDecision {
  const renewal = RENEWAL_SOURCES.has(input.sourceName ?? "");
  const plans = input.sellingPlanIds.filter((p): p is string => p !== null);
  const app = numericId(input.appId, "App");
  if (app === RECHARGE_APP_ID) return { kind: "legacy_subscription" };
  if (!plans.length && !renewal) return { kind: "one_time" };
  const known = plans.map(sellingPlanProvider);
  if (renewal) {
    if (!app) return { kind: "hold", reason: "renewal_app_unverified" };
    if (app === LOOP_SUBSCRIPTIONS_APP_ID) {
      // The Loop app created this billing order; its plans are Loop's even if
      // not individually registered. A positively native plan is a conflict.
      if (known.includes("shopify_native")) return { kind: "hold", reason: "renewal_provider_conflict" };
      return { kind: "subscription", provider: "loop", renewal: true };
    }
    // A non-Loop renewal is native only when every plan positively says so.
    if (!plans.length || known.some((p) => p !== "shopify_native")) {
      return { kind: "hold", reason: "renewal_provider_unverified" };
    }
    return { kind: "subscription", provider: "shopify_native", renewal: true };
  }
  if (known.some((p) => p === null)) {
    const created = Date.parse(input.createdAt ?? "");
    // Only DELETED plans on pre-Loop orders are legacy. An unregistered live
    // plan ID, or any unknown plan after the cutover, still holds.
    if (Number.isFinite(created) && created < LOOP_CUTOVER_AT &&
      plans.every((p, i) => known[i] !== null || p === UNIDENTIFIED_PLAN)) return { kind: "legacy_subscription" };
    return { kind: "hold", reason: "unknown_selling_plan" };
  }
  const providers = new Set(known);
  if (providers.size > 1) return { kind: "hold", reason: "mixed_subscription_providers" };
  const planProvider = known[0];
  return { kind: "subscription", provider: planProvider!, renewal: false };
}
