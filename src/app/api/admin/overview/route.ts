import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { getDailyKPIs } from "@/app/api/_lib/kpiReporting";

async function verifyAdmin(request: NextRequest): Promise<void> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) {
    throw new Error("Forbidden");
  }
}

function dateISO(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

const PAID_TIERS = new Set(["access", "member", "black"]);

interface Recommendation {
  type: "warning" | "info" | "success";
  title: string;
  body: string;
  action: string;
}

function computeRecommendation(input: {
  atRisk: number;
  cartAbandonmentRate: number | null;
  purchasesToday: number;
  newUsersToday: number;
  activationPct: number | null;
}): Recommendation {
  const { atRisk, cartAbandonmentRate, purchasesToday, newUsersToday, activationPct } = input;

  if (atRisk > 3) {
    return {
      type: "warning",
      title: `${atRisk} paid members stuck before activation`,
      body: "These members purchased more than 7 days ago but haven't completed onboarding. They're at risk of churning without ever experiencing value.",
      action: "Review in Users — filter by paid tier and check onboarding status",
    };
  }

  if (cartAbandonmentRate !== null && cartAbandonmentRate > 60) {
    return {
      type: "warning",
      title: `${cartAbandonmentRate.toFixed(0)}% cart abandonment today`,
      body: "More than half of users who added to cart didn't complete checkout. A 24h abandon-cart email would recover a significant portion.",
      action: "Build a 24h abandon-cart email trigger in the sequences engine",
    };
  }

  if (activationPct !== null && activationPct < 60) {
    return {
      type: "warning",
      title: `Activation at ${activationPct.toFixed(0)}% — below 75% target`,
      body: "Less than 75% of paid members completed onboarding. Check whether the post-purchase email sequence is delivering on time.",
      action: "Check email step 1 delivery rate in Sequences",
    };
  }

  if (newUsersToday === 0) {
    return {
      type: "info",
      title: "No new signups in the last 24 hours",
      body: "This may be normal on a low-traffic day, or it could signal a broken signup flow. Worth a quick check.",
      action: "Test the signup flow end-to-end from the home page",
    };
  }

  if (purchasesToday === 0) {
    return {
      type: "info",
      title: "No paid conversions today",
      body: "No purchases recorded today. If email campaigns went out recently, verify that UTM tracking and the Shopify webhook are working.",
      action: "Check UTM links in recent email sends and verify webhook logs",
    };
  }

  return {
    type: "success",
    title: "Funnel looks healthy today",
    body: "No critical signals. Good moment to review last week's cohort and plan the next email campaign.",
    action: "Open Sequences to review email step performance",
  };
}

export async function GET(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
  }

  try {
    const nowMs = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const oneDayMs = 24 * 60 * 60 * 1000;

    const [todayKPIs, lastWeekKPIs, usersSnap] = await Promise.all([
      getDailyKPIs(dateISO(0)),
      getDailyKPIs(dateISO(7)),
      adminDb.collection("users").get(),
    ]);

    let totalPaid = 0;
    let onboardingCompleted = 0;
    let atRisk = 0;
    let newUsersToday = 0;
    let newUsersLastWeek = 0;

    usersSnap.forEach((doc) => {
      const d = doc.data() as Record<string, unknown>;
      const tier = String(d.tier ?? "free");
      const createdAt = Number(d.created_at ?? 0);
      const onboardingDone = Boolean(d.onboarding_completed);

      if (PAID_TIERS.has(tier)) {
        totalPaid += 1;
        if (onboardingDone) onboardingCompleted += 1;
        if (!onboardingDone && createdAt > 0 && createdAt < nowMs - sevenDaysMs) {
          atRisk += 1;
        }
      }

      if (createdAt > nowMs - oneDayMs) newUsersToday += 1;
      const lwStart = nowMs - sevenDaysMs - oneDayMs;
      const lwEnd = nowMs - sevenDaysMs;
      if (createdAt > lwStart && createdAt <= lwEnd) newUsersLastWeek += 1;
    });

    const activationPct = totalPaid > 0 ? (onboardingCompleted / totalPaid) * 100 : null;
    const todayPurchases = (todayKPIs.raw as Record<string, unknown> & { funnel?: { purchases?: number } })?.funnel?.purchases ?? 0;

    return NextResponse.json({
      today: todayKPIs,
      last_week: lastWeekKPIs,
      activation: {
        total_paid: totalPaid,
        onboarding_completed: onboardingCompleted,
        onboarding_pct: activationPct,
        at_risk: atRisk,
      },
      new_users_today: newUsersToday,
      new_users_last_week: newUsersLastWeek,
      recommendation: computeRecommendation({
        atRisk,
        cartAbandonmentRate: todayKPIs.cart_abandonment_rate,
        purchasesToday: todayPurchases,
        newUsersToday,
        activationPct,
      }),
    });
  } catch (err) {
    console.error("[admin/overview] failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
