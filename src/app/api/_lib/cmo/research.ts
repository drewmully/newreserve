/**
 * CMO Brain — Layer 3: Researchers.
 *
 * Takes Analyst findings, picks the most consequential hypotheses, and uses
 * Anthropic's server-side web_search tool to ground them with current
 * industry benchmarks, competitor moves, and tactic playbooks. Falls back
 * gracefully to plain chatJSON if web_search isn't available.
 */

import { chatJSONWithWebSearch, type TokenLedger } from "./llm";
import type {
  AnalystOutput,
  ResearchAnswer,
  ResearchBundle,
} from "./types";

const RESEARCH_OUTPUT_SHAPE = `
{
  "topic": "short label e.g. 'checkout_abandonment_benchmarks'",
  "question": "the exact question researched",
  "answer": "3-5 sentence synthesis of what current sources say",
  "benchmarks": [
    { "metric": "metric name", "value": "value with unit", "source": "publication or domain" }
  ],
  "recommended_tactics": [
    {
      "tactic": "concrete, shippable tactic (not vague advice)",
      "expected_lift_pct": { "low": 0, "high": 0 },
      "effort": "S" | "M" | "L",
      "evidence": "1-sentence reason backed by a cited source"
    }
  ],
  "citations": [
    { "title": "page title", "url": "https://...", "excerpt": "1-line quote or paraphrase" }
  ]
}
`;

const RESEARCH_SYSTEM = `You are a research analyst for a CMO brain trust supporting MyMully.com — a quarterly subscription box for athletic/golf apparel.

Your job: take a specific hypothesis from another analyst and validate or refute it using CURRENT web sources (2025). You have access to a web_search tool. Use it.

RULES:
- Cite sources with real URLs (no fabricated links). Each recommended_tactic must trace back to a citation or to first-principles reasoning made explicit.
- Prefer first-party sources (Shopify, Google, Klaviyo, Stripe, industry reports) over blog spam.
- Numbers must come from named sources, not guesses. If you cannot find a benchmark, say so in 'answer' and omit from 'benchmarks'.
- Tactics must be concrete and shippable in <14 days (S=hours, M=days, L=1-2 weeks). Skip vague advice.
- Output ONLY valid JSON. No prose, no code fences. Begin with { end with }.

OUTPUT SHAPE:
${RESEARCH_OUTPUT_SHAPE}`;

interface ResearchTopic {
  topic: string;
  question: string;
}

/**
 * Pick research topics from analyst findings.
 * Strategy: take top-severity findings + 1 always-on competitive scan.
 */
function pickResearchTopics(analysts: AnalystOutput[]): ResearchTopic[] {
  const topics: ResearchTopic[] = [];

  // Pull all findings, score them, take top.
  const scored: Array<{ score: number; finding: string; tags: string[]; analyst: string }> = [];
  for (const a of analysts) {
    for (const f of a.findings) {
      const sev = f.severity === "critical" ? 3 : f.severity === "major" ? 2 : 1;
      const dollar = Math.max(0, Math.log10((f.dollar_impact_estimate_cents || 1) / 100));
      scored.push({
        score: sev * 2 + dollar,
        finding: f.finding,
        tags: f.tags ?? [],
        analyst: a.analyst,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  // Pick top 4 unique-by-analyst findings.
  const seenAnalysts = new Set<string>();
  for (const s of scored) {
    if (topics.length >= 4) break;
    // Allow up to 2 per analyst, but prefer diverse coverage.
    const count = [...seenAnalysts].filter((x) => x === s.analyst).length;
    if (count >= 2) continue;
    seenAnalysts.add(s.analyst);
    topics.push({
      topic: s.tags.slice(0, 2).join("_") || `${s.analyst}_finding`,
      question: `For a quarterly subscription box in athletic/golf apparel: ${s.finding} What are current 2025 industry benchmarks for the underlying metric, and what tactics have peer brands used to fix it? Give specific examples.`,
    });
  }

  // Always-on competitive topic if we have room.
  if (topics.length < 5) {
    topics.push({
      topic: "competitive_landscape_2025",
      question: `What are 3-5 direct or adjacent competitors to MyMully (quarterly athletic/golf apparel subscription) doing in 2025 around acquisition, pricing, retention, and product mix? Cite specific examples with sources.`,
    });
  }

  return topics;
}

async function researchOne(
  topic: ResearchTopic,
  ledger: TokenLedger
): Promise<ResearchAnswer | null> {
  try {
    const out = await chatJSONWithWebSearch<ResearchAnswer>({
      system: RESEARCH_SYSTEM,
      user: `TOPIC: ${topic.topic}\n\nQUESTION: ${topic.question}\n\nSearch the web. Synthesize. Output JSON per the schema.`,
      ledger,
      maxTokens: 6000,
      maxSearches: 5,
      temperature: 0.3,
      validate: (v) => {
        if (!v || typeof v !== "object") return false;
        const o = v as Record<string, unknown>;
        return (
          typeof o.topic === "string" &&
          typeof o.question === "string" &&
          typeof o.answer === "string" &&
          Array.isArray(o.recommended_tactics) &&
          Array.isArray(o.citations)
        );
      },
    });
    return out;
  } catch (err) {
    console.warn(`[cmo/research] topic ${topic.topic} failed:`, err);
    return null;
  }
}

export async function runResearchers(
  analysts: AnalystOutput[],
  ledger: TokenLedger
): Promise<ResearchBundle> {
  const topics = pickResearchTopics(analysts);
  const results = await Promise.all(topics.map((t) => researchOne(t, ledger)));
  return {
    answers: results.filter((r): r is ResearchAnswer => r !== null),
    generated_at: new Date().toISOString(),
  };
}
