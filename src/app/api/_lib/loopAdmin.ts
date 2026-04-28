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
const LOOP_MANAGE_URL_FALLBACK =
  "https://mullybox-store.myshopify.com/a/loop_subscriptions/auth";
const LOOP_CUSTOMER_ID_PLACEHOLDER = "{customer_id}";
const LOOP_CUSTOMER_ID_PLACEHOLDER_ENCODED =
  encodeURIComponent(LOOP_CUSTOMER_ID_PLACEHOLDER);

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
  lines?: { variantShopifyId?: number | string | null; [key: string]: unknown }[];
  [key: string]: unknown; // allow unknown fields for raw inspection
}

export interface LoopSubscriptionStatus {
  mullybox_active: boolean;
  status: string;
  total_subscription_count: number;
  active_subscription_ids: string[];
  manage_url: string | null;
  next_unblock_url: string | null;
  nextBillingDate: string | null;
  billingInterval: string | null;
  memberSince: string | null;
  successfulPayments: number | null;
  lastPaymentStatus: string | null;
  planPrice: string | null;
  planName: string | null;
  isPrepaid: boolean | null;
  shippingCity: string | null;
  shippingState: string | null;
  loopFitProfile: Record<string, string> | null;
}

/**
 * Fetch subscription status for a Shopify customer from Loop.
 */
export async function getLoopSubscriptionStatus(
  customerIdentifier: string
): Promise<LoopSubscriptionStatus> {
  const url = `${BASE_URL}/customer/${encodeURIComponent(customerIdentifier)}/subscription`;
  const res = await fetch(url, { headers: getLoopHeaders() });

  if (!res.ok) {
    throw new Error(
      `Loop API error ${res.status}: ${await res.text()}`
    );
  }

  const data = (await res.json()) as { data?: LoopSubscription[] };

  const subs = data.data ?? [];
  const active = subs.filter((s) => s.status === "ACTIVE");

  let status = "none";
  if (active.length > 0) {
    status = "active";
  } else if (subs.length > 0) {
    status = subs[0].status.toLowerCase();
  }

  const activeSub = active[0] as any;

  let nextBillingDate: string | null = null;
  let billingInterval: string | null = null;
  let memberSince: string | null = null;
  let loopFitProfile: Record<string, string> | null = null;

  if (activeSub?.nextBillingDateEpoch) {
    const d = new Date(activeSub.nextBillingDateEpoch * 1000);
    nextBillingDate = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }
  if (activeSub?.billingPolicy) {
    const { interval, intervalCount } = activeSub.billingPolicy;
    if (interval && intervalCount) {
      const unit = interval.charAt(0) + interval.slice(1).toLowerCase();
      billingInterval = intervalCount === 1 ? unit : `every ${intervalCount} ${unit.toLowerCase()}s`;
    }
  }
  if (activeSub?.createdAt) {
    const d = new Date(activeSub.createdAt);
    memberSince = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  const line = activeSub?.lines?.[0] as any;
  if (line?.attributes && Array.isArray(line.attributes)) {
    const attrs: Record<string, string> = {};
    for (const a of line.attributes) {
      if (a.key && a.value) attrs[a.key] = a.value;
    }
    if (Object.keys(attrs).length > 0) loopFitProfile = attrs;
  }

  return {
    mullybox_active: active.length > 0,
    status,
    total_subscription_count: active.length,
    active_subscription_ids: active.map((s) => s.id),
    manage_url: null,
    next_unblock_url: null,
    nextBillingDate,
    billingInterval,
    memberSince,
    successfulPayments: activeSub?.billingAttemptSuccessCount ?? null,
    lastPaymentStatus: activeSub?.lastPaymentStatus ?? null,
    planPrice: line?.price ? `$${line.price}` : null,
    planName: line?.productTitle ?? null,
    isPrepaid: activeSub?.isPrepaid ?? null,
    shippingCity: activeSub?.shippingAddress?.city ?? null,
    shippingState: activeSub?.shippingAddress?.provinceCode ?? null,
    loopFitProfile,
  };
}

/**
 * Fetch raw Loop subscriptions for a Shopify customer (all fields).
 */
export async function getLoopRawSubscriptions(
  customerIdentifier: string
): Promise<LoopSubscription[]> {
  const url = `${BASE_URL}/customer/${encodeURIComponent(customerIdentifier)}/subscription`;
  const res = await fetch(url, { headers: getLoopHeaders() });
  if (!res.ok) {
    throw new Error(`Loop API error ${res.status}: ${await res.text()}`);
  }
  const text = await res.text();
  return ((JSON.parse(text).data as LoopSubscription[]) ?? []).map((sub) => ({
    ...sub,
    id: String(sub.id),
  }));
}

/**
 * Fetch a single Loop subscription by ID (returns full detail including variant_id).
 */
export async function getLoopSubscriptionById(
  subscriptionId: string
): Promise<LoopSubscription | null> {
  const url = `${BASE_URL}/subscription/${encodeURIComponent(subscriptionId)}`;
  const res = await fetch(url, { headers: getLoopHeaders() });
  if (!res.ok) {
    throw new Error(`Loop API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { data?: LoopSubscription };
  if (!data.data) return null;
  return { ...data.data, id: String(data.data.id) };
}

/**
 * Returns the Loop subscription ID of the first ACTIVE subscription.
 */
export async function getActiveLoopSubscriptionId(
  customerIdentifier: string
): Promise<string | null> {
  const subs = await getLoopRawSubscriptions(customerIdentifier);
  return subs.find((s) => s.status === "ACTIVE")?.id ?? null;
}

async function loopSubscriptionMutation(
  subscriptionId: string,
  action: string,
  body?: Record<string, unknown>
): Promise<void> {
  const url = `${BASE_URL}/subscription/${subscriptionId}/${action}`;
  const res = await fetch(url, {
    method: "POST",
    headers: getLoopHeaders(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    throw new Error(`Loop ${action} error ${res.status}: ${await res.text()}`);
  }
}

const STOREFRONT_BASE_URL = BASE_URL.replace("/admin/", "/storefront/");

async function generateLoopSessionToken(shopifyCustomerId: string): Promise<string> {
  const url = `${BASE_URL}/customer/${encodeURIComponent(shopifyCustomerId)}/sessionToken`;
  const res = await fetch(url, { method: "POST", headers: getLoopHeaders() });
  if (!res.ok) {
    throw new Error(`Loop sessionToken error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { data?: { sessionToken?: string } };
  const token = data.data?.sessionToken;
  if (!token) throw new Error("Loop sessionToken response missing data.sessionToken");
  return token;
}

async function exchangeLoopSessionTokenForAccessToken(sessionToken: string): Promise<string> {
  const url = `${STOREFRONT_BASE_URL}/auth/refreshToken`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken }),
  });
  if (!res.ok) {
    throw new Error(`Loop auth/refreshToken error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { data?: { accessToken?: string } };
  const token = data.data?.accessToken;
  if (!token) throw new Error("Loop auth/refreshToken response missing data.accessToken");
  return token;
}

export async function swapLoopSubscriptionProduct(params: {
  shopifyCustomerId: string;
  subscriptionId: string;
  lineId: string;
  variantShopifyId: number;
  quantity: number;
  sellingPlanGroupId?: number;
}): Promise<void> {
  const { shopifyCustomerId, subscriptionId, lineId, variantShopifyId, quantity, sellingPlanGroupId } = params;

  const sessionToken = await generateLoopSessionToken(shopifyCustomerId);
  const accessToken = await exchangeLoopSessionTokenForAccessToken(sessionToken);

  const url = `${STOREFRONT_BASE_URL}/subscription/${encodeURIComponent(subscriptionId)}/line/${encodeURIComponent(lineId)}/swap`;
  const body: Record<string, unknown> = { variantShopifyId, quantity };
  if (sellingPlanGroupId != null) body.sellingPlanGroupId = sellingPlanGroupId;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Loop swap error ${res.status}: ${await res.text()}`);
  }
}

export const pauseLoopSubscription = (id: string) =>
  loopSubscriptionMutation(id, "pause");

export const resumeLoopSubscription = (id: string) =>
  loopSubscriptionMutation(id, "resume");

export const cancelLoopSubscription = (id: string, reason: string) =>
  loopSubscriptionMutation(id, "cancel", { reason });

export const changeLoopSubscriptionPlan = (id: string, sellingPlanShopifyId: number) =>
  loopSubscriptionMutation(id, "frequency", { sellingPlanShopifyId });

export const reactivateLoopSubscription = (id: string) =>
  loopSubscriptionMutation(id, "reactivate");

/**
 * Build the customer-specific subscription management URL.
 * Replaces the {customer_id} placeholder in LOOP_MANAGE_SUBSCRIPTION_URL.
 */
export function getLoopManageSubscriptionUrl(customerId: string): string {
  const template =
    process.env.LOOP_MANAGE_SUBSCRIPTION_URL ?? LOOP_MANAGE_URL_FALLBACK;
  const safeCustomerId = customerId.trim();
  const encodedCustomerId = encodeURIComponent(safeCustomerId);

  if (!safeCustomerId) {
    return LOOP_MANAGE_URL_FALLBACK;
  }

  if (template.includes(LOOP_CUSTOMER_ID_PLACEHOLDER)) {
    return template.split(LOOP_CUSTOMER_ID_PLACEHOLDER).join(encodedCustomerId);
  }

  if (template.includes(LOOP_CUSTOMER_ID_PLACEHOLDER_ENCODED)) {
    return template
      .split(LOOP_CUSTOMER_ID_PLACEHOLDER_ENCODED)
      .join(encodedCustomerId);
  }

  return template;
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
