/**
 * CMO Brain — shared types across all 6 layers.
 *
 * Each layer takes typed input from the previous layer and emits a typed
 * artifact. Keeping every contract here makes the pipeline auditable and
 * trivial to extend.
 */

// ─── Layer 1 — Sensors ─────────────────────────────────────────────────────
export interface FunnelSensorData {
  window: { start: string; end: string };
  headline: {
    new_reserve_members: number;
    new_reserve_revenue_cents: number;
    renewals: number;
    renewal_revenue_cents: number;
    pro_shop_orders: number;
    pro_shop_revenue_cents: number;
    ad_spend_cents: number;
    cac_cents: number;
  };
  funnel_totals: {
    landed: number;
    initiated: number;
    abandoned: number;
    completed: number;
  };
  path_buckets: Array<{
    path: string;
    landed: number;
    initiated: number;
    completed: number;
  }>;
  channels: Array<{
    channel: string;
    landed: number;
    initiated: number;
    completed: number;
  }>;
  shopify_ground_truth: {
    initiated: number;
    abandoned: number;
    completed: number;
  };
  // Pre-computed conversion rates so the PerformanceAnalyst doesn't have to
  // re-derive them from raw counts. Per-path is the headline insight the CEO
  // expects unprompted: "what % of visitors to <LP> reach checkout?".
  conversion_rates: {
    overall: {
      visits: number;
      checkouts: number;
      orders_shopify: number;
      visit_to_checkout_pct: number;
      checkout_to_order_shopify_pct: number;
      visit_to_order_shopify_pct: number;
    };
    per_path: Array<{
      path: string;
      visits: number;
      checkouts: number;
      orders: number;
      visit_to_checkout_pct: number;
      checkout_to_order_pct: number;
      visit_to_order_pct: number;
    }>;
    per_bucket: Array<{
      bucket: string;
      label: string;
      visits: number;
      checkouts: number;
      orders: number;
      visit_to_checkout_pct: number;
      checkout_to_order_pct: number;
      visit_to_order_pct: number;
    }>;
    benchmarks: {
      visit_to_checkout_healthy_min_pct: number;
      visit_to_checkout_alert_max_pct: number;
      checkout_to_order_healthy_min_pct: number;
    };
  };
}

export interface RetentionSensorData {
  cohorts: Array<{
    cohort_month: string;
    cohort_size: number;
    retained_30d: number;
    retained_60d: number;
    retained_90d: number;
  }>;
  avg_renewal_rate_pct: number;
  paused_subs: number;
  cancelled_subs: number;
  active_subs: number;
}

export interface SiteSensorData {
  // Top pages by traffic with copy + CTAs extracted.
  pages: Array<{
    url: string;
    title: string;
    h1: string;
    primary_cta: string;
    body_excerpt: string;
    word_count: number;
    sessions_7d: number;
    conversion_rate_pct: number;
    fetch_ms: number;
    status: number;
  }>;
  // Performance vitals from PageSpeed Insights (if reachable).
  vitals?: {
    homepage: { lcp_ms?: number; cls?: number; inp_ms?: number } | null;
    lp_subscription: { lcp_ms?: number; cls?: number; inp_ms?: number } | null;
  };
}

export interface AdsSensorData {
  google_ads: {
    available: boolean;
    reason?: string;
    spend_cents: number;
    clicks: number;
    conversions: number;
    impressions: number;
    campaigns?: Array<{
      name: string;
      status: string;
      spend_cents: number;
      clicks: number;
      conversions: number;
      impressions: number;
      ctr_pct: number;
      cpc_cents: number;
    }>;
  };
  x_ads: {
    available: boolean;
    reason?: string;
    spend_cents: number;
    clicks: number;
    conversions: number;
    impressions: number;
  };
}

export interface SessionSensorData {
  // Worst-converting paths with sample size — used by SiteAnalyst.
  worst_paths: Array<{ path: string; sessions: number; conversion_rate_pct: number }>;
  // Top entry pages.
  top_entries: Array<{ path: string; sessions: number; bounce_rate_pct: number }>;
  // Devices/sources breakdown.
  device_split: { desktop_pct: number; mobile_pct: number; tablet_pct: number };
}

export interface SensorBundle {
  funnel: FunnelSensorData;
  retention: RetentionSensorData;
  site: SiteSensorData;
  ads: AdsSensorData;
  sessions: SessionSensorData;
  collected_at: string;
  errors: Array<{ sensor: string; error: string }>;
}

// ─── Layer 2 — Analysts ───────────────────────────────────────────────────
export interface AnalystFinding {
  // 1-sentence problem statement, grounded in a specific metric.
  finding: string;
  // The exact numbers backing the finding.
  evidence: { metric: string; value: string; source: string };
  // Why this matters in dollar terms (estimated).
  dollar_impact_estimate_cents: number;
  severity: "critical" | "major" | "minor";
  // Tags that help Layer 3 route to the right researcher.
  tags: string[];
  // Best theory of WHY the metric looks the way it does. Concrete cause,
  // not a restatement of the symptom. May be wrong — it's a hypothesis.
  // Example: "Hero CTA reads 'mully.' which gives no value prop, so visitors
  // bounce before reading the offer."
  hypothesis: string;
  // A cheap, falsifiable check the CEO can run — or schedule — to validate
  // the hypothesis BEFORE shipping a real fix. Should be hours, not weeks.
  // Example: "Add console.log in /choose-plan submit handler and walk one
  // checkout; OR open Network tab and confirm POST /api/checkout returns 2xx."
  recommended_test: string;
  // The smallest concrete change to ship if the test confirms the hypothesis.
  // Should name the file/page/setting/asset to change, not a vague direction.
  // Example: "Replace H1 'mully.' with 'Quarterly box of premium golf apparel,
  // $249/qtr' and the CTA with 'Start my first box' in app/lp/subscription/page.tsx"
  recommended_fix: string;
  // Optional: where the analyst is least sure. Helps Strategist/Simulator.
  confidence?: "high" | "medium" | "low";
}

export interface AnalystOutput {
  analyst: "performance" | "acquisition" | "retention" | "site" | "competitive";
  summary: string;
  findings: AnalystFinding[];
  blind_spots?: string[]; // data this analyst would have liked but didn't have
}

// ─── Layer 3 — Research ───────────────────────────────────────────────────
export interface ResearchCitation {
  title: string;
  url: string;
  excerpt: string;
}

export interface ResearchAnswer {
  topic: string;
  question: string;
  answer: string;
  benchmarks?: Array<{ metric: string; value: string; source: string }>;
  recommended_tactics: Array<{
    tactic: string;
    expected_lift_pct: { low: number; high: number };
    effort: "S" | "M" | "L";
    evidence: string;
  }>;
  citations: ResearchCitation[];
}

export interface ResearchBundle {
  answers: ResearchAnswer[];
  generated_at: string;
}

// ─── Layer 4 — Strategist ─────────────────────────────────────────────────
export interface CandidatePlay {
  id: string;                                  // stable slug
  title: string;
  hypothesis: string;                          // "If we do X, then Y will happen, because Z"
  funnel_stage: "acquisition" | "activation" | "retention" | "monetization" | "site";
  expected_lift: {
    metric: string;                            // e.g. "checkout_completion_pct"
    low_pct: number;
    high_pct: number;
  };
  effort: "S" | "M" | "L";
  ice: { impact: number; confidence: number; ease: number; score: number };
  depends_on: string[];                        // citations: analyst findings, research IDs
  risks: string[];
}

export interface StrategistOutput {
  summary: string;
  plays: CandidatePlay[];
  rejected: Array<{ idea: string; reason: string }>;
}

// ─── Layer 5 — Simulator ──────────────────────────────────────────────────
export interface SimulatedPlay extends CandidatePlay {
  projection: {
    baseline_value: number;                    // current weekly value of the metric
    projected_low: number;                     // applied lift_low
    projected_high: number;                    // applied lift_high
    incremental_revenue_90d_cents: {
      low: number;
      high: number;
    };
    notes: string;                             // assumptions
  };
  roi_score: number;                           // incremental_revenue / effort_cost
}

export interface SimulatorOutput {
  plays: SimulatedPlay[];
  baseline: {
    weekly_new_members: number;
    weekly_revenue_cents: number;
    avg_aov_cents: number;
    avg_renewal_rate_pct: number;
  };
}

// ─── Layer 6 — CMO ────────────────────────────────────────────────────────
export interface PlayArtifact {
  kind: "ad_copy" | "email" | "page_copy" | "campaign_config" | "experiment";
  title: string;
  body: string;                                // the actual artifact text (markdown)
  meta?: Record<string, string>;               // e.g. {subject_line: "..."}
}

export interface FinalPlay extends SimulatedPlay {
  why_now: string;                             // 1-paragraph rationale
  how_to_ship: string[];                       // step-by-step
  success_metric: string;                      // exact metric + target
  rollback_trigger: string;                    // if X happens, kill it
  artifacts: PlayArtifact[];                   // drafted assets
}

export interface CMOOutput {
  this_week: FinalPlay[];                      // 3 immediately-shippable plays
  next_30_days: FinalPlay[];                   // 2-3 medium-effort bets
  quarterly_bet: FinalPlay | null;             // 1 strategic move
  executive_summary: string;                   // 1-paragraph TL;DR for Drew
}

// ─── Full run shape (the row in marketing_cmo_runs) ───────────────────────
export interface CMORun {
  id: number;
  status: "running" | "complete" | "failed";
  source: string;
  window_start: string;
  window_end: string;
  sensors: SensorBundle | null;
  analysts: AnalystOutput[] | null;
  research: ResearchBundle | null;
  strategist: StrategistOutput | null;
  simulator: SimulatorOutput | null;
  cmo: CMOOutput | null;
  plays: FinalPlay[] | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd_cents: number;
}
