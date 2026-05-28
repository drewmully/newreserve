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
import { FieldValue, FieldPath } from "firebase-admin/firestore";
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

  // update() treats dot-notation as field paths (nested objects).
  // set(..., {merge:true}) treats them as literal key names — bug.
  // If the doc doesn't exist yet (start of day), create it then retry.
  await ref.update(updates).catch(async (err: unknown) => {
    const code = (err as { code?: number })?.code;
    const msg = (err as { message?: string })?.message ?? "";
    if (code === 5 || msg.includes("NOT_FOUND")) {
      await ref.set({});
      await ref.update(updates);
    } else {
      throw err;
    }
  });
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

export interface PopulationSnapshot {
  date: string;
  total_users: number;
  users_with_store_credit: number;
  users_with_active_subscription: number;
}

/**
 * Refresh user-population counters for a given day from Firestore users.
 * Intended to run from a scheduled job (e.g. Vercel Cron) and/or
 * on-demand from protected reporting endpoints.
 */
export async function refreshPopulationKPIs(
  date?: string
): Promise<PopulationSnapshot> {
  const d = date ?? todayISO();
  const usersSnap = await adminDb.collection("users").get();

  let totalUsers = 0;
  let usersWithCredit = 0;
  let usersWithActiveSubscription = 0;

  usersSnap.forEach((docSnap) => {
    totalUsers += 1;

    const data = docSnap.data() as Record<string, unknown>;
    const storeCredit = (data.store_credit ?? {}) as Record<string, unknown>;
    const subscriptions = (data.subscriptions ?? {}) as Record<string, unknown>;

    const balanceCents = Number(storeCredit.balance_cents ?? 0);
    if (Number.isFinite(balanceCents) && balanceCents > 0) {
      usersWithCredit += 1;
    }

    const status = String(subscriptions.status ?? "").toLowerCase();
    const mullyboxActive = subscriptions.mullybox_active === true;
    if (mullyboxActive || status === "active") {
      usersWithActiveSubscription += 1;
    }
  });

  await adminDb.collection("kpi_daily").doc(d).set(
    {
      total_users: totalUsers,
      users_with_store_credit: usersWithCredit,
      users_with_active_subscription: usersWithActiveSubscription,
      population_snapshot_at: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    date: d,
    total_users: totalUsers,
    users_with_store_credit: usersWithCredit,
    users_with_active_subscription: usersWithActiveSubscription,
  };
}

export async function getDailyKPIs(date?: string): Promise<DailyKPIs> {
  const d = date ?? todayISO();
  const snap = await adminDb.collection("kpi_daily").doc(d).get();
  const data = (snap.data() ?? {}) as Record<string, unknown>;

  // Normalize: old writes used set() which stored "funnel.x" as literal flat keys.
  // New writes use update() which creates proper nested objects. Support both.
  const funnelNested = (data.funnel ?? {}) as Record<string, number>;
  const addToCart =
    funnelNested.add_to_cart ?? (data["funnel.add_to_cart"] as number | undefined) ?? 0;
  const purchases =
    funnelNested.purchases ?? (data["funnel.purchases"] as number | undefined) ?? 0;
  const walletViews =
    funnelNested.wallet_views ?? (data["funnel.wallet_views"] as number | undefined) ?? 0;
  const checkoutStarted =
    funnelNested.checkout_started ?? (data["funnel.checkout_started"] as number | undefined) ?? 0;

  const revenueNested = (data.revenue ?? {}) as Record<string, number>;
  const totalCents =
    revenueNested.total_cents ?? (data["revenue.total_cents"] as number | undefined);

  // Merge flat event_counts.* keys into a single object
  const eventCounts = { ...((data.event_counts ?? {}) as Record<string, number>) };
  for (const [key, val] of Object.entries(data)) {
    if (key.startsWith("event_counts.")) {
      const sub = key.slice(13);
      if (!(sub in eventCounts)) eventCounts[sub] = val as number;
    }
  }

  const totalUsers = data.total_users as number | undefined;
  const usersWithCredit = data.users_with_store_credit as number | undefined;
  const usersWithSub = data.users_with_active_subscription as number | undefined;

  const cleanedRaw = {
    ...data,
    funnel: { add_to_cart: addToCart, purchases, wallet_views: walletViews, checkout_started: checkoutStarted },
    revenue: { total_cents: totalCents },
    event_counts: eventCounts,
  };

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
    pro_shop_conversion_rate: walletViews > 0 ? (purchases / walletViews) * 100 : null,
    cart_abandonment_rate:
      addToCart > 0 ? ((addToCart - purchases) / addToCart) * 100 : null,
    raw: cleanedRaw,
  };
}

export async function getDailyKPIsRange(
  startDate: string,
  endDate: string
): Promise<DailyKPIs> {
  const snap = await adminDb
    .collection("kpi_daily")
    .where(FieldPath.documentId(), ">=", startDate)
    .where(FieldPath.documentId(), "<=", endDate)
    .get();

  let addToCart = 0;
  let purchases = 0;
  let walletViews = 0;
  let checkoutStarted = 0;
  let totalCents = 0;
  const eventCounts: Record<string, number> = {};

  // Population KPIs from the most recent doc that has them
  let totalUsers: number | undefined;
  let usersWithCredit: number | undefined;
  let usersWithSub: number | undefined;
  let latestPopDate = "";

  const docs = snap.docs.sort((a, b) => a.id.localeCompare(b.id));

  for (const doc of docs) {
    const d = doc.data() as Record<string, unknown>;

    const funnelNested = (d.funnel ?? {}) as Record<string, number>;
    addToCart += funnelNested.add_to_cart ?? (d["funnel.add_to_cart"] as number | undefined) ?? 0;
    purchases += funnelNested.purchases ?? (d["funnel.purchases"] as number | undefined) ?? 0;
    walletViews += funnelNested.wallet_views ?? (d["funnel.wallet_views"] as number | undefined) ?? 0;
    checkoutStarted += funnelNested.checkout_started ?? (d["funnel.checkout_started"] as number | undefined) ?? 0;

    const revenueNested = (d.revenue ?? {}) as Record<string, number>;
    totalCents += revenueNested.total_cents ?? (d["revenue.total_cents"] as number | undefined) ?? 0;

    const ec = { ...((d.event_counts ?? {}) as Record<string, number>) };
    for (const [key, val] of Object.entries(d)) {
      if (key.startsWith("event_counts.")) {
        const sub = key.slice(13);
        if (!(sub in ec)) ec[sub] = val as number;
      }
    }
    for (const [k, v] of Object.entries(ec)) {
      eventCounts[k] = (eventCounts[k] ?? 0) + (v as number);
    }

    if (doc.id > latestPopDate && d.total_users !== undefined) {
      latestPopDate = doc.id;
      totalUsers = d.total_users as number;
      usersWithCredit = d.users_with_store_credit as number | undefined;
      usersWithSub = d.users_with_active_subscription as number | undefined;
    }
  }

  return {
    date: `${startDate}/${endDate}`,
    pct_users_with_store_credit:
      totalUsers && usersWithCredit !== undefined
        ? (usersWithCredit / totalUsers) * 100
        : null,
    pct_users_with_active_subscription:
      totalUsers && usersWithSub !== undefined
        ? (usersWithSub / totalUsers) * 100
        : null,
    pro_shop_conversion_rate: walletViews > 0 ? (purchases / walletViews) * 100 : null,
    cart_abandonment_rate:
      addToCart > 0 ? ((addToCart - purchases) / addToCart) * 100 : null,
    raw: {
      total_users: totalUsers,
      users_with_active_subscription: usersWithSub,
      funnel: { add_to_cart: addToCart, purchases, wallet_views: walletViews, checkout_started: checkoutStarted },
      revenue: { total_cents: totalCents || undefined },
      event_counts: eventCounts,
    },
  };
}
