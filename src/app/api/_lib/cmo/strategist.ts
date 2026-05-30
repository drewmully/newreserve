/**
 * CMO Brain — Layer 4: Strategist.
 *
 * Single high-context LLM call that cross-references analyst findings + web
 * research into a ranked set of CandidatePlay objects with ICE scores.
 * Output is intentionally narrow (≤8 plays) so downstream simulation/synthesis
 * stays focused.
 */

import { chatJSON, type TokenLedger } from "./llm";
import type {
  AnalystOutput,
  ResearchBundle,
  StrategistOutput,
  SensorBundle,
} from "./types";

const STRATEGIST_OUTPUT_SHAPE = `
{
  "summary": "2-3 sentence narrative: what story do the data + research tell? Where is the leverage?",
  "plays": [
    {
      "id": "kebab-case-slug",
      "title": "<=8 word play name",
      "hypothesis": "If we do X, then Y will move, because Z (cite specific evidence)",
      "funnel_stage": "acquisition" | "activation" | "retention" | "monetization" | "site",
      "expected_lift": { "metric": "metric_name", "low_pct": 0, "high_pct": 0 },
      "effort": "S" | "M" | "L",
      "ice": { "impact": 1-10, "confidence": 1-10, "ease": 1-10, "score": 0 },
      "depends_on": ["which analyst findings or research IDs back this"],
      "risks": ["1-2 specific failure modes"]
    }
  ],
  "rejected": [
    { "idea": "play we considered", "reason": "why we cut it" }
  ]
}
`;

const STRATEGIST_SYSTEM = `You are the Chief Strategist on a CMO brain trust for MyMully.com — a quarterly subscription box for athletic/golf apparel.

You receive findings from 5 specialist analysts (performance, acquisition, retention, site, competitive) plus web-grounded research with citations. Your job: distill this into a ranked set of CONCRETE, SHIPPABLE plays.

RULES:
- Output 5-8 plays MAX. Cut weak ideas — quality over quantity.
- Every play must trace back to specific evidence: cite analyst findings or research answers in 'depends_on'.
- 'hypothesis' must follow "If [action], then [metric will move by X], because [mechanism]". No vague pitches.
- ICE: impact 1-10 (dollar magnitude), confidence 1-10 (evidence strength), ease 1-10 (10=ship today). Score = impact * confidence * ease / 10 (so max 100).
- Effort S = ships in hours, M = 1-3 days, L = 1-2 weeks. Anything bigger gets rejected with reason "too-large-scope".
- expected_lift.metric must be a SPECIFIC funnel metric (e.g. "checkout_completion_pct", "renewal_rate_90d_pct", "cac_cents", "lp_subscription_conversion_pct"). No vanity metrics.
- low_pct/high_pct are percentage POINTS of lift on that metric (not relative %). Be honest — a 2pp checkout lift is huge.
- Include at least 1 play per funnel stage if evidence supports it. Don't bunch everything in acquisition.
- 'rejected' should list 2-4 ideas you considered and cut, with reasons. This proves rigor.
- Output ONLY valid JSON. No prose, no fences.

OUTPUT SHAPE:
${STRATEGIST_OUTPUT_SHAPE}`;

function compactAnalysts(analysts: AnalystOutput[]): string {
  return analysts
    .map((a) => {
      const findings = a.findings
        .map(
          (f, i) =>
            `  ${a.analyst}.${i + 1} [${f.severity}] ${f.finding} — evidence: ${f.evidence.metric}=${f.evidence.value} (${f.evidence.source}) — est $${(f.dollar_impact_estimate_cents / 100).toFixed(0)}/period`
        )
        .join("\n");
      return `## ${a.analyst.toUpperCase()} ANALYST\n${a.summary}\n${findings}`;
    })
    .join("\n\n");
}

function compactResearch(research: ResearchBundle): string {
  return research.answers
    .map((r, i) => {
      const tactics = r.recommended_tactics
        .map(
          (t) =>
            `    - ${t.tactic} (effort ${t.effort}, +${t.expected_lift_pct.low}-${t.expected_lift_pct.high}pct, ${t.evidence})`
        )
        .join("\n");
      const bench = (r.benchmarks ?? [])
        .map((b) => `    - ${b.metric}: ${b.value} (${b.source})`)
        .join("\n");
      return `## RESEARCH.${i + 1} — ${r.topic}\n${r.answer}\nBenchmarks:\n${bench || "    - (none)"}\nTactics:\n${tactics || "    - (none)"}`;
    })
    .join("\n\n");
}

function compactSensorContext(sensors: SensorBundle): string {
  const h = sensors.funnel.headline;
  return `BUSINESS CONTEXT (window ${sensors.funnel.window.start} → ${sensors.funnel.window.end}):
- New reserve members: ${h.new_reserve_members}
- Renewals: ${h.renewals}
- Ad spend: $${(h.ad_spend_cents / 100).toFixed(2)}
- CAC: $${(h.cac_cents / 100).toFixed(2)}
- Active subs: ${sensors.retention.active_subs}, paused: ${sensors.retention.paused_subs}, cancelled: ${sensors.retention.cancelled_subs}
- Renewal rate avg: ${sensors.retention.avg_renewal_rate_pct}%
- Funnel: landed=${sensors.funnel.funnel_totals.landed}, initiated=${sensors.funnel.funnel_totals.initiated}, completed=${sensors.funnel.funnel_totals.completed}`;
}

export async function runStrategist(
  sensors: SensorBundle,
  analysts: AnalystOutput[],
  research: ResearchBundle,
  ledger: TokenLedger
): Promise<StrategistOutput> {
  const userPrompt = `${compactSensorContext(sensors)}

# ANALYST FINDINGS
${compactAnalysts(analysts)}

# RESEARCH (web-grounded)
${compactResearch(research)}

Now: synthesize. Produce 5-8 ranked plays with ICE scores. Output JSON only.`;

  return chatJSON<StrategistOutput>({
    system: STRATEGIST_SYSTEM,
    user: userPrompt,
    ledger,
    maxTokens: 6000,
    temperature: 0.3,
    validate: (v) => {
      if (!v || typeof v !== "object") return false;
      const o = v as Record<string, unknown>;
      return (
        typeof o.summary === "string" &&
        Array.isArray(o.plays) &&
        (o.plays as unknown[]).length > 0
      );
    },
  });
}
