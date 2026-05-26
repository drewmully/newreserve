/**
 * Founding 100 gift logic.
 *
 * The first 100 paid Reserve Member signups receive a Precision Pro Nexus
 * rangefinder as a founding-member gift, attached as a $0 cart line at
 * checkout creation and decremented from a Firestore counter when the
 * orders-paid webhook fires.
 *
 * The counter document lives at /system_counters/founding_100 and has
 * shape:
 *   {
 *     claimed: number,      // public count shown on the LP tracker
 *     cap: number,          // 100
 *     active: boolean,      // kill switch; if false, no gifts attach
 *     last_order_ids: string[] // small ring buffer for idempotency
 *   }
 *
 * Public LP traffic reads the counter via /api/founding_100/status.
 * The cart-creation API reads it via the same endpoint and decides
 * whether to attach the rangefinder line. The orders-paid webhook
 * does the atomic increment using FieldValue.increment(1).
 */

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import {
  FOUNDING_100_DOC_PATH,
  FOUNDING_100_CART_ATTR_KEY,
} from "./foundingHundredConstants";

export { FOUNDING_100_DOC_PATH, FOUNDING_100_CART_ATTR_KEY };

export interface FoundingHundredStatus {
  claimed: number;
  cap: number;
  active: boolean;
  remaining: number;
  /** Whether the offer is currently available to new signups. */
  available: boolean;
}

/**
 * Returns the current counter status. Safe for both public read (LP
 * tracker) and server-side gate (checkout). Falls back to a safe
 * "inactive" state if Firestore is unreachable so we never accidentally
 * promise the gift when we can't verify.
 */
export async function getFoundingHundredStatus(): Promise<FoundingHundredStatus> {
  try {
    const snap = await adminDb.doc(FOUNDING_100_DOC_PATH).get();
    if (!snap.exists) {
      return { claimed: 0, cap: 100, active: false, remaining: 100, available: false };
    }
    const data = snap.data() ?? {};
    const claimed = typeof data.claimed === "number" ? data.claimed : 0;
    const cap = typeof data.cap === "number" ? data.cap : 100;
    const active = data.active === true;
    const remaining = Math.max(0, cap - claimed);
    return {
      claimed,
      cap,
      active,
      remaining,
      available: active && remaining > 0,
    };
  } catch (err) {
    console.error("[founding_100] status read failed", err);
    return { claimed: 0, cap: 100, active: false, remaining: 100, available: false };
  }
}

/**
 * Atomically records a claim. Idempotent on `orderId` via a small ring
 * buffer of recent order IDs (Firestore lacks set-uniqueness on
 * primitives). Safe to call multiple times for the same order; only
 * the first call increments.
 *
 * Returns the new claimed count, or null if no increment happened
 * (already-claimed order, or offer inactive).
 */
export async function claimFoundingHundred(
  orderId: string
): Promise<number | null> {
  try {
    const ref = adminDb.doc(FOUNDING_100_DOC_PATH);
    const result = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        console.warn("[founding_100] counter doc missing, skipping claim");
        return null;
      }
      const data = snap.data() ?? {};
      const claimed = typeof data.claimed === "number" ? data.claimed : 0;
      const cap = typeof data.cap === "number" ? data.cap : 100;
      const active = data.active === true;
      const recent: string[] = Array.isArray(data.last_order_ids)
        ? data.last_order_ids
        : [];

      if (!active) return null;
      if (claimed >= cap) return null;
      if (recent.includes(orderId)) return null;

      const next = claimed + 1;
      const nextRing = [...recent, orderId].slice(-50);
      tx.update(ref, {
        claimed: FieldValue.increment(1),
        last_order_ids: nextRing,
        last_claimed_at: FieldValue.serverTimestamp(),
      });
      return next;
    });
    return result;
  } catch (err) {
    console.error("[founding_100] claim failed", err);
    return null;
  }
}

/**
 * Returns the Shopify ProductVariant GID for the rangefinder gift, or
 * null if the env var isn't set (in which case we never attach).
 */
export function getFoundingHundredVariantGid(): string | null {
  const raw = process.env.FOUNDING_100_VARIANT_GID?.trim();
  if (!raw) return null;
  if (!raw.startsWith("gid://shopify/ProductVariant/")) return null;
  return raw;
}
