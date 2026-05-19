/**
 * Gift order — shared types + Firestore helpers for the gifting Phase 2 pipeline.
 *
 * Lifecycle:
 *   1. Purchaser checks out via /lp/gift  → Shopify order with `gift=true`
 *      cart attribute (becomes `note_attributes` on the order)
 *   2. orders-paid webhook detects gift, creates a `gift_orders` doc with
 *      status="pending_recipient_email", picks a send time (now or scheduled)
 *   3. Cron /api/gifts/scheduled-send → sends recipient email when due,
 *      flips status to "recipient_emailed"
 *   4. Recipient clicks the link → /gift-sizing/<token> → submits sizing form
 *      → status becomes "sizing_collected"
 *   5. First box ships (Shopify fulfillments/create webhook) → orders shipped,
 *      cron /api/gifts/post-first-shipment cancels the Loop subscription so
 *      the recipient is not auto-rebilled in Q2 → status becomes
 *      "completed"  (the recipient can manually reactivate from /account)
 *
 * Firestore collection: `gift_orders`
 */

import { adminDb } from "@/lib/firebase-admin";
import { randomBytes } from "crypto";

export type GiftOrderStatus =
  | "pending_recipient_email"
  | "recipient_emailed"
  | "sizing_collected"
  | "first_box_shipped"
  | "completed"
  | "errored"
  | "cancelled";

export interface GiftOrderDoc {
  /** Document ID = Shopify order id (string). */
  shopify_order_id: string;
  shopify_order_number: string;
  shopify_customer_id: string | null;
  /** Purchaser (the buyer) email — already in our system as a normal user. */
  purchaser_email: string;
  purchaser_first_name: string | null;
  /** Recipient details collected on /lp/gift checkout. */
  recipient_email: string;
  recipient_first_name: string | null;
  /** Optional message the purchaser wrote — included in the recipient email. */
  gift_message: string | null;
  /** YYYY-MM-DD or null (send today). Stored as ISO date. */
  deliver_on: string | null;
  /** Random token used as the link slug for the recipient sizing page. */
  sizing_token: string;
  /** Order value for analytics / admin display. */
  total_price: number;
  currency: string;
  /** Lifecycle state. */
  status: GiftOrderStatus;
  status_history: Array<{ status: GiftOrderStatus; at: number; note?: string }>;
  /** Timestamps. */
  created_at: number;
  updated_at: number;
  recipient_emailed_at: number | null;
  sizing_collected_at: number | null;
  first_box_shipped_at: number | null;
  completed_at: number | null;
  /** Sizing data the recipient submitted (mirrors onboarding sizing fields). */
  sizing: Record<string, string> | null;
  /** Loop / cancellation tracking. */
  loop_subscription_id: string | null;
  cancellation_attempted_at: number | null;
  last_error: string | null;
}

export function createSizingToken(): string {
  // 24 random bytes → 32-char URL-safe base64. Plenty of entropy for a
  // share-once gift link.
  return randomBytes(24).toString("base64url");
}

/** Read a gift attribute by key, case-insensitive. */
export function readGiftAttribute(
  noteAttributes: Array<{ name: string; value: string }> | undefined,
  key: string
): string | null {
  if (!noteAttributes) return null;
  const found = noteAttributes.find(
    (a) => a.name?.toLowerCase() === key.toLowerCase()
  );
  const value = found?.value?.trim();
  return value ? value : null;
}

/** Returns true iff the Shopify order was placed via the gift LP funnel. */
export function isGiftOrder(
  noteAttributes: Array<{ name: string; value: string }> | undefined
): boolean {
  return (
    readGiftAttribute(noteAttributes, "gift")?.toLowerCase() === "true" ||
    !!readGiftAttribute(noteAttributes, "gift_recipient_email")
  );
}

const COLLECTION = "gift_orders";

export async function createGiftOrderDoc(
  input: Omit<
    GiftOrderDoc,
    | "status_history"
    | "created_at"
    | "updated_at"
    | "recipient_emailed_at"
    | "sizing_collected_at"
    | "first_box_shipped_at"
    | "completed_at"
    | "sizing"
    | "loop_subscription_id"
    | "cancellation_attempted_at"
    | "last_error"
  >
): Promise<void> {
  const now = Date.now();
  const doc: GiftOrderDoc = {
    ...input,
    status_history: [{ status: input.status, at: now, note: "created" }],
    created_at: now,
    updated_at: now,
    recipient_emailed_at: null,
    sizing_collected_at: null,
    first_box_shipped_at: null,
    completed_at: null,
    sizing: null,
    loop_subscription_id: null,
    cancellation_attempted_at: null,
    last_error: null,
  };
  await adminDb.collection(COLLECTION).doc(input.shopify_order_id).set(doc);
}

export async function getGiftOrderById(
  shopifyOrderId: string
): Promise<GiftOrderDoc | null> {
  const snap = await adminDb.collection(COLLECTION).doc(shopifyOrderId).get();
  return snap.exists ? (snap.data() as GiftOrderDoc) : null;
}

export async function getGiftOrderByToken(
  token: string
): Promise<{ id: string; data: GiftOrderDoc } | null> {
  const snap = await adminDb
    .collection(COLLECTION)
    .where("sizing_token", "==", token)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, data: d.data() as GiftOrderDoc };
}

export async function updateGiftOrderStatus(
  shopifyOrderId: string,
  status: GiftOrderStatus,
  extra: Partial<GiftOrderDoc> = {},
  note?: string
): Promise<void> {
  const ref = adminDb.collection(COLLECTION).doc(shopifyOrderId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const data = snap.data() as GiftOrderDoc;

  const now = Date.now();
  const updates: Record<string, unknown> = {
    status,
    updated_at: now,
    status_history: [
      ...(data.status_history ?? []),
      { status, at: now, note: note ?? "" },
    ],
    ...extra,
  };
  await ref.update(updates);
}

/** Returns the gift orders that need their recipient email sent now. */
export async function getDueGiftOrders(nowMs: number): Promise<
  Array<{ id: string; data: GiftOrderDoc }>
> {
  const snap = await adminDb
    .collection(COLLECTION)
    .where("status", "==", "pending_recipient_email")
    .get();

  const todayIso = new Date(nowMs).toISOString().slice(0, 10);

  return snap.docs
    .map((d) => ({ id: d.id, data: d.data() as GiftOrderDoc }))
    .filter(({ data }) => {
      if (!data.deliver_on) return true; // null = send immediately
      // Send when the deliver_on date is today or earlier (UTC).
      return data.deliver_on <= todayIso;
    });
}

/**
 * Gift orders that have shipped their first box but the Loop sub hasn't been
 * cancelled yet — picked up by the post-first-shipment cron.
 */
export async function getGiftOrdersAwaitingCancel(): Promise<
  Array<{ id: string; data: GiftOrderDoc }>
> {
  const snap = await adminDb
    .collection(COLLECTION)
    .where("status", "==", "first_box_shipped")
    .get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() as GiftOrderDoc }));
}
