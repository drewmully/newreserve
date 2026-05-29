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
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import crypto from "crypto";
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
import { startFlow, type EmailFlow } from "@/lib/email/sequences";
import {
  getLoopRawSubscriptions,
  swapLoopSubscriptionProduct,
} from "@/app/api/_lib/loopAdmin";
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

const LOOP_VARIANT_BY_TIER: Partial<Record<string, number>> = {
  member: 47601025122496,
  access: 47601025482944,
};

async function swapLoopSubscription(
  shopifyCustomerId: string,
  tier: string
): Promise<void> {
  const variantShopifyId = LOOP_VARIANT_BY_TIER[tier];
  if (!variantShopifyId) return;

  try {
    const subs = await getLoopRawSubscriptions(shopifyCustomerId);
    const activeSub = subs.find((s) => s.status === "ACTIVE");
    if (!activeSub) {
      console.log(`[orders-paid] no active Loop sub for customer ${shopifyCustomerId} — skipping swap`);
      return;
    }

    const lines = activeSub.lines as Array<{ id: string | number }> | undefined;
    const lineId = String(lines?.[0]?.id ?? "");
    if (!lineId) {
      console.warn(`[orders-paid] active Loop sub has no line for customer ${shopifyCustomerId}`);
      return;
    }

    await swapLoopSubscriptionProduct({
      shopifyCustomerId,
      subscriptionId: activeSub.id,
      lineId,
      variantShopifyId,
      quantity: 1,
    });

    console.log(`[orders-paid] Loop swap → ${tier} for customer ${shopifyCustomerId}`);
  } catch (err) {
    console.error(`[orders-paid] Loop swap failed for customer ${shopifyCustomerId}:`, err);
  }
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

async function verifyShopifyHmac(
  request: NextRequest,
  rawBody: string
): Promise<boolean> {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return false;

  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
  if (!hmacHeader) return false;

  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, "base64"),
      Buffer.from(hmacHeader, "base64")
    );
  } catch {
    return false;
  }
}

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
}

interface ShopifyOrder {
  id: number;
  order_number: number;
  email: string | null;
  phone: string | null;
  total_price: string;
  currency: string;
  browser_ip?: string | null;
  client_details?: {
    browser_ip?: string | null;
    user_agent?: string | null;
  } | null;
  customer?: {
    id: number;
    email: string | null;
    first_name?: string | null;
  };
  line_items: ShopifyLineItem[];
  /** Shopify carries cart attributes here on the order. */
  note_attributes?: Array<{ name: string; value: string }>;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Read raw body first (needed for HMAC before JSON.parse)
  const rawBody = await request.text();

  // ── Verify webhook signature ──────────────────────────────────────────────
  const isValid = await verifyShopifyHmac(request, rawBody);
  if (!isValid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const event = {
    event_name: "purchase" as const,
    user_id: purchaseDistinctId,
    email,
    ip: shopperIp,
    user_agent: order.client_details?.user_agent ?? undefined,
    properties: {
      order_id: String(order.order_number),
      shopify_order_id: String(order.id),
      // mully_txn_id is set on the LP at cart-creation time and round-trips
      // through Shopify in note_attributes. Using it as transaction_id lets
      // the client-side gtag fire on /auth/callback dedupe against this one.
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
      // Attribution carry-through — lets Google Ads / Meta CAPI credit the
      // original ad click for this purchase even though it landed via a
      // server-to-server Shopify webhook.
      gclid: utmString("gclid"),
      gbraid: utmString("gbraid"),
      wbraid: utmString("wbraid"),
      // Meta Pixel browser identifiers — captured client-side from the
      // _fbp/_fbc cookies on the LP and round-tripped through Shopify
      // checkout via cart note_attributes. dispatchAnalyticsEvent reads
      // these from event.properties and passes them into Meta CAPI's
      // user_data block, bumping match quality from ~30% (hashed email/IP
      // only) to ~80% (with browser identity).
      fbp: utmString("fbp"),
      fbc: utmString("fbc"),
      fbclid: utmString("fbclid"),
      utm_source: utmString("utm_source"),
      utm_medium: utmString("utm_medium"),
      utm_campaign: utmString("utm_campaign"),
      utm_content: utmString("utm_content"),
      utm_term: utmString("utm_term"),
    },
    timestamp: Math.floor(Date.now() / 1000),
  };

  const eventId = randomUUID();

  // ── Update Firestore user tier + trigger email flow ──────────────────────
  // For gift orders we skip this entirely — the purchaser is not the
  // member; the recipient becomes the member once they confirm sizing.
  const tierUpdate = email && !isGiftOrder(order.note_attributes)
    ? (async () => {
        const tier = resolveTierFromLineItems(order.line_items);
        if (!tier || tier === "free") return;
        try {
          const emailFlow = tier === "member" || tier === "black" ? "member" : "access";

          if (!purchaseUserDoc) {
            // New user from pre-auth paid onboarding flow — create Firebase account + send magic link
            let uid: string;
            try {
              const newUser = await adminAuth.createUser({ email });
              uid = newUser.uid;
            } catch {
              // User might already exist in Firebase Auth (edge case) — look them up
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
              utmCampaign: "magic_link",
            });

            await triggerEmailFlow(uid, email, firstName, emailFlow);
          } else {
            // Existing user — update tier only
            const userDoc = purchaseUserDoc;
            const uid = userDoc.id;
            const userData = userDoc.data();
            const updates: Record<string, unknown> = {
              tier,
              updated_at: Date.now(),
              tier_paid_at: Date.now(),
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

  const resolvedTier = email ? resolveTierFromLineItems(order.line_items) : null;
  const loopSwap =
    resolvedTier && shopifyCustomerId && LOOP_VARIANT_BY_TIER[resolvedTier]
      ? swapLoopSubscription(shopifyCustomerId, resolvedTier)
      : Promise.resolve();

  // ── Founding 100 claim: defense-in-depth.
  // Only claim a slot if BOTH:
  //   (a) the cart was tagged with the gift attribute (set at checkout creation), AND
  //   (b) the rangefinder variant is actually present in the paid order's line_items.
  // (b) defends against a customer removing the gift line from checkout — in
  //     that case we do NOT burn a founding slot.
  // Idempotent on order id via the ring-buffer in claimFoundingHundred,
  // so webhook retries are safe.
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

  // ── Sponsorship attribution ────────────────────────────────────────────
  // If the cart carried a mully_sponsor attribute AND the order is a paid
  // membership, attribute the sponsorship, evaluate badges, and fire emails.
  // Idempotent on shopify_order_id. Never blocks the webhook response.
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

  // ── Gift Phase 2: persist a gift_orders doc if this purchase was a gift ──
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

      // Don't double-create on webhook retries — Shopify retries trigger
      // the dedupe path above, but belt-and-suspenders here.
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
    loopSwap,
    giftPersist,
    foundingClaim,
    sponsorshipAttribution,
  ]);

  // Shopify expects a 200 response quickly or it will retry
  return NextResponse.json({ ok: true });
}
