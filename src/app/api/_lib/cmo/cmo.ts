/**
 * CMO Brain — Layer 6: CMO synthesis.
 *
 * The final call. Takes simulated plays + business context and produces
 * FinalPlay[] grouped into this_week / next_30_days / quarterly_bet, with
 * drafted artifacts (ad copy, email, page copy, campaign config) for each.
 *
 * Voice rules baked in: Drew's brand is sharp, masculine, sport-confident.
 * No corporate hedging.
 */

import { chatJSON, type TokenLedger } from "./llm";
import type {
  CMOOutput,
  SensorBundle,
  SimulatorOutput,
  FinalPlay,
  AnalystOutput,
} from "./types";

const FINAL_PLAY_SHAPE = `
{
  "id": "<keep the input id>",
  "title": "<keep>",
  "hypothesis": "<keep>",
  "funnel_stage": "<keep>",
  "expected_lift": <keep>,
  "effort": "<keep>",
  "ice": <keep>,
  "depends_on": <keep>,
  "risks": <keep>,
  "projection": <keep, exact same shape>,
  "roi_score": <keep>,
  "why_now": "1-paragraph rationale tying the bet to the data we saw THIS week.",
  "how_to_ship": ["concrete", "step-by-step", "actions"],
  "success_metric": "Exact metric + numeric target + measurement window. e.g. 'Renewal rate at 90d ≥ 62% for the May cohort.'",
  "rollback_trigger": "If <metric> goes <direction> by <amount> in <window>, kill it.",
  "artifacts": [
    {
      "kind": "ad_copy" | "email" | "page_copy" | "campaign_config" | "experiment",
      "title": "short title",
      "body": "markdown — actual deliverable text Drew can paste",
      "meta": { "any": "extra fields like subject_line" }
    }
  ]
}
`;

const CMO_OUTPUT_SHAPE = `
{
  "executive_summary": "1-paragraph TL;DR for Drew — what's the state of the business, what are we betting on this week, and why?",
  "this_week": [<3 FinalPlay objects — must be effort S or M with highest ROI>],
  "next_30_days": [<2-3 FinalPlay objects — medium-effort bets>],
  "quarterly_bet": <one FinalPlay or null — the strategic move>
}

Each FinalPlay must match this shape:
${FINAL_PLAY_SHAPE}
`;

const CMO_SYSTEM = `You are the Chief Marketing Officer of MyMully.com — a quarterly subscription box for athletic/golf apparel.

You receive a ranked list of simulated plays (each with hypothesis, ICE, projected 90-day incremental revenue) plus the raw analyst findings that motivated them. Your job: pick the WINNERS, draft the artifacts, and tell Drew exactly what to ship and how.

BRAND VOICE:
- Sport-confident, masculine, plays-on-the-tee energy. Not corporate, not woke, not soft.
- Specific over vague. "Crew-neck merino quarter-zip in three colors" > "premium apparel".
- Founder voice OK — Drew is the face of the brand.
- No emojis unless the artifact is an SMS where one earns its place.

PLAY SELECTION:
- this_week: pick the 3 plays with highest projection.incremental_revenue_90d_cents midpoint that are effort 'S' or 'M'. These ship within 7 days.
- next_30_days: 2-3 plays of effort 'M' or 'L' with meaningful upside.
- quarterly_bet: ONE big-swing play, or null if nothing in the simulator qualifies.
- Use the play's exact id/title/hypothesis/projection/etc as-is. Do NOT invent new plays here.

ARTIFACTS:
- For each FinalPlay, draft 1-3 artifacts the play actually needs.
  * Acquisition plays → ad_copy (headline + body + CTA + ad meta) + optional page_copy
  * Retention plays → email (with subject_line in meta) or experiment (test plan)
  * Site plays → page_copy with exact H1, subhead, bullets, CTA
  * Monetization plays → campaign_config or experiment
- Artifact 'body' must be FINAL copy Drew can paste — not bullet outlines, not "draft something like".
- For ad_copy artifacts, include meta: { headline, primary_text, cta, channel }
- For email artifacts, include meta: { subject_line, preview_text, send_to }

RULES:
- Output ONLY valid JSON. No prose, no fences. Begin { end }.
- Every FinalPlay must include EVERY field from the schema (including the carried-forward simulator fields).
- success_metric must be measurable in 30-90 days, with a SPECIFIC numeric target.
- rollback_trigger must be specific and time-bound.

OUTPUT SHAPE:
${CMO_OUTPUT_SHAPE}`;

function compactSimulator(sim: SimulatorOutput): string {
  return sim.plays
    .map((p, i) => {
      const inc = p.projection.incremental_revenue_90d_cents;
      const mid = (inc.low + inc.high) / 200; // cents → dollars midpoint
      return `## PLAY ${i + 1}: ${p.title} (id: ${p.id})
  stage=${p.funnel_stage} effort=${p.effort} ICE=${p.ice.score}
  hypothesis: ${p.hypothesis}
  expected_lift: ${p.expected_lift.metric} +${p.expected_lift.low_pct}-${p.expected_lift.high_pct}pp
  projection (90d incremental): $${(inc.low / 100).toFixed(0)} → $${(inc.high / 100).toFixed(0)} (mid ~$${mid.toFixed(0)})
  baseline_value: ${p.projection.baseline_value}
  notes: ${p.projection.notes}
  roi_score: ${p.roi_score}x
  depends_on: ${p.depends_on.join("; ")}
  risks: ${p.risks.join("; ")}`;
    })
    .join("\n\n");
}

function compactSensorBrief(sensors: SensorBundle): string {
  const h = sensors.funnel.headline;
  return `WINDOW: ${sensors.funnel.window.start} → ${sensors.funnel.window.end}
- New reserve members: ${h.new_reserve_members} (rev $${(h.new_reserve_revenue_cents / 100).toFixed(0)})
- Renewals: ${h.renewals} (rev $${(h.renewal_revenue_cents / 100).toFixed(0)})
- Pro shop: ${h.pro_shop_orders} orders ($${(h.pro_shop_revenue_cents / 100).toFixed(0)})
- Ad spend: $${(h.ad_spend_cents / 100).toFixed(2)}; CAC $${(h.cac_cents / 100).toFixed(2)}
- Funnel: landed=${sensors.funnel.funnel_totals.landed}, initiated=${sensors.funnel.funnel_totals.initiated}, completed=${sensors.funnel.funnel_totals.completed}
- Subs: active=${sensors.retention.active_subs} paused=${sensors.retention.paused_subs} cancelled=${sensors.retention.cancelled_subs}
- Renewal rate avg: ${sensors.retention.avg_renewal_rate_pct}%`;
}

export async function runCMO(
  sensors: SensorBundle,
  analysts: AnalystOutput[],
  simulator: SimulatorOutput,
  ledger: TokenLedger
): Promise<CMOOutput> {
  const userPrompt = `${compactSensorBrief(sensors)}

# ANALYST HEADLINES
${analysts.map((a) => `- ${a.analyst}: ${a.summary}`).join("\n")}

# SIMULATED PLAYS (ranked by projected 90d incremental revenue)
${compactSimulator(simulator)}

Now: pick winners, group into this_week / next_30_days / quarterly_bet, and draft artifacts. Output JSON only.`;

  return chatJSON<CMOOutput>({
    system: CMO_SYSTEM,
    user: userPrompt,
    ledger,
    maxTokens: 12000,
    temperature: 0.4,
    validate: (v) => {
      if (!v || typeof v !== "object") return false;
      const o = v as Record<string, unknown>;
      return (
        typeof o.executive_summary === "string" &&
        Array.isArray(o.this_week) &&
        Array.isArray(o.next_30_days)
      );
    },
  });
}

/**
 * Flatten CMOOutput → a single ordered FinalPlay[] for the runs.plays column.
 * Order: this_week, next_30_days, quarterly_bet.
 */
export function flattenPlays(cmo: CMOOutput): FinalPlay[] {
  const out: FinalPlay[] = [];
  out.push(...cmo.this_week);
  out.push(...cmo.next_30_days);
  if (cmo.quarterly_bet) out.push(cmo.quarterly_bet);
  return out;
}
