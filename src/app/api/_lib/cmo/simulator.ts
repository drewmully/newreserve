/**
 * CMO Brain — Layer 5: Simulator.
 *
 * Deterministic math. Takes ranked CandidatePlay[] + sensor baseline and
 * projects 90-day incremental revenue for each play's low/high lift band.
 *
 * No LLM. Everything is auditable arithmetic so Drew can trust the numbers.
 */

import type {
  CandidatePlay,
  SensorBundle,
  SimulatedPlay,
  SimulatorOutput,
} from "./types";

const WEEKS_IN_PROJECTION = 13; // ~90 days

function effortToCostCents(effort: "S" | "M" | "L"): number {
  // Rough internal cost of execution. Used for ROI normalization.
  // S = a few hours of dev/marketing work, M = 1-3 days, L = 1-2 weeks.
  switch (effort) {
    case "S":
      return 50_000; // $500
    case "M":
      return 250_000; // $2,500
    case "L":
      return 1_000_000; // $10,000
  }
}

function safeDiv(a: number, b: number): number {
  return b > 0 ? a / b : 0;
}

function compactWindowDays(sensors: SensorBundle): number {
  const s = new Date(sensors.funnel.window.start).getTime();
  const e = new Date(sensors.funnel.window.end).getTime();
  const days = Math.max(1, Math.round((e - s) / 86_400_000));
  return days;
}

function computeBaseline(sensors: SensorBundle) {
  const windowDays = compactWindowDays(sensors);
  const h = sensors.funnel.headline;
  const totalRevCents =
    h.new_reserve_revenue_cents + h.renewal_revenue_cents + h.pro_shop_revenue_cents;
  const totalOrders = h.new_reserve_members + h.renewals + h.pro_shop_orders;
  return {
    weekly_new_members: (h.new_reserve_members / windowDays) * 7,
    weekly_revenue_cents: Math.round((totalRevCents / windowDays) * 7),
    avg_aov_cents: Math.round(safeDiv(totalRevCents, totalOrders)),
    avg_renewal_rate_pct: sensors.retention.avg_renewal_rate_pct ?? 0,
    // Per-week building blocks used in projection math:
    weekly_landed: (sensors.funnel.funnel_totals.landed / windowDays) * 7,
    weekly_initiated: (sensors.funnel.funnel_totals.initiated / windowDays) * 7,
    weekly_completed: (sensors.funnel.funnel_totals.completed / windowDays) * 7,
    weekly_ad_spend_cents: Math.round((h.ad_spend_cents / windowDays) * 7),
    weekly_renewals: (h.renewals / windowDays) * 7,
  };
}

type Baseline = ReturnType<typeof computeBaseline>;

/**
 * Map an expected-lift metric to (baselineValue, dollarPerPointOfLift).
 * If unknown, we fall back to a conservative revenue-share heuristic.
 */
function projectForMetric(
  baseline: Baseline,
  metric: string
): { baseline_value: number; dollar_per_point_weekly_cents: number; notes: string } {
  const m = metric.toLowerCase();

  // Funnel completion rate: % of initiated who complete.
  if (m.includes("checkout") && (m.includes("completion") || m.includes("convers"))) {
    const cur = safeDiv(baseline.weekly_completed, baseline.weekly_initiated) * 100;
    // Each pp lift = baseline.weekly_initiated * 0.01 * AOV
    const perPp = baseline.weekly_initiated * 0.01 * baseline.avg_aov_cents;
    return {
      baseline_value: cur,
      dollar_per_point_weekly_cents: Math.round(perPp),
      notes: "Each pp lift on checkout completion = weekly_initiated × 1% × AOV per week.",
    };
  }

  // Landing-page conversion: % of landed who initiate.
  if (m.includes("lp_") || (m.includes("landing") && m.includes("conv"))) {
    const cur = safeDiv(baseline.weekly_initiated, baseline.weekly_landed) * 100;
    const checkoutRate = safeDiv(baseline.weekly_completed, baseline.weekly_initiated);
    const perPp = baseline.weekly_landed * 0.01 * checkoutRate * baseline.avg_aov_cents;
    return {
      baseline_value: cur,
      dollar_per_point_weekly_cents: Math.round(perPp),
      notes: "Each pp lift on LP conv = weekly_landed × 1% × current checkout rate × AOV.",
    };
  }

  // Renewal rate.
  if (m.includes("renewal")) {
    const cur = baseline.avg_renewal_rate_pct;
    // Each pp lift = weekly_renewals * (1pp / current_rate) * AOV — but easier:
    // pp lift converts more of the renewal-eligible base; treat baseline.weekly_renewals
    // as representative weekly cadence and assume cohort size ~ weekly_renewals / (rate/100).
    const cohortBase = cur > 0 ? baseline.weekly_renewals / (cur / 100) : baseline.weekly_renewals;
    const perPp = cohortBase * 0.01 * baseline.avg_aov_cents;
    return {
      baseline_value: cur,
      dollar_per_point_weekly_cents: Math.round(perPp),
      notes: "Each pp lift on renewal rate = renewable cohort size × 1% × AOV.",
    };
  }

  // CAC reduction: lifted as $ saved per acquisition (treat low_pct/high_pct as % CAC reduction).
  if (m.includes("cac")) {
    const cur = baseline.weekly_new_members > 0
      ? safeDiv(baseline.weekly_ad_spend_cents, baseline.weekly_new_members)
      : 0;
    // Each percent reduction in CAC saves baseline.weekly_ad_spend_cents * 1% (approximately, holding volume).
    const perPp = baseline.weekly_ad_spend_cents * 0.01;
    return {
      baseline_value: cur,
      dollar_per_point_weekly_cents: Math.round(perPp),
      notes: "Each % CAC reduction = 1% of weekly ad spend saved (volume held constant).",
    };
  }

  // CTR / impressions / clicks: tie back through CAC funnel.
  if (m.includes("ctr") || m.includes("click")) {
    const perPp = baseline.weekly_ad_spend_cents * 0.005; // conservative: 0.5% of weekly spend per pp CTR
    return {
      baseline_value: 0, // unknown without raw impressions/clicks
      dollar_per_point_weekly_cents: Math.round(perPp),
      notes: "Conservative: each pp CTR lift ≈ 0.5% of weekly ad spend equivalent volume.",
    };
  }

  // AOV / monetization.
  if (m.includes("aov") || m.includes("upsell") || m.includes("monetiz")) {
    const cur = baseline.avg_aov_cents / 100;
    // Treat low_pct/high_pct as % lift on AOV.
    const totalWeeklyOrders =
      baseline.weekly_completed + baseline.weekly_renewals;
    const perPp = totalWeeklyOrders * baseline.avg_aov_cents * 0.01;
    return {
      baseline_value: cur,
      dollar_per_point_weekly_cents: Math.round(perPp),
      notes: "Each 1% AOV lift = total weekly orders × 1% × current AOV.",
    };
  }

  // Default: treat lift as % of weekly revenue.
  const perPp = baseline.weekly_revenue_cents * 0.01;
  return {
    baseline_value: 0,
    dollar_per_point_weekly_cents: Math.round(perPp),
    notes: "Fallback: each pp lift ≈ 1% of current weekly revenue.",
  };
}

function clampNonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function simulateOne(play: CandidatePlay, baseline: Baseline): SimulatedPlay {
  const { baseline_value, dollar_per_point_weekly_cents, notes } = projectForMetric(
    baseline,
    play.expected_lift.metric
  );

  const lowPp = clampNonNegative(play.expected_lift.low_pct);
  const highPp = clampNonNegative(play.expected_lift.high_pct);

  const projected_low = baseline_value + lowPp;
  const projected_high = baseline_value + highPp;

  const inc_low_cents = Math.round(
    dollar_per_point_weekly_cents * lowPp * WEEKS_IN_PROJECTION
  );
  const inc_high_cents = Math.round(
    dollar_per_point_weekly_cents * highPp * WEEKS_IN_PROJECTION
  );

  const midpoint_cents = (inc_low_cents + inc_high_cents) / 2;
  const cost_cents = effortToCostCents(play.effort);
  // ROI score: midpoint 90-day incremental / cost. Normalize: 1.0 = break-even.
  const roi_score = cost_cents > 0
    ? Math.round((midpoint_cents / cost_cents) * 10) / 10
    : 0;

  return {
    ...play,
    projection: {
      baseline_value,
      projected_low,
      projected_high,
      incremental_revenue_90d_cents: {
        low: inc_low_cents,
        high: inc_high_cents,
      },
      notes,
    },
    roi_score,
  };
}

export function runSimulator(
  sensors: SensorBundle,
  plays: CandidatePlay[]
): SimulatorOutput {
  const baseline = computeBaseline(sensors);
  const simulated = plays.map((p) => simulateOne(p, baseline));
  // Re-sort by midpoint 90d incremental revenue desc (final ranking signal).
  simulated.sort((a, b) => {
    const ma =
      (a.projection.incremental_revenue_90d_cents.low +
        a.projection.incremental_revenue_90d_cents.high) /
      2;
    const mb =
      (b.projection.incremental_revenue_90d_cents.low +
        b.projection.incremental_revenue_90d_cents.high) /
      2;
    return mb - ma;
  });
  return {
    plays: simulated,
    baseline: {
      weekly_new_members: Math.round(baseline.weekly_new_members * 10) / 10,
      weekly_revenue_cents: baseline.weekly_revenue_cents,
      avg_aov_cents: baseline.avg_aov_cents,
      avg_renewal_rate_pct: baseline.avg_renewal_rate_pct,
    },
  };
}
