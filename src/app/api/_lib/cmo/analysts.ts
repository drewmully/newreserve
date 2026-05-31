/**
 * CMO Brain — Layer 2: Analysts.
 *
 * 5 narrow LLM calls, each with a strict system prompt + JSON schema.
 * Run in parallel; results are independent.
 */

import { chatJSON, type TokenLedger } from "./llm";
import type {
  AnalystOutput,
  SensorBundle,
  AnalystFinding,
} from "./types";

const ANALYST_OUTPUT_SHAPE = `
{
  "analyst": "performance" | "acquisition" | "retention" | "site" | "competitive",
  "summary": "2-3 sentence executive summary of what's happening",
  "findings": [
    {
      "finding": "1-sentence problem or insight, grounded in a specific metric",
      "evidence": {
        "metric": "exact metric name from the data",
        "value": "the actual value (string form)",
        "source": "where in the data this came from"
      },
      "dollar_impact_estimate_cents": 0,
      "severity": "critical" | "major" | "minor",
      "tags": ["short", "kebab-case", "tags"]
    }
  ],
  "blind_spots": ["data this analyst wished it had"]
}
`;

function validateAnalystOutput(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.analyst === "string" &&
    typeof o.summary === "string" &&
    Array.isArray(o.findings)
  );
}

const SHARED_RULES = `You are an analyst on a CMO brain trust for a subscription-box e-commerce business (MyMully.com, golf/athletic apparel quarterly subscription).

RULES:
- Every finding MUST cite a specific metric from the data given. No vibes-based claims.
- Every finding MUST include a dollar_impact_estimate_cents (integer cents). If you can't estimate, set it to 0 and explain in 'tags'.
- Severity reflects DOLLAR impact, not interestingness. 'critical' = >=$500/mo, 'major' = $100-500/mo, 'minor' = <$100/mo.
- Be specific. "Bounce rate is high" is not a finding. "Bounce rate on /lp/subscription is 78% versus 45% on /products" is.
- Find 3-7 findings. Quality over quantity. Skip placeholder findings.
- Output ONLY valid JSON. No prose before or after. No code fences.

OUTPUT SHAPE:
${ANALYST_OUTPUT_SHAPE}`;

// ─── PerformanceAnalyst ──────────────────────────────────────────────────
export async function runPerformanceAnalyst(
  sensors: SensorBundle,
  ledger: TokenLedger
): Promise<AnalystOutput> {
  const data = {
    headline: sensors.funnel.headline,
    funnel_totals: sensors.funnel.funnel_totals,
    shopify_ground_truth: sensors.funnel.shopify_ground_truth,
    conversion_rates: sensors.funnel.conversion_rates,
    channels: sensors.funnel.channels,
    path_buckets: sensors.funnel.path_buckets,
  };
  return chatJSON<AnalystOutput>({
    ledger,
    validate: validateAnalystOutput,
    system: `${SHARED_RULES}

YOUR ROLE: PerformanceAnalyst. Rank the funnel's biggest revenue leaks dollar-weighted.

MANDATORY LEAD FINDING (must always appear, even if other findings are bigger dollar impact):
Your FIRST finding MUST report the visit→checkout conversion rate per landing page,
drawn from \`conversion_rates.per_path\` and \`conversion_rates.overall\`. Format the
finding so the CEO can read it in one line, e.g. "Visit→checkout is 0.40% on /lp/subscription
(7 of 1,729) vs healthy benchmark of 2%+ — the LP is leaking the entire top of funnel."
If any high-traffic LP (≥200 visits) sits below \`conversion_rates.benchmarks.visit_to_checkout_alert_max_pct\`,
that finding is severity="critical" regardless of dollar math. The CEO has explicitly
flagged this metric as the baseline insight he expects from a CMO without being asked.

Subsequent findings: CAC vs revenue, channel mix leaks, gaps between PostHog and Shopify
ground truth (which signals missing tracking), and the largest dollar leaks elsewhere
in the funnel.

You set analyst="performance" in output.`,
    user: `Here is the funnel data:\n\n${JSON.stringify(data, null, 2)}\n\nProduce the JSON output.`,
  });
}

// ─── AcquisitionAnalyst ───────────────────────────────────────────────────
export async function runAcquisitionAnalyst(
  sensors: SensorBundle,
  ledger: TokenLedger
): Promise<AnalystOutput> {
  const data = {
    headline: {
      ad_spend_cents: sensors.funnel.headline.ad_spend_cents,
      new_reserve_members: sensors.funnel.headline.new_reserve_members,
      cac_cents: sensors.funnel.headline.cac_cents,
    },
    google_ads: sensors.ads.google_ads,
    x_ads: sensors.ads.x_ads,
    channels: sensors.funnel.channels,
  };
  return chatJSON<AnalystOutput>({
    ledger,
    validate: validateAnalystOutput,
    system: `${SHARED_RULES}

YOUR ROLE: AcquisitionAnalyst. Diagnose paid-ads efficiency, channel mix, wasted spend.
Look at: CPC vs CTR vs CVR per campaign; conversions=0 with real spend (=tracking broken); channels with zero attribution (=likely UTMs missing).
You set analyst="acquisition" in output.`,
    user: `Here is the acquisition data:\n\n${JSON.stringify(data, null, 2)}\n\nProduce the JSON output.`,
  });
}

// ─── RetentionAnalyst ─────────────────────────────────────────────────────
export async function runRetentionAnalyst(
  sensors: SensorBundle,
  ledger: TokenLedger
): Promise<AnalystOutput> {
  const data = {
    headline: {
      renewals: sensors.funnel.headline.renewals,
      renewal_revenue_cents: sensors.funnel.headline.renewal_revenue_cents,
      new_members: sensors.funnel.headline.new_reserve_members,
    },
    retention: sensors.retention,
  };
  return chatJSON<AnalystOutput>({
    ledger,
    validate: validateAnalystOutput,
    system: `${SHARED_RULES}

YOUR ROLE: RetentionAnalyst. Diagnose churn shape, cohort decay, renewal economics.
Look at: 30/60/90-day retention by cohort, the cliff timing (where does each cohort drop), avg renewal rate vs subscription-box benchmarks (~70-80% 90-day is good), recurring revenue vs new-member revenue ratio.
You set analyst="retention" in output.`,
    user: `Here is the retention data:\n\n${JSON.stringify(data, null, 2)}\n\nProduce the JSON output.`,
  });
}

// ─── SiteAnalyst ──────────────────────────────────────────────────────────
export async function runSiteAnalyst(
  sensors: SensorBundle,
  ledger: TokenLedger
): Promise<AnalystOutput> {
  const data = {
    pages: sensors.site.pages,
    worst_paths: sensors.sessions.worst_paths,
    top_entries: sensors.sessions.top_entries,
    device_split: sensors.sessions.device_split,
  };
  return chatJSON<AnalystOutput>({
    ledger,
    validate: validateAnalystOutput,
    system: `${SHARED_RULES}

YOUR ROLE: SiteAnalyst. Audit pages for conversion problems via copy, CTA clarity, hierarchy.
Look at: H1 specificity, CTA verb strength, pages with high traffic + low conversion, mismatches between landing-page promise and post-click experience, mobile-share signals.
For each finding, propose a specific copy/CTA change in tags.
You set analyst="site" in output.`,
    user: `Here is the site data:\n\n${JSON.stringify(data, null, 2)}\n\nProduce the JSON output.`,
  });
}

// ─── CompetitiveAnalyst ────────────────────────────────────────────────────
// Reads sensor data only \u2014 actual web research happens in Layer 3. This
// analyst names the competitive questions worth asking.
export async function runCompetitiveAnalyst(
  sensors: SensorBundle,
  ledger: TokenLedger
): Promise<AnalystOutput> {
  const data = {
    spend_cents: sensors.funnel.headline.ad_spend_cents,
    cac_cents: sensors.funnel.headline.cac_cents,
    renewal_rate_pct: sensors.retention.avg_renewal_rate_pct,
    primary_lp_h1:
      sensors.site.pages.find((p) => p.url.endsWith("/lp/subscription"))?.h1 ??
      sensors.site.pages[0]?.h1,
    primary_lp_cta:
      sensors.site.pages.find((p) => p.url.endsWith("/lp/subscription"))
        ?.primary_cta,
  };
  return chatJSON<AnalystOutput>({
    ledger,
    validate: validateAnalystOutput,
    system: `${SHARED_RULES}

YOUR ROLE: CompetitiveAnalyst. Generate the highest-leverage competitive questions about MyMully (golf/athletic apparel subscription box, quarterly).
Each finding here is a HYPOTHESIS that Layer 3 researchers will validate against the web.
Examples of good questions:
- "Subscription-box CAC for premium apparel typically runs $50-80; ours at $X seems Y."
- "Stitch Fix moved from quiz-led to AI-styled; what's the current best-practice landing page for subscription apparel?"
Set finding.tags to include at least one of: ["benchmark", "competitor", "tactic-research", "algorithm"].
You set analyst="competitive" in output.`,
    user: `Here is the context:\n\n${JSON.stringify(data, null, 2)}\n\nProduce 4-6 hypotheses to research. Output the JSON.`,
  });
}

// ─── Orchestrator ─────────────────────────────────────────────────────────
export async function runAllAnalysts(
  sensors: SensorBundle,
  ledger: TokenLedger
): Promise<AnalystOutput[]> {
  // Run in parallel; each analyst is independent.
  const results = await Promise.allSettled([
    runPerformanceAnalyst(sensors, ledger),
    runAcquisitionAnalyst(sensors, ledger),
    runRetentionAnalyst(sensors, ledger),
    runSiteAnalyst(sensors, ledger),
    runCompetitiveAnalyst(sensors, ledger),
  ]);
  const out: AnalystOutput[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") out.push(r.value);
    else
      out.push({
        analyst: "performance",
        summary: `Analyst failed: ${r.reason}`,
        findings: [] as AnalystFinding[],
      });
  }
  return out;
}
