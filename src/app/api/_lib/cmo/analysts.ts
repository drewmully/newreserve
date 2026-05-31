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
      "tags": ["short", "kebab-case", "tags"],
      "hypothesis": "Best theory of WHY this metric looks the way it does. A concrete cause, NOT a restatement of the symptom. May be wrong — it's a guess from the data.",
      "recommended_test": "A cheap, falsifiable check (hours, not weeks) the CEO can run to validate the hypothesis BEFORE shipping a real fix. Name the page/console/log/Network call to inspect.",
      "recommended_fix": "The smallest concrete change to ship if the test confirms the hypothesis. Name the file/page/setting/asset to change — not a vague direction.",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "blind_spots": ["data this analyst wished it had"]
}
`;

// Rejects findings that violate the "checkout works" rule. The CEO has
// confirmed checkout is functional — any claim otherwise is hallucination.
// Catches the most common phrasings.
const BANNED_CHECKOUT_BROKEN_PATTERNS: RegExp[] = [
  /checkout\s+(is\s+)?broken/i,
  /checkout\s+button\s+(doesn'?t|does\s+not|isn'?t|is\s+not)/i,
  /checkout\s+(pipe|pipeline|flow|handoff)\s+(is\s+)?(broken|down|failing|misconfigured|missing|misfir)/i,
  /shopify\s+(handoff|integration)\s+(is\s+)?(broken|down|pending|missing|not\s+working)/i,
  /button\s+(isn'?t|is\s+not|doesn'?t|does\s+not)\s+(working|wired|firing|configured)/i,
  /payment\s+(pipe|flow|gateway)\s+(is\s+)?(broken|down|failing)/i,
  /button\s+likely\s+(posts|points)\s+to\s+a\s+(broken|dead|unconfigured)/i,
  /storefront\s+endpoint\s+(that'?s\s+)?(unconfigured|broken|missing)/i,
];

function violatesCheckoutRule(text: string): boolean {
  return BANNED_CHECKOUT_BROKEN_PATTERNS.some((re) => re.test(text));
}

function validateAnalystOutput(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (
    typeof o.analyst !== "string" ||
    typeof o.summary !== "string" ||
    !Array.isArray(o.findings)
  ) {
    return false;
  }
  // Every finding must carry hypothesis + recommended_test + recommended_fix.
  // This is the CEO's hard requirement: don't just report the problem, also
  // explain why it's likely happening and what to do about it.
  for (const f of o.findings) {
    if (!f || typeof f !== "object") return false;
    const ff = f as Record<string, unknown>;
    if (
      typeof ff.finding !== "string" ||
      typeof ff.hypothesis !== "string" ||
      typeof ff.recommended_test !== "string" ||
      typeof ff.recommended_fix !== "string" ||
      !ff.hypothesis.trim() ||
      !ff.recommended_test.trim() ||
      !ff.recommended_fix.trim()
    ) {
      return false;
    }
    // The CEO has banned "checkout is broken" claims — reject any finding
    // whose finding/hypothesis/fix asserts the checkout pipe is broken.
    const blob = [
      String(ff.finding),
      String(ff.hypothesis),
      String(ff.recommended_fix),
    ].join(" \n ");
    if (violatesCheckoutRule(blob)) {
      return false;
    }
  }
  return true;
}

const SHARED_RULES = `You are an analyst on a CMO brain trust for a subscription-box e-commerce business (MyMully.com, golf/athletic apparel quarterly subscription).

RULES:
- Every finding MUST cite a specific metric from the data given. No vibes-based claims.
- Every finding MUST include a dollar_impact_estimate_cents (integer cents). If you can't estimate, set it to 0 and explain in 'tags'.
- Severity reflects DOLLAR impact, not interestingness. 'critical' = >=$500/mo, 'major' = $100-500/mo, 'minor' = <$100/mo.
- Be specific. "Bounce rate is high" is not a finding. "Bounce rate on /lp/subscription is 78% versus 45% on /products" is.
- Find 3-7 findings. Quality over quantity. Skip placeholder findings.
- Output ONLY valid JSON. No prose before or after. No code fences.

HARD RULES — violation makes the finding worthless to the CEO:

A) CHECKOUT IS VERIFIED WORKING. The CEO has personally walked the checkout
   pipe end-to-end and confirmed it processes orders. You MUST NOT write a
   finding that claims checkout is broken, checkout buttons don't work, the
   payment pipe is down, or the Shopify handoff is broken — even if a single
   page shows zero orders. Zero-orders-on-a-page is almost always an INTENT or
   SAMPLE-SIZE problem, not a plumbing problem. If V→C is low, the leak is
   top-of-funnel: hero copy, CTA clarity, audience-LP mismatch, mobile
   layout, social-traffic intent. If C→O is low, ask whether the sample is
   even big enough to draw a conclusion.

B) PIPE-HEALTH MATH GATE. Before claiming any drop-off in the funnel is a
   "bug" or "broken", compute checkout→order on the bucket with the largest
   sample. If checkout→order ≥ 15% on N ≥ 25 checkouts in the funnel
   overall, the pipe works. Any zero-order page is either (i) low sample size,
   (ii) attribution noise, or (iii) the page's specific button mis-wired —
   never the whole checkout. Phrase findings accordingly.

C) FRAME FINDINGS AS INTENT FIRST. When V→C is below benchmark on a page,
   the default hypothesis is one of: hero doesn't answer "what is this" in
   5 seconds, CTA copy is non-imperative, the audience hitting the page is
   wrong (cold social traffic vs. high-intent search), or the mobile layout
   buries the offer. Do NOT default to "checkout broken" — it's banned.

EVERY FINDING MUST INCLUDE (non-negotiable, the CEO will reject the run otherwise):
  1. \`finding\` — the problem statement with the metric.
  2. \`hypothesis\` — your BEST THEORY of WHY the metric looks that way.
     Must be a concrete cause, not a restatement of the symptom.
     BAD: "/lp/subscription converts at 0.4% because users aren't checking out."
     GOOD: "/lp/subscription converts at 0.4% because the hero CTA reads 'mully.'
            with no value prop above the fold, so visitors bounce before learning
            the offer or price."
  3. \`recommended_test\` — a CHEAP, FALSIFIABLE check (hours, not weeks) to
     validate the hypothesis BEFORE shipping a real fix. Name the exact
     page/console/log/Network call/SQL query/UTM to inspect.
     BAD: "Look at the page."
     GOOD: "Open /lp/subscription in an incognito session, scroll to first CTA,
            inspect Network tab — confirm the CTA click POSTs to /api/checkout
            and returns 2xx. If it 4xx/5xx, the bug is server-side, not copy."
  4. \`recommended_fix\` — the SMALLEST CONCRETE CHANGE to ship if the test
     confirms the hypothesis. Name the file/page/setting/asset to change.
     BAD: "Improve the LP."
     GOOD: "In src/app/lp/subscription/page.tsx, replace H1 'mully.' with
            'Quarterly box of premium golf apparel — $249/qtr' and CTA with
            'Start my first box'. Deploy and watch /lp/subscription visit→checkout
            rate for 5 days against the 0.40% baseline."
  5. \`confidence\` — "high" | "medium" | "low" — how sure are you the hypothesis is right.

NEVER write a finding that doesn't carry all three of hypothesis + recommended_test + recommended_fix. A finding without a theory and a next action is noise the CEO cannot act on.

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
    intent: sensors.intent,
  };
  return chatJSON<AnalystOutput>({
    ledger,
    validate: validateAnalystOutput,
    system: `${SHARED_RULES}

YOUR ROLE: PerformanceAnalyst. Diagnose WHY visitors aren't even reaching
checkout on each landing page. The CEO has banned "checkout broken" claims
(see Rule A) — your job is to dissect TOP-OF-FUNNEL INTENT, not plumbing.

MANDATORY LEAD FINDING (must always appear):
Your FIRST finding MUST report (a) overall checkout→order to PROVE the pipe
works before saying anything else, and (b) the visit→checkout rate on the
weakest high-traffic LP. State BOTH numbers explicitly. E.g.
  "Overall checkout→order is 15.15% on 66 checkouts — the pipe is healthy.
   Visit→checkout on /lp/subscription is 0.62% (11 of 1,780) vs 2%+ benchmark
   — the page isn't generating buying intent."
Severity="critical" if any LP with ≥1,000 visits sits below
\`conversion_rates.benchmarks.visit_to_checkout_alert_max_pct\`.

USE \`intent.per_lp\` to commit to ONE hypothesis. It includes per-LP
audience composition (top_referrers, utm_sources), device split, V→C by
device, and hero_engagement (pct_engaged = % of sessions that fire any
non-pageview event). Match the data to ONE of these intent hypotheses:
  - AUDIENCE MISMATCH: top_referrers shows one source >40% (e.g. social,
    direct from social-app) and that traffic is cold/curiosity-driven.
  - HERO FAILS 5-SECOND TEST: hero_engagement.pct_engaged < 15% — visitors
    land, don't click anything, leave (the hero doesn't sell what we sell).
  - MOBILE LAYOUT BREAKS: devices.mobile_pct > 70% AND
    visit_to_checkout_by_device_pct.mobile is meaningfully lower than
    .desktop — the page wasn't designed for the device most visitors use.
  - CTA COPY IS BRAND-VOICE NOT IMPERATIVE: pct_engaged is decent but
    checkouts are tiny — visitors read but don't act because the visible
    button doesn't promise the next step.
  - PRICE-ANCHOR ABSENT ABOVE THE FOLD: hero doesn't state $249/qtr, so the
    qualified audience can't self-select.

For recommended_test give a 10-minute observation (open the LP in incognito
on phone, count CTAs in first viewport, watch what % of words above the fold
are value-prop vs brand voice). For recommended_fix name the file/component
to edit. NEVER suggest wiring the checkout button or fixing the checkout
pipe — those claims are banned.

Subsequent findings: paid spend efficiency, channel mix leaks, tracking gaps
between PostHog and Shopify ground truth, and dollar leaks elsewhere — each
with its own hypothesis + test + fix.

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
    audience: sensors.intent.audience,
    lp_referrers: sensors.intent.per_lp.map((lp) => ({
      path: lp.path,
      top_referrers: lp.top_referrers,
      utm_sources: lp.utm_sources,
      visit_to_checkout_pct: lp.visit_to_checkout_pct,
    })),
  };
  return chatJSON<AnalystOutput>({
    ledger,
    validate: validateAnalystOutput,
    system: `${SHARED_RULES}

YOUR ROLE: AcquisitionAnalyst. Diagnose paid-ads efficiency, channel mix, wasted spend.
Look at: CPC vs CTR vs CVR per campaign; conversions=0 with real spend (=tracking broken); channels with zero attribution (=likely UTMs missing).
For each finding, hypothesis menu (commit to the most likely one):
  - Targeting too broad (audience mismatch)
  - Creative fatigue (CTR decay vs prior period)
  - Landing page mismatch (ad promise ≠ LP headline)
  - Conversion tracking broken (gtag/conversion action misfiring)
  - UTM tagging missing on outbound links (channel attribution lost)
  - Bid strategy starving the campaign (smart bidding hasn't learned yet)
recommended_test should name the exact Google Ads/X Ads screen, conversion action,
or UTM string to inspect. recommended_fix should name the campaign id, asset group,
or budget to change.
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
For each finding, hypothesis menu (commit to the most likely one):
  - Box value perception dropped (curation slipped or repeat items)
  - Pre-renewal silence (no warning email → chargeback-style cancels)
  - No pause-before-cancel offramp (binary stay/cancel forces cancels)
  - Billing failure dunning missing (involuntary churn looks like voluntary)
  - Price anchor (first quarter free → sticker shock at quarter 2)
  - Onboarding gap (new members never set preferences → wrong box → cancel)
recommended_test should be a specific cohort/Shopify-tag query the CEO can run.
recommended_fix should name the specific email, flow, or product change.
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
    intent: sensors.intent,
  };
  return chatJSON<AnalystOutput>({
    ledger,
    validate: validateAnalystOutput,
    system: `${SHARED_RULES}

YOUR ROLE: SiteAnalyst. Audit pages for INTENT problems via copy, CTA clarity,
and hero-audience fit. The CEO has confirmed checkout works (Rule A). Your job
is to explain why visitors don't even reach checkout.

For each finding, USE \`intent.per_lp\` to back the hypothesis with numbers —
not just inspection of the H1/CTA strings. Combine the static page audit
(pages[].h1, pages[].primary_cta, pages[].body_excerpt) with the live
behavioral signal (intent.per_lp[].hero_engagement.pct_engaged,
intent.per_lp[].devices, intent.per_lp[].top_referrers).

Hypothesis menu (commit to ONE per finding):
  - Headline doesn't pass the 5-second test — evidence: hero_engagement.
    pct_engaged is low AND H1 is brand-voice ("Built for golfers with taste")
    rather than offer-voice ("Quarterly golf box — $249/qtr").
  - CTA is non-actionable / brand-voice instead of imperative — evidence:
    primary_cta is the brand wordmark ("mully.") or a weak label.
  - Above-the-fold has no proof or price — evidence: body_excerpt's first
    ~200 chars contain no review count, member count, or dollar figure.
  - Mobile layout reflow breaks the hero — evidence: devices.mobile_pct > 70%
    AND visit_to_checkout_by_device_pct.mobile is much lower than .desktop.
  - Audience→LP mismatch — evidence: top_referrers concentrated in one
    cold source (e.g. com.twitter.android) that doesn't fit the LP's pitch.
  - Hero buries the offer — evidence: H1 is generic, value prop only
    appears below the fold.

recommended_test must be a 10-minute observation: open the page in incognito
on a phone, screenshot above-the-fold, count what % of the words sell the
product vs name the brand. recommended_fix must name the exact
file/component/string to change. DO NOT recommend wiring the checkout
button or fixing the checkout pipe — those claims are banned.

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
    audience: sensors.intent.audience,
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

Even for competitive hypotheses, fill the three required fields:
  - hypothesis: the competitive claim you're testing
     (e.g., "Our CAC at $97 is 1.5–2x the apparel-subscription benchmark of $50–80.")
  - recommended_test: how Layer 3 should validate it
     (e.g., "Compare against Stitch Fix, Fabletics, Bombfell published CAC ranges.")
  - recommended_fix: the action to take if validated
     (e.g., "Cap PMax max-CPA at $60 and shift remaining budget to search brand defense.")

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
