/**
 * POST /api/webhooks/shopify/orders-paid
 *
 * Shopify webhook: orders/paid
 * Verifies the HMAC signature, then fires a "purchase" event
 * through the analytics + KPI pipeline.
 *
 * Required env vars:
 *   SHOPIFY_WEBHOOK_SECRET — the secret set on the webhook in Shopify admin
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyHmac } from "@/lib/events/verify";
import { mirrorLegacyShopifyDelivery } from "@/lib/events/ingest";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { dispatchAnalyticsEvent } from "@/app/api/_lib/analytics";
import { getClientIp } from "@/app/api/_lib/clientIp";
import {
  persistAnalyticsEvent,
  aggregateKpiDaily,
} from "@/app/api/_lib/kpiReporting";
import { adminDb, adminAuth } from "@/lib/firebase-admin";
import { sendPlainText } from "@/lib/email/resend";
import { resolveMemberTierFromVariantId } from "@/lib/membershipConfig";
import {
  startFlow,
  completeSequence,
  type EmailFlow,
} from "@/lib/email/sequences";
import { markProfilesConvertedByEmail } from "@/lib/styleProfiles/admin";
import {
  isGiftOrder,
  readGiftAttribute,
  createGiftOrderDoc,
  createSizingToken,
} from "@/lib/gifts/giftOrder";
import {
  claimFoundingHundred,
  FOUNDING_100_CART_ATTR_KEY,
  getFoundingHundredVariantGid,
} from "@/lib/foundingHundred";
import { processSponsorship } from "@/app/api/_lib/sponsorship";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { provisionPaidMemberFromLoop } from "@/app/api/_lib/provisionPaidMember";

/**
 * Extracts the numeric variant id from the rangefinder variant GID env var,
 * or returns null if not configured.
 */
function getFoundingHundredVariantNumericId(): number | null {
  const gid = getFoundingHundredVariantGid();
  if (!gid) return null;
  const match = gid.match(/(\d+)$/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

async function triggerEmailFlow(
  uid: string,
  email: string,
  firstName: string | null,
  flow: EmailFlow
): Promise<void> {
  try {
    await startFlow(uid, email, firstName, flow);
    console.log(`[orders-paid] email flow=${flow} started for uid=${uid}`);
  } catch (err) {
    console.error("[orders-paid] email flow trigger failed:", err);
  }
}

// ─── HMAC verification ────────────────────────────────────────────────────────


async function isDuplicateWebhook(request: NextRequest): Promise<boolean> {
  const webhookId = request.headers.get("x-shopify-webhook-id");
  if (!webhookId) return false;

  const dedupeKey = `shopify-orders-paid:${webhookId}`;
  const ref = adminDb.collection("webhook_receipts").doc(dedupeKey);

  try {
    const existing = await ref.get();
    if (existing.exists) return true;

    await ref.set({
      webhook_id: webhookId,
      topic: request.headers.get("x-shopify-topic") ?? "orders/paid",
      provider: "shopify",
      received_at: Date.now(),
    });
  } catch (err) {
    // Non-fatal: if dedupe storage is unavailable, continue processing.
    console.error("[orders-paid] webhook dedupe check failed:", err);
  }

  return false;
}

// ─── Tier resolution ──────────────────────────────────────────────────────────

type MemberTier = "free" | "access" | "member" | "black";
type UserDocSnapshot = QueryDocumentSnapshot<Record<string, unknown>>;

function resolveTierFromLineItems(
  lineItems: { variant_id: number | null }[]
): MemberTier | null {
  for (const item of lineItems) {
    const tier = resolveMemberTierFromVariantId(item.variant_id);
    if (tier) return tier;
  }
  return null;
}

async function findFirstUserByField(
  field: "shopify_customer_id" | "email",
  value?: string | null
): Promise<UserDocSnapshot | null> {
  if (!value) return null;

  const snap = await adminDb
    .collection("users")
    .where(field, "==", value)
    .limit(1)
    .get();

  return snap.empty ? null : (snap.docs[0] as UserDocSnapshot);
}

function getShopifyCustomerIdCandidates(customerId?: string): string[] {
  if (!customerId) return [];

  const trimmed = customerId.trim();
  if (!trimmed) return [];

  const numericId = trimmed.match(/(\d+)$/)?.[1] ?? trimmed;
  const gid = `gid://shopify/Customer/${numericId}`;

  return Array.from(new Set([trimmed, numericId, gid]));
}

async function resolvePurchaseUserDoc(
  shopifyCustomerId?: string,
  email?: string
): Promise<UserDocSnapshot | null> {
  for (const candidate of getShopifyCustomerIdCandidates(shopifyCustomerId)) {
    const userDoc = await findFirstUserByField("shopify_customer_id", candidate);
    if (userDoc) return userDoc;
  }

  return (await findFirstUserByField("email", email)) ?? null;
}

// ─── Shopify order shape (minimal) ───────────────────────────────────────────

interface ShopifyLineItem {
  id: number;
  title: string;
  quantity: number;
  price: string;
  sku: string | null;
  variant_id: number | null;
  product_id: number | null;
  vendor: string | null;
  fulfillment_status: string | null;
  requires_shipping: boolean;
  taxable: boolean;
  total_discount: string;
  /** Survey/custom attributes from the purchase flow */
  properties: Array<{ name: string; value: string }> | null;
}

interface ShopifyOrder {
  id: number;
  order_number: number;
  name: string;
  email: string | null;
  phone: string | null;
  total_price: string;
  subtotal_price: string;
  total_tax: string;
  total_shipping_price_set?: { shop_money?: { amount?: string } } | null;
  total_discounts: string;
  currency: string;
  financial_status: string | null;
  fulfillment_status: string | null;
  created_at: string;
  processed_at: string | null;
  cancelled_at: string | null;
  source_name: string | null;
  note: string | null;
  discount_codes: Array<{ code: string }> | null;
  tags: string;
  browser_ip?: string | null;
  client_details?: {
    browser_ip?: string | null;
    user_agent?: string | null;
  } | null;
  customer?: {
    id: number;
    email: string | null;
    first_name?: string | null;
    /**
     * Total number of orders the customer has placed on the store.
     * Shopify webhooks populate this on the customer sub-object.
     * We use === 1 as the source of truth for "first purchase" — it is
     * more reliable than deriving from our own Firestore tier_paid_at
     * because tier_paid_at can be reset on churn, incorrectly marking
     * a resubscribe as a new signup.
     */
    orders_count?: number | null;
  };
  shipping_address?: {
    city?: string | null;
    province?: string | null;
    country?: string | null;
  } | null;
  billing_address?: {
    city?: string | null;
    province?: string | null;
    country?: string | null;
  } | null;
  shipping_lines?: Array<{ title?: string | null }> | null;
  line_items: ShopifyLineItem[];
  /** Shopify carries cart attributes here on the order. */
  note_attributes?: Array<{ name: string; value: string }>;
}

// ─── Supabase persistence ─────────────────────────────────────────────────────

/**
 * Upserts the order and all its line items into Supabase.
 * Runs after the webhook response is queued — non-fatal, never blocks 200.
 *
 * Line item `properties` array is flattened into a { key: value } JSONB
 * object, matching the shape the backfill cron uses for customAttributes.
 * This is what stg_shopify__customer_sizes reads for sizing data.
 */
async function persistOrderToSupabase(order: ShopifyOrder): Promise<void> {
  try {
    const sb = getSupabaseService();
    const isSub = /subscription/i.test(order.tags ?? "");
    const discountCode =
      order.discount_codes?.[0]?.code ??
      (order.note_attributes?.find((a) => a.name === "discount_code")?.value ?? null);

    // ── Upsert order row ──────────────────────────────────────────────────
    const { error: orderErr } = await sb.from("orders").upsert(
      {
        id: order.id,
        name: order.name,
        email: order.email ?? null,
        financial_status: order.financial_status ?? null,
        fulfillment_status: order.fulfillment_status ?? null,
        total: order.total_price,
        subtotal: order.subtotal_price ?? null,
        shipping_amount:
          order.total_shipping_price_set?.shop_money?.amount ?? null,
        taxes: order.total_tax ?? null,
        discount_code: discountCode,
        discount_amount: order.total_discounts ?? null,
        refunded_amount: 0,
        currency: order.currency,
        shipping_method: order.shipping_lines?.[0]?.title ?? null,
        tags: order.tags || null,
        source: order.source_name ?? null,
        risk_level: null,
        notes: order.note ?? null,
        cancelled_at: order.cancelled_at ?? null,
        paid_at: order.processed_at ?? null,
        fulfilled_at: null,
        created_at: order.created_at,
        is_subscription: isSub,
        shipping_city: order.shipping_address?.city ?? null,
        shipping_province: order.shipping_address?.province ?? null,
        shipping_country: order.shipping_address?.country ?? null,
        billing_city: order.billing_address?.city ?? null,
        billing_province: order.billing_address?.province ?? null,
        billing_country: order.billing_address?.country ?? null,
      },
      { onConflict: "id" }
    );

    if (orderErr) {
      console.error("[orders-paid] supabase order upsert failed:", orderErr.message);
      return;
    }

    // ── Upsert line items ─────────────────────────────────────────────────
    if (!order.line_items?.length) return;

    const lineRows = order.line_items.map((li) => {
      // Flatten properties array → { key: value } JSONB
      const props: Record<string, string | null> = {};
      for (const p of li.properties ?? []) {
        if (p && typeof p.name === "string") props[p.name] = p.value ?? null;
      }

      return {
        order_id: order.id,
        // Shopify REST webhook uses numeric line item id; use gid-style for
        // consistency with the backfill which uses the GraphQL Admin API.
        // Both are unique per line item so either works as the conflict key.
        shopify_line_id: `gid://shopify/LineItem/${li.id}`,
        product_id: li.product_id ? String(li.product_id) : null,
        variant_id: li.variant_id ? String(li.variant_id) : null,
        variant_title: null,
        product_type: null,
        sku: li.sku ?? null,
        title: li.title ?? null,
        vendor: li.vendor ?? null,
        quantity: li.quantity ?? 0,
        price: li.price ?? null,
        total_discount: li.total_discount ?? null,
        fulfillment_status: li.fulfillment_status ?? null,
        requires_shipping: li.requires_shipping ?? null,
        selling_plan_id: null,
        selling_plan_name: null,
        taxable: li.taxable ?? null,
        properties: Object.keys(props).length > 0 ? props : null,
        raw: li,
      };
    });

    const { error: liErr } = await sb
      .from("order_line_items")
      .upsert(lineRows, { onConflict: "shopify_line_id" });

    if (liErr) {
      console.error("[orders-paid] supabase line_items upsert failed:", liErr.message);
      return;
    }

    console.log(
      `[orders-paid] supabase persisted order=${order.id} line_items=${lineRows.length}`
    );
  } catch (err) {
    // Never let a Supabase write failure affect the webhook 200 response.
    console.error("[orders-paid] supabase persist threw:", err);
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Read raw body first (needed for HMAC before JSON.parse)
  const rawBody = await request.text();

  // ── Verify webhook signature ──────────────────────────────────────────────
  const isValid = verifyShopifyHmac(request.headers, rawBody);
  if (!isValid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await mirrorLegacyShopifyDelivery(request.headers, rawBody, "orders/paid");

  const isDuplicate = await isDuplicateWebhook(request);
  if (isDuplicate) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  // ── Parse order ───────────────────────────────────────────────────────────
  let order: ShopifyOrder;
  try {
    order = JSON.parse(rawBody) as ShopifyOrder;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = order.email ?? order.customer?.email ?? undefined;
  const shopifyCustomerId = order.customer?.id?.toString();
  const value = parseFloat(order.total_price);
  let purchaseUserDoc: UserDocSnapshot | null = null;
  try {
    purchaseUserDoc = await resolvePurchaseUserDoc(shopifyCustomerId, email);
  } catch (err) {
    console.error("[orders-paid] user lookup failed:", err);
  }
  const firebaseUid = purchaseUserDoc?.id;
  const purchaseDistinctId =
    firebaseUid ??
    email ??
    (shopifyCustomerId ? `shopify-${shopifyCustomerId}` : `shopify-${order.id}`);

  // Pull the ad-click attribution so the purchase conversion can be tied
  // back to its original Google Ads / Meta click. Fallback chain:
  //   1. order.note_attributes  (set on LP via attribution.ts → cart attrs)
  //   2. purchaseUserDoc.signup_utm  (legacy: captured at user signup)
  const signupUtm = (purchaseUserDoc?.data()?.signup_utm ?? null) as
    | Record<string, unknown>
    | null;
  const orderAttr = (key: string): string | undefined => {
    const found = order.note_attributes?.find((a) => a.name === key);
    const v = found?.value;
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };
  const utmString = (key: string): string | undefined => {
    const fromOrder = orderAttr(key);
    if (fromOrder) return fromOrder;
    const v = signupUtm?.[key];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };
  const shopperIp =
    getClientIp(new Headers({ "x-forwarded-for": order.browser_ip ?? "" })) ??
    getClientIp(
      new Headers({
        "x-forwarded-for": order.client_details?.browser_ip ?? "",
      })
    );

  const gaClientId = orderAttr("ga_client_id");
  // mully_anon_id is the PostHog anon distinct_id. Preferred over ga_client_id
  // because it's the same id the client-side SDK uses — so PostHog's alias
  // machinery merges the pre-signup anonymous person into the identified
  // purchase person. Fallback to gaClientId preserves the legacy behavior
  // for any orders still in flight from before this deploy.
  const mullyAnonId = orderAttr("mully_anon_id");
  const anonDistinctId = mullyAnonId ?? gaClientId;

  // ── Purchase enrichment (added 2026-07-18) ──────────────────────────────
  // 1) is_first_purchase: true iff this is the user's FIRST paid order.
  //    Derived from the Firestore user doc: absence of tier_paid_at means
  //    the tierUpdate below will be the one that stamps it. We check BEFORE
  //    the tierUpdate mutation runs so we're not racing our own write.
  // 2) purchase_type: "subscription" | "proshop" | "mixed" | "gift". Lets
  //    downstream insights partition new-sub events from renewals and
  //    pro-shop-only purchases without HogQL heuristics.
  // 3) sponsorship_ref: the raw mully_sponsor cart attribute, present iff
  //    the purchase used a sponsorship code. Attributing this here rather
  //    than in a downstream event means every purchase is queryable for
  //    referral share in a single-tile insight.
  const purchaseUserData = purchaseUserDoc?.data() as
    | { tier_paid_at?: number | null }
    | undefined;
  // Prefer Shopify's own customer.orders_count when present — it is
  // authoritative and immune to our own tier_paid_at getting reset on
  // churn. Fall back to the Firestore tier_paid_at signal for orders
  // that arrive without an attached customer (rare).
  const shopifyOrdersCount = order.customer?.orders_count;
  const isFirstPurchase =
    typeof shopifyOrdersCount === "number"
      ? shopifyOrdersCount === 1
      : !purchaseUserData?.tier_paid_at;
  // Shopify source_name identifies which sales channel the order came
  // from. Verified against production data (queried 2026-07-21):
  //   - "channel:7831744"                  = newreserve Storefront API
  //                                          (the mymully.com landing-page
  //                                          checkout — what we mean by
  //                                          "headless"). Confirmed by
  //                                          publication.name = "Mullybox
  //                                          Headless" on the same orders.
  //   - "subscription_contract_checkout_one" = Loop renewal (Subscription
  //                                          Recurring Order tag).
  //   - "shopify_draft_order"               = admin-created draft order.
  //   - "web"                               = main storefront checkout.
  //
  // We normalize the source_name into a stable `source_channel` string so
  // downstream insights can filter without knowing raw Shopify channel
  // IDs. `is_headless` becomes the boolean flag most tiles care about.
  const rawSourceName = order.source_name ?? null;
  const tagList = (order.tags ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase());
  const isSubscriptionFirst = tagList.includes("subscription first order");
  const isSubscriptionRecurring = tagList.includes(
    "subscription recurring order",
  );

  let sourceChannel: string;
  if (rawSourceName === "channel:7831744") sourceChannel = "headless";
  else if (rawSourceName === "subscription_contract_checkout_one")
    sourceChannel = "loop_renewal";
  else if (rawSourceName === "web") sourceChannel = "web";
  else if (rawSourceName === "shopify_draft_order")
    sourceChannel = "draft_order";
  else if (rawSourceName) sourceChannel = rawSourceName;
  else sourceChannel = "unknown";

  // Kept for backward compatibility with existing tiles that still filter
  // by `properties.channel`. New tiles should filter on `source_channel`
  // or `is_headless`.
  const channel = sourceChannel;
  const isHeadless = sourceChannel === "headless";

  const orderIsGift = isGiftOrder(order.note_attributes);
  const purchaseType: "subscription" | "proshop" | "mixed" | "gift" = (() => {
    if (orderIsGift) return "gift";
    let hasSub = false;
    let hasProshop = false;
    for (const item of order.line_items) {
      const tier = resolveMemberTierFromVariantId(item.variant_id);
      // resolveMemberTierFromVariantId returns "access" | "member" | null.
      // Null means the variant isn't a subscription tier → pro-shop item.
      if (tier) hasSub = true;
      else hasProshop = true;
    }
    if (hasSub && hasProshop) return "mixed";
    if (hasSub) return "subscription";
    return "proshop";
  })();

  const sponsorshipRef = orderAttr("mully_sponsor") ?? null;

  const event = {
    event_name: "purchase" as const,
    user_id: purchaseDistinctId,
    anonymous_id: anonDistinctId,
    email,
    ip: shopperIp,
    user_agent: order.client_details?.user_agent ?? undefined,
    properties: {
      order_id: String(order.order_number),
      shopify_order_id: String(order.id),
      transaction_id: orderAttr("mully_txn_id") ?? String(order.order_number),
      shopify_customer_id: shopifyCustomerId,
      reserve_user_id: firebaseUid,
      value,
      currency: order.currency,
      items: order.line_items.map((item) => ({
        id: item.sku ?? String(item.id),
        name: item.title,
        quantity: item.quantity,
        price: parseFloat(item.price),
        variant_id: item.variant_id,
      })),
      gclid: utmString("gclid"),
      gbraid: utmString("gbraid"),
      wbraid: utmString("wbraid"),
      fbp: utmString("fbp"),
      fbc: utmString("fbc"),
      fbclid: utmString("fbclid"),
      utm_source: utmString("utm_source"),
      utm_medium: utmString("utm_medium"),
      utm_campaign: utmString("utm_campaign"),
      utm_content: utmString("utm_content"),
      utm_term: utmString("utm_term"),
      ga_client_id: gaClientId,
      mully_anon_id: mullyAnonId,
      is_first_purchase: isFirstPurchase,
      purchase_type: purchaseType,
      sponsorship_ref: sponsorshipRef,
      channel,
      source_channel: sourceChannel,
      source_name_raw: rawSourceName,
      is_headless: isHeadless,
      is_subscription_first_order: isSubscriptionFirst,
      is_subscription_recurring_order: isSubscriptionRecurring,
      shopify_orders_count: shopifyOrdersCount ?? null,
      // /lp/consult A/B stamps: passed through from Shopify cart
      // attributes (set by ReserveCheckoutCTA) so purchase events can be
      // split by modal_quiz vs inline_quiz downstream in PostHog. Only
      // present on orders whose visitor originated on /lp/consult; other
      // channels (subscription LP, org, direct) will report null.
      ab_variant: orderAttr("ab_variant") ?? null,
      mr_ab_bucket: (() => {
        const raw = orderAttr("mr_ab_bucket");
        if (!raw) return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      })(),
      quiz_profile_id: orderAttr("quiz_profile_id") ?? null,
      // Deterministic Meta CAPI dedup id. Format: purchase_<shopify_order_id>.
      // The client-side confirmation page at /auth/callback fires a matching
      // fbq('track','Purchase',{},{eventID: event_id}) using the same value,
      // and Meta then dedupes the server + browser Purchase into a single
      // conversion. Without this, Meta double-counts every ad-driven order.
      event_id: `purchase_${order.id}`,
    },
    timestamp: Math.floor(Date.now() / 1000),
  };

  const eventId = randomUUID();

  // ── Update Firestore user tier + trigger email flow ──────────────────────
  // Two paths:
  //   1. Line items resolve to a known membership variant → use the existing
  //      inline provisioning below. This is the fast path for new-flow
  //      Shopify checkouts and matches behavior that's already in production.
  //   2. Line items don't resolve but the customer has an ACTIVE Loop
  //      subscription (typical for legacy Back 9 subscribers renewing via
  //      Loop, or any SKU not in NEXT_PUBLIC_SHOPIFY_*_VARIANT_IDS) → fall
  //      back to provisionPaidMemberFromLoop so we still create the Firebase
  //      user + magic link email instead of silently doing nothing.
  const tierUpdate = email && !isGiftOrder(order.note_attributes)
    ? (async () => {
        const tier = resolveTierFromLineItems(order.line_items);
        if (!tier || tier === "free") {
          // Fallback: even without a matching line item, Loop may already
          // consider this customer active. Provision only if so.
          try {
            const result = await provisionPaidMemberFromLoop(email, {
              source: "orders_paid_webhook",
              firstName: order.customer?.first_name ?? null,
            });
            if (result.status === "provisioned") {
              console.log(
                `[orders-paid] Loop fallback provisioned uid=${result.uid} tier=${result.tier}`
              );
            }
          } catch (err) {
            console.error("[orders-paid] Loop fallback failed:", err);
          }
          return;
        }
        try {
          const emailFlow = tier === "member" || tier === "black" ? "member" : "access";

          if (!purchaseUserDoc) {
            let uid: string;
            try {
              const newUser = await adminAuth.createUser({ email });
              uid = newUser.uid;
            } catch {
              try {
                const existing = await adminAuth.getUserByEmail(email);
                uid = existing.uid;
              } catch (err) {
                console.error("[orders-paid] could not create or find Firebase user for", email, err);
                return;
              }
            }

            await adminDb.collection("users").doc(uid).set({
              email,
              tier,
              shopify_customer_id: shopifyCustomerId ?? null,
              onboarding_completed: false,
              created_at: Date.now(),
              updated_at: Date.now(),
              tier_paid_at: Date.now(),
              // Snapshot the just-paid order so the /auth/callback client
              // can fetch its value + Meta CAPI event_id for browser-side
              // dedup without re-hitting Shopify. `event_id_captured` is
              // set to false until the browser fires its Purchase pixel
              // and pings /api/purchase-context, then flipped to true so
              // refreshes don't re-fire.
              latest_purchase: {
                shopify_order_id: String(order.id),
                order_number: String(order.order_number),
                value: Number(value),
                currency: order.currency,
                event_id: `purchase_${order.id}`,
                paid_at: Date.now(),
                event_id_captured: false,
              },
            });

            const magicLink = await adminAuth.generateSignInWithEmailLink(email, {
              url: "https://mymully.com/login?paid=1",
              handleCodeInApp: true,
            });

            const firstName = order.customer?.first_name ?? null;
            await sendPlainText({
              to: email,
              subject: "Unlock your Mully account",
              text: `Hey${firstName ? ` ${firstName}` : ""},\n\nYour membership is confirmed. Click the link below to unlock your dashboard:\n\n${magicLink}\n\nSee you inside,\nDrew`,
              disableTracking: true,
              sendClass: "transactional",
              category: "magic_link_unlock",
            });

            await triggerEmailFlow(uid, email, firstName, emailFlow);
          } else {
            const userDoc = purchaseUserDoc;
            const uid = userDoc.id;
            const userData = userDoc.data();
            const updates: Record<string, unknown> = {
              tier,
              updated_at: Date.now(),
              tier_paid_at: Date.now(),
              // Refresh the latest_purchase snapshot so /auth/callback can
              // dedup the CAPI Purchase for this order too, not just the
              // very first one. See the parallel comment above.
              latest_purchase: {
                shopify_order_id: String(order.id),
                order_number: String(order.order_number),
                value: Number(value),
                currency: order.currency,
                event_id: `purchase_${order.id}`,
                paid_at: Date.now(),
                event_id_captured: false,
              },
            };
            if (shopifyCustomerId && !userData.shopify_customer_id) {
              updates.shopify_customer_id = shopifyCustomerId;
            }
            await userDoc.ref.update(updates);

            const firstName = (userData.username as string | undefined) ?? null;
            await triggerEmailFlow(uid, email, firstName, emailFlow);
          }
        } catch (err) {
          console.error("[orders-paid] tier update failed:", err);
        }
      })()
    : Promise.resolve();

  const foundingClaim = (async () => {
    try {
      const tagged = orderAttr(FOUNDING_100_CART_ATTR_KEY) === "true";
      if (!tagged) return;
      const giftVariantId = getFoundingHundredVariantNumericId();
      if (!giftVariantId) {
        console.warn(
          "[orders-paid] founding_100: gift variant id not configured, skipping claim"
        );
        return;
      }
      const giftLine = order.line_items.find(
        (item) => item.variant_id === giftVariantId
      );
      if (!giftLine) {
        console.log(
          `[orders-paid] founding_100: cart was tagged but gift line not in paid order ${order.id} — not claiming slot (likely removed in checkout)`
        );
        return;
      }
      const newCount = await claimFoundingHundred(String(order.id));
      if (newCount !== null) {
        console.log(
          `[orders-paid] founding_100 claim recorded for order ${order.id} → ${newCount}/100`
        );
      }
    } catch (err) {
      console.error("[orders-paid] founding_100 claim failed:", err);
    }
  })();

  const sponsorshipAttribution = (async () => {
    try {
      const result = await processSponsorship(order);
      if (result.status === "attributed") {
        console.log(
          `[orders-paid] sponsorship attributed order=${order.id} id=${result.sponsorshipId} badges=${(result.newBadges ?? []).join(",") || "none"}`,
        );
      } else if (result.status === "skipped") {
        console.log(
          `[orders-paid] sponsorship skipped order=${order.id} reason=${result.reason}`,
        );
      }
    } catch (err) {
      console.error("[orders-paid] sponsorship processing failed:", err);
    }
  })();

  const reserveConversion = (async () => {
    if (!email) return;
    try {
      const convertedIds = await markProfilesConvertedByEmail({
        email,
        shopifyOrderId: String(order.id),
      });
      if (convertedIds.length === 0) return;
      await Promise.allSettled(
        convertedIds.map((profileId) => completeSequence(profileId))
      );
      console.log(
        `[orders-paid] reserve: converted=${convertedIds.length} profiles for email=${email} order=${order.id}`
      );
    } catch (err) {
      console.error("[orders-paid] reserve conversion halt failed:", err);
    }
  })();

  const giftPersist = (async () => {
    try {
      if (!isGiftOrder(order.note_attributes)) return;

      const recipientEmail = readGiftAttribute(
        order.note_attributes,
        "gift_recipient_email"
      );
      if (!recipientEmail) {
        console.warn(
          "[orders-paid] gift order missing recipient email — skipping gift_orders create",
          { order: order.id }
        );
        return;
      }

      const giftDocId = String(order.id);
      await createGiftOrderDoc({
        shopify_order_id: giftDocId,
        shopify_order_number: String(order.order_number),
        shopify_customer_id: shopifyCustomerId ?? null,
        purchaser_email: email ?? "",
        purchaser_first_name: order.customer?.first_name ?? null,
        recipient_email: recipientEmail,
        recipient_first_name: readGiftAttribute(
          order.note_attributes,
          "gift_recipient_name"
        ),
        gift_message: readGiftAttribute(order.note_attributes, "gift_message"),
        deliver_on: readGiftAttribute(order.note_attributes, "gift_deliver_on"),
        sizing_token: createSizingToken(),
        total_price: value,
        currency: order.currency,
        status: "pending_recipient_email",
      });
      console.log(
        `[orders-paid] gift_orders created for shopify order ${order.id} (recipient ${recipientEmail})`
      );
    } catch (err) {
      console.error("[orders-paid] gift_orders create failed:", err);
    }
  })();

  await Promise.allSettled([
    dispatchAnalyticsEvent(event),
    persistAnalyticsEvent(eventId, event),
    aggregateKpiDaily(event),
    tierUpdate,
    giftPersist,
    foundingClaim,
    sponsorshipAttribution,
    reserveConversion,
    // ── NEW: persist order + line items to Supabase ────────────────────────
    // Runs in parallel with analytics so it never delays the 200 response.
    // Non-fatal: all errors are caught inside persistOrderToSupabase.
    persistOrderToSupabase(order),
  ]);

  // Shopify expects a 200 response quickly or it will retry
  return NextResponse.json({ ok: true });
}
