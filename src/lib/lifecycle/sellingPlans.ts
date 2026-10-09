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
export const RENEWAL_SOURCE_NAME = "subscription_contract_checkout_one";

const PLAN_PROVIDERS: Readonly<Record<string, SubscriptionProvider>> = Object.freeze({
  "3241476288": "loop", // Quarterly Reserve (Loop change-plan option)
  "3241443520": "loop", // Annual Reserve Access (Loop change-plan option)
  "3671163072": "loop", // Style game (Loop pause/cancel routes)
  "2609479872": "loop", // "Deliver Every 3 Months" on Loop app renewals
  "6627721408": "shopify_native", // Mully Reserve | The Seasonal Edit (outfit builder)
  // 3654713536 Swing Box: ownership not verified. Intentionally absent.
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
}

export type ProviderDecision =
  | { kind: "one_time" }
  | { kind: "subscription"; provider: SubscriptionProvider; renewal: boolean }
  | { kind: "hold"; reason: string };

/** Decide the owning subscription provider for one order. */
export function decideOrderProvider(input: ProviderInput): ProviderDecision {
  const renewal = input.sourceName === RENEWAL_SOURCE_NAME;
  const plans = input.sellingPlanIds.filter((p): p is string => p !== null);
  if (!plans.length && !renewal) return { kind: "one_time" };
  const known = plans.map(sellingPlanProvider);
  if (renewal) {
    const app = numericId(input.appId, "App");
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
  if (known.some((p) => p === null)) return { kind: "hold", reason: "unknown_selling_plan" };
  const providers = new Set(known);
  if (providers.size > 1) return { kind: "hold", reason: "mixed_subscription_providers" };
  const planProvider = known[0];
  return { kind: "subscription", provider: planProvider!, renewal: false };
}
