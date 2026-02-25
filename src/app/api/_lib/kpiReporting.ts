/**
 * KPI reporting layer — server-side only.
 *
 * Firestore collections:
 *   analytics_events/{event_id}               — raw event log
 *   kpi_daily/{YYYY-MM-DD}                    — daily aggregates
 *   segment_activity_daily/{YYYY-MM-DD}_{seg} — per-segment daily aggregates
 *
 * KPI calculations:
 *   pct_users_with_store_credit        — populated by store-credit sync jobs
 *   pct_users_with_active_subscription — populated by subscription sync jobs
 *   pro_shop_conversion_rate           — purchases / wallet_views
 *   cart_abandonment_rate              — (add_to_cart - purchases) / add_to_cart
 */

import { adminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { AnalyticsEvent } from "./analytics";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ─── Raw event persistence ────────────────────────────────────────────────────

export async function persistAnalyticsEvent(
  eventId: string,
  event: AnalyticsEvent & { uid?: string }
): Promise<void> {
  await adminDb.collection("analytics_events").doc(eventId).set({
    ...event,
    stored_at: FieldValue.serverTimestamp(),
  });
}

// ─── Daily aggregation ────────────────────────────────────────────────────────

export async function aggregateKpiDaily(
  event: AnalyticsEvent & { uid?: string }
): Promise<void> {
  const date = todayISO();
  const ref = adminDb.collection("kpi_daily").doc(date);

  const updates: Record<string, unknown> = {
    last_updated: FieldValue.serverTimestamp(),
    [`event_counts.${event.event_name}`]: FieldValue.increment(1),
    "event_counts.total": FieldValue.increment(1),
  };

  // Funnel tracking
  if (event.event_name === "add_to_cart") {
    updates["funnel.add_to_cart"] = FieldValue.increment(1);
  }
  if (
    event.event_name === "initiate_checkout" ||
    event.event_name === "checkout_clicked"
  ) {
    updates["funnel.checkout_started"] = FieldValue.increment(1);
  }
  if (event.event_name === "purchase") {
    updates["funnel.purchases"] = FieldValue.increment(1);
    const value = event.properties?.value as number | undefined;
    if (value) {
      updates["revenue.total_cents"] = FieldValue.increment(
        Math.round(value * 100)
      );
    }
  }
  if (event.event_name === "wallet_viewed") {
    updates["funnel.wallet_views"] = FieldValue.increment(1);
  }

  await ref.set(updates, { merge: true });
}

// ─── Segment activity aggregation ────────────────────────────────────────────

export async function aggregateSegmentActivity(
  event: AnalyticsEvent & { uid?: string }
): Promise<void> {
  const segments = event.segments ?? [];
  if (segments.length === 0) return;

  const date = todayISO();
  const batch = adminDb.batch();

  for (const segment of segments) {
    const ref = adminDb
      .collection("segment_activity_daily")
      .doc(`${date}_${segment}`);

    batch.set(
      ref,
      {
        date,
        segment,
        last_updated: FieldValue.serverTimestamp(),
        [`event_counts.${event.event_name}`]: FieldValue.increment(1),
        "event_counts.total": FieldValue.increment(1),
        ...(event.uid ? { [`active_users.${event.uid}`]: true } : {}),
      },
      { merge: true }
    );
  }

  await batch.commit();
}

// ─── KPI retrieval ────────────────────────────────────────────────────────────

export interface DailyKPIs {
  date: string;
  /** Percentage, or null if the required counters haven't been written yet */
  pct_users_with_store_credit: number | null;
  pct_users_with_active_subscription: number | null;
  /** purchases / wallet_views */
  pro_shop_conversion_rate: number | null;
  /** (add_to_cart - purchases) / add_to_cart */
  cart_abandonment_rate: number | null;
  raw: Record<string, unknown>;
}

export async function getDailyKPIs(date?: string): Promise<DailyKPIs> {
  const d = date ?? todayISO();
  const snap = await adminDb.collection("kpi_daily").doc(d).get();
  const data = (snap.data() ?? {}) as Record<string, unknown>;

  const funnel = (data.funnel ?? {}) as Record<string, number>;
  const addToCart = funnel.add_to_cart ?? 0;
  const purchases = funnel.purchases ?? 0;
  const walletViews = funnel.wallet_views ?? 0;

  const totalUsers = data.total_users as number | undefined;
  const usersWithCredit = data.users_with_store_credit as number | undefined;
  const usersWithSub = data.users_with_active_subscription as
    | number
    | undefined;

  return {
    date: d,
    pct_users_with_store_credit:
      totalUsers && usersWithCredit !== undefined
        ? (usersWithCredit / totalUsers) * 100
        : null,
    pct_users_with_active_subscription:
      totalUsers && usersWithSub !== undefined
        ? (usersWithSub / totalUsers) * 100
        : null,
    pro_shop_conversion_rate:
      walletViews > 0 ? (purchases / walletViews) * 100 : null,
    cart_abandonment_rate:
      addToCart > 0 ? ((addToCart - purchases) / addToCart) * 100 : null,
    raw: data,
  };
}
