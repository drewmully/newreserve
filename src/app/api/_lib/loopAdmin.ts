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

// ─── Retry-with-backoff wrapper ─────────────────────────────────────────────

/**
 * Error class thrown when an HTTP response is retryable (5xx or 429). Thrown
 * from inside a `withLoopRetry` callback so the wrapper knows to back off and
 * try again instead of surfacing a permanent failure.
 */
export class LoopRetryableHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "LoopRetryableHttpError";
  }
}

export interface WithLoopRetryOpts {
  retries?: number;
  baseMs?: number;
  timeoutMs?: number;
  label: string;
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Node/undici TypeErrors: "fetch failed", "socket", "other side closed", etc.
  if (
    err instanceof TypeError &&
    (err.message.includes("fetch failed") ||
      err.message.includes("socket") ||
      err.message.includes("network"))
  ) {
    return true;
  }
  // undici raises errors with code fields like UND_ERR_SOCKET / ECONNRESET.
  const code = (err as { code?: string }).code;
  if (typeof code === "string" && /^(ECONN|EAI_|EPIPE|ENOTFOUND|UND_ERR_)/.test(code)) {
    return true;
  }
  return false;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Retry-with-backoff wrapper for Loop admin API calls.
 *
 * Retries on: per-attempt timeout (AbortController.abort), network errors,
 * `LoopRetryableHttpError` (HTTP 5xx or 429).
 *
 * Does NOT retry on: HTTP 4xx (except 429), other application errors
 * (thrown as plain Error), or "not found" (caller returns null instead of
 * throwing).
 *
 * Backoff: baseMs * 2^attempt → 2s, 4s, 8s at default baseMs=2000.
 * Per-attempt timeout: an AbortController is passed via `signal` to the
 * callback. The callback MUST honor it (pass through to fetch).
 *
 * SAFETY on non-idempotent operations:
 *   - `getLoopSubscriptionById` / list / status reads: fully safe.
 *   - `cancelLoopSubscription`: Loop's cancel action is idempotent — canceling
 *     an already-CANCELLED contract returns success (verified in Loop's docs
 *     and confirmed via the segmentation.csv workflow, where re-cancels are
 *     no-ops). Retrying a cancel that partially executed is therefore safe.
 *   - Frequency/pause/resume mutations: the ones we retry today are still
 *     safe because they set desired end-state rather than incrementing a
 *     counter; the second retry converges on the same state.
 *   - `swapLoopSubscriptionProduct`: also state-setting (variant + quantity),
 *     so re-applying it is a no-op.
 */
export async function withLoopRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: WithLoopRetryOpts
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseMs = opts.baseMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const { label } = opts;

  let lastError: unknown;

  for (let attempt = 0; attempt < retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fn(ctrl.signal);
    } catch (err) {
      lastError = err;
      const retryable =
        isAbortError(err) ||
        isNetworkError(err) ||
        err instanceof LoopRetryableHttpError;
      const isLastAttempt = attempt === retries - 1;
      if (!retryable || isLastAttempt) {
        throw err;
      }
      const backoffMs = baseMs * Math.pow(2, attempt);
      console.log(
        `[loopAdmin] retry attempt ${attempt + 1}/${retries} for ${label} ` +
          `(reason=${err instanceof Error ? err.name : "unknown"}, backoff=${backoffMs}ms)`
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

/**
 * Wrap `fetch` for Loop admin calls: applies the retry wrapper + per-attempt
 * abort signal, and converts retryable HTTP statuses (5xx, 429) into a
 * `LoopRetryableHttpError` so the wrapper knows to back off.
 */
async function loopFetch(
  url: string,
  options: RequestInit,
  label: string
): Promise<Response> {
  return withLoopRetry(async (signal) => {
    const res = await fetch(url, { ...options, signal });
    if (res.status >= 500 || res.status === 429) {
      const bodyText = await res.text().catch(() => "");
      throw new LoopRetryableHttpError(
        res.status,
        `Loop ${label} ${res.status}: ${bodyText.slice(0, 200)}`
      );
    }
    return res;
  }, { label });
}

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
  const res = await loopFetch(url, { headers: getLoopHeaders() }, `getLoopSubscriptionStatus(${customerIdentifier})`);

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
  const res = await loopFetch(url, { headers: getLoopHeaders() }, `getLoopRawSubscriptions(${customerIdentifier})`);
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
  const res = await loopFetch(url, { headers: getLoopHeaders() }, `getLoopSubscriptionById(${subscriptionId})`);
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
  const res = await loopFetch(
    url,
    {
      method: "POST",
      headers: getLoopHeaders(),
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    `loopSubscriptionMutation(${subscriptionId}, ${action})`
  );
  if (!res.ok) {
    throw new Error(`Loop ${action} error ${res.status}: ${await res.text()}`);
  }
}

const STOREFRONT_BASE_URL = BASE_URL.replace("/admin/", "/storefront/");

async function generateLoopSessionToken(shopifyCustomerId: string): Promise<string> {
  const url = `${BASE_URL}/customer/${encodeURIComponent(shopifyCustomerId)}/sessionToken`;
  const res = await loopFetch(url, { method: "POST", headers: getLoopHeaders() }, `generateLoopSessionToken(${shopifyCustomerId})`);
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
  const res = await loopFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken }),
    },
    "exchangeLoopSessionTokenForAccessToken"
  );
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

  const res = await loopFetch(
    url,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    },
    `swapLoopSubscriptionProduct(${subscriptionId})`
  );

  if (!res.ok) {
    throw new Error(`Loop swap error ${res.status}: ${await res.text()}`);
  }
}

/**
 * Update the custom attributes on a subscription line item, WITHOUT
 * swapping the product. Used by the B9 backfill: submitted members
 * have fit data in Supabase `b9_migrations.fit_attributes` that never
 * made it onto their Loop line, so packing wouldn't see it at renewal.
 *
 * NOTE: This does NOT change variant, quantity, or selling plan. Product
 * swap remains manual per Drew's instruction. Do not add a swap call here.
 */
export async function updateLoopSubscriptionLineAttributes(params: {
  shopifyCustomerId: string;
  subscriptionId: string;
  lineId: string;
  attributes: Record<string, string>;
}): Promise<{ status: number; response: unknown }> {
  const { shopifyCustomerId, subscriptionId, lineId, attributes } = params;

  const sessionToken = await generateLoopSessionToken(shopifyCustomerId);
  const accessToken = await exchangeLoopSessionTokenForAccessToken(sessionToken);

  const attrArray = Object.entries(attributes)
    .filter(([k, v]) => k && v != null && String(v).trim().length > 0)
    .map(([key, value]) => ({ key, value: String(value) }));

  const url = `${STOREFRONT_BASE_URL}/subscription/${encodeURIComponent(subscriptionId)}/line/${encodeURIComponent(lineId)}/attribute`;

  const res = await loopFetch(
    url,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ attributes: attrArray }),
    },
    `updateLoopSubscriptionLineAttributes(${subscriptionId})`
  );

  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* keep raw */ }

  if (!res.ok) {
    throw new Error(`Loop line-attribute error ${res.status}: ${text}`);
  }
  return { status: res.status, response: parsed };
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
 * Update the next billing date for a subscription, preserving the existing
 * billing and delivery policies.
 */
export async function updateLoopSubscriptionNextBillingDate(
  subscriptionId: string,
  nextBillingDateEpoch: number
): Promise<void> {
  const sub = (await getLoopSubscriptionById(subscriptionId)) as Record<string, unknown> | null;
  const billingPolicy = sub?.billingPolicy as Record<string, unknown> | undefined;
  const deliveryPolicy = sub?.deliveryPolicy as Record<string, unknown> | undefined;

  if (!billingPolicy && !deliveryPolicy) {
    throw new Error(
      `Loop subscription ${subscriptionId} is missing both billingPolicy and deliveryPolicy — refusing to guess a cadence`
    );
  }
  if (!billingPolicy) {
    throw new Error(
      `Loop subscription ${subscriptionId} is missing billingPolicy — refusing to guess a cadence`
    );
  }
  if (!deliveryPolicy) {
    throw new Error(
      `Loop subscription ${subscriptionId} is missing deliveryPolicy — refusing to guess a cadence`
    );
  }

  const url = `${BASE_URL}/subscription/${encodeURIComponent(subscriptionId)}/frequency`;
  const res = await loopFetch(
    url,
    {
      method: "PUT",
      headers: getLoopHeaders(),
      body: JSON.stringify({ billingPolicy, deliveryPolicy, discountType: "OLD", nextBillingDateEpoch }),
    },
    `updateLoopSubscriptionNextBillingDate(${subscriptionId})`
  );
  if (!res.ok) {
    throw new Error(`Loop frequency error ${res.status}: ${await res.text()}`);
  }
}

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
