/**
 * CMO Brain — shared LLM helpers.
 *
 * Two primary helpers:
 *   - chatJSON: forces a structured JSON response with a tight retry loop.
 *   - chatJSONWithWebSearch: same, but the model can invoke Anthropic's
 *     server-side web_search tool to ground claims in current sources.
 *
 * Token accounting is collected on a shared `TokenLedger` so the orchestrator
 * can persist total spend per run.
 */

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface TokenLedger {
  input: number;
  output: number;
}

export function newLedger(): TokenLedger {
  return { input: 0, output: 0 };
}

// Sonnet 4.6 (2025-10) pricing: $3 / $15 per Mtok.
const PRICE_IN_PER_MTOK_USD = 3;
const PRICE_OUT_PER_MTOK_USD = 15;

export function ledgerCostCents(l: TokenLedger): number {
  const usd =
    (l.input / 1_000_000) * PRICE_IN_PER_MTOK_USD +
    (l.output / 1_000_000) * PRICE_OUT_PER_MTOK_USD;
  return Math.round(usd * 100);
}

function stripCodeFence(s: string): string {
  return s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function extractJSON(s: string): string {
  // Find the first { or [ and the matching closer at the end.
  const t = stripCodeFence(s);
  const start = Math.min(
    ...["{", "["]
      .map((c) => t.indexOf(c))
      .filter((i) => i >= 0)
      .concat([Number.MAX_SAFE_INTEGER])
  );
  if (!Number.isFinite(start)) return t;
  // walk backward from end to find last } or ]
  let end = t.length - 1;
  while (end >= 0 && !"}]".includes(t[end])) end -= 1;
  return t.slice(start, end + 1);
}

export interface ChatJSONOptions {
  system: string;
  user: string;
  ledger: TokenLedger;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** If supplied, the parsed JSON is passed through this validator. */
  validate?: (value: unknown) => boolean;
}

export async function chatJSON<T>(opts: ChatJSONOptions): Promise<T> {
  const model = opts.model ?? "claude-sonnet-4-6";
  const maxTokens = opts.maxTokens ?? 4096;
  const temperature = opts.temperature ?? 0.2;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const msg = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: opts.system,
      messages: [
        {
          role: "user",
          content:
            opts.user +
            (attempt > 0
              ? `\n\nIMPORTANT: Your previous response was not valid JSON or failed schema validation. Output ONLY valid JSON. Do not include any prose, code fences, or commentary. Begin your response with { and end with }.`
              : ""),
        },
      ],
    });
    opts.ledger.input += msg.usage?.input_tokens ?? 0;
    opts.ledger.output += msg.usage?.output_tokens ?? 0;

    const textBlock = msg.content.find((b) => b.type === "text");
    const text =
      textBlock && textBlock.type === "text" ? textBlock.text : "";
    try {
      const parsed = JSON.parse(extractJSON(text)) as T;
      if (opts.validate && !opts.validate(parsed)) {
        throw new Error("schema validation failed");
      }
      return parsed;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw new Error(
    `chatJSON failed after retries: ${lastErr?.message ?? "unknown"}`
  );
}

/**
 * Chat with Anthropic web_search tool enabled. The model can issue web
 * queries and grounds answers with citation URLs. Returns parsed JSON.
 */
export async function chatJSONWithWebSearch<T>(
  opts: ChatJSONOptions & { maxSearches?: number }
): Promise<T> {
  const model = opts.model ?? "claude-sonnet-4-6";
  const maxTokens = opts.maxTokens ?? 4096;
  const temperature = opts.temperature ?? 0.2;
  const maxSearches = opts.maxSearches ?? 4;

  // The Anthropic SDK exposes server-side web_search as a built-in tool.
  // SDK type defs may lag the API; cast through unknown to avoid coupling
  // this code to a specific @anthropic-ai/sdk version.
  const tools = [
    {
      type: "web_search_20250305",
      name: "web_search",
      max_uses: maxSearches,
    },
  ] as unknown as Anthropic.Messages.ToolUnion[];

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let msg: Awaited<ReturnType<typeof client.messages.create>>;
    try {
      msg = await client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        system: opts.system,
        tools,
        messages: [
          {
            role: "user",
            content:
              opts.user +
              (attempt > 0
                ? `\n\nIMPORTANT: Output ONLY valid JSON. Begin with { and end with }.`
                : ""),
          },
        ],
      });
    } catch (err) {
      // Fallback: model/SDK version doesn't support web_search server-side tool.
      // Degrade gracefully to plain chatJSON so the pipeline still runs.
      const m = err instanceof Error ? err.message : String(err);
      console.warn(`[cmo] web_search unavailable, falling back: ${m}`);
      return chatJSON<T>(opts);
    }
    opts.ledger.input += msg.usage?.input_tokens ?? 0;
    opts.ledger.output += msg.usage?.output_tokens ?? 0;

    // Pull the final text block (model may emit multiple text blocks
    // around web_search tool_use blocks).
    const textBlocks = msg.content.filter((b) => b.type === "text");
    const fullText = textBlocks
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n");
    try {
      const parsed = JSON.parse(extractJSON(fullText)) as T;
      if (opts.validate && !opts.validate(parsed)) {
        throw new Error("schema validation failed");
      }
      return parsed;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw new Error(
    `chatJSONWithWebSearch failed: ${lastErr?.message ?? "unknown"}`
  );
}
