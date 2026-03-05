/**
 * Loop Subscriptions API client — server-side only.
 *
 * Required env vars:
 *   LOOP_ADMIN_API_TOKEN             — API key
 *   LOOP_API_BASE_URL                — e.g. "https://api.loopsubscriptions.com/admin/2023-10"
 *
 * Optional env vars:
 *   LOOP_MANAGE_SUBSCRIPTION_URL     — template with {customer_id} placeholder
 *   LOOP_NEXT_UNBLOCK_URL            — fallback to mullybox-elite product URL
 */

const BASE_URL =
  process.env.LOOP_API_BASE_URL ?? "https://api.loopsubscriptions.com/admin/2023-10";

function getLoopHeaders(): Record<string, string> {
  const token = process.env.LOOP_ADMIN_API_TOKEN;
  if (!token) throw new Error("Missing LOOP_ADMIN_API_TOKEN");
  return {
    "Content-Type": "application/json",
    "X-Loop-Token": token,
  };
}

export interface LoopSubscription {
  id: string;
  status: string; // "ACTIVE" | "CANCELLED" | "PAUSED" | "FAILED" | ...
  shopify_customer_id?: string;
  variant_id?: number | string | null;
  shopify_variant_id?: number | string | null;
  [key: string]: unknown; // allow unknown fields for raw inspection
}

export interface LoopSubscriptionStatus {
  mullybox_active: boolean;
  status: string;
  total_subscription_count: number;
  active_subscription_ids: string[];
  manage_url: string | null;
  next_unblock_url: string | null;
}

/**
 * Fetch subscription status for a Shopify customer from Loop.
 */
export async function getLoopSubscriptionStatus(
  customerIdentifier: string
): Promise<LoopSubscriptionStatus> {
  console.log("[Loop] getLoopSubscriptionStatus customerIdentifier:", customerIdentifier);
  const url = `${BASE_URL}/customer/${encodeURIComponent(customerIdentifier)}/subscription`;
  const res = await fetch(url, { headers: getLoopHeaders() });

  if (!res.ok) {
    throw new Error(
      `Loop API error ${res.status}: ${await res.text()}`
    );
  }

  const data = (await res.json()) as { subscriptions?: LoopSubscription[] };

  console.log("Loop raw:", JSON.stringify(data.subscriptions?.[0], null, 2));

  const subs = data.subscriptions ?? [];
  const active = subs.filter((s) => s.status === "ACTIVE");

  let status = "none";
  if (active.length > 0) {
    status = "active";
  } else if (subs.length > 0) {
    status = subs[0].status.toLowerCase();
  }

  return {
    mullybox_active: active.length > 0,
    status,
    total_subscription_count: active.length,
    active_subscription_ids: active.map((s) => s.id),
    manage_url: null, // populated by the route handler after calling getLoopManageSubscriptionUrl
    next_unblock_url: null,
  };
}

/**
 * Fetch raw Loop subscriptions for a Shopify customer (all fields).
 */
export async function getLoopRawSubscriptions(
  customerIdentifier: string
): Promise<LoopSubscription[]> {
  console.log("[Loop] getLoopRawSubscriptions customerIdentifier:", customerIdentifier);
  const url = `${BASE_URL}/customer/${encodeURIComponent(customerIdentifier)}/subscription`;
  console.log("[Loop] fetching URL:", url);
  const res = await fetch(url, { headers: getLoopHeaders() });
  console.log("[Loop] response status:", res.status);
  if (!res.ok) {
    throw new Error(`Loop API error ${res.status}: ${await res.text()}`);
  }
  const text = await res.text();
  console.log("[Loop] raw response:", text);
  return (JSON.parse(text).subscriptions as LoopSubscription[]) ?? [];
}

/**
 * Build the customer-specific subscription management URL.
 * Replaces the {customer_id} placeholder in LOOP_MANAGE_SUBSCRIPTION_URL.
 */
export function getLoopManageSubscriptionUrl(_customerId: string): string {
  return (
    process.env.LOOP_MANAGE_SUBSCRIPTION_URL ??
    "https://mullybox-store.myshopify.com/a/loop_subscriptions/auth"
  );
}

/**
 * Return the "next unblock" product URL.
 * Falls back to the Mullybox Elite product if env var is not set.
 */
export function getLoopNextUnblockUrl(): string {
  return (
    process.env.LOOP_NEXT_UNBLOCK_URL ??
    "https://mullybox-store.myshopify.com/products/mullybox-elite"
  );
}
