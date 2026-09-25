import { createHash, randomUUID } from "node:crypto";
import contracts from "./lean-contracts.json";
import { normalizeCommerce } from "./commerce";
import { mapShopifyAnalyticsOrder } from "./shopifyMapping";
import { mapPilotSource } from "./shopifyPilotMapping";
import { readPilotSource, type PilotSource } from "./shopifyPilotSource";
import { mappingPolicy, pipelineRpc, validatePipelineTarget, type PipelinePolicy } from "./shopifyPipeline";
import { shopifyId, sourceArray, sourceObject, sourceString } from "./shopifySource";
import { validateCandidateGraph, type Candidate } from "./certification";
import { normalizeSpendBase, type SpendBase } from "./spend";
import { storeDaily, productDaily, acquisitionDaily, type Facts, type ReportScope } from "./reporting";
import type { AnalyticsRpcClient } from "./rpcStore";
import { micros, nyDate } from "./primitives";

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.entries(v).sort(([a],[b]) => a.localeCompare(b))
    .map(([k,x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
  return JSON.stringify(v);
}
const hash = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");
const empty = (): Candidate => Object.fromEntries(contracts.tables.map(t => [t.name, []]));
type Input = {
  original: Record<string, unknown>; lines: Record<string, unknown>[]; lineCount: number;
  shop: string; publication: string; policy: PipelinePolicy | null; evidenceRef: string;
};
function sameInventory(input: Input, source: PilotSource): boolean {
  const current = source.commerce.order, original = input.original;
  if (["id","createdAt","updatedAt","currencyCode","edited","test","cancelledAt","taxesIncluded"]
    .some(k => canonical(current[k]) !== canonical(original[k]))) return false;
  const lines = sourceArray(sourceObject(current.lineItems).nodes).map(sourceObject);
  if (input.lineCount !== lines.length || input.lines.length !== lines.length) return false;
  const moneyEqual = (a: unknown,b: unknown) => {
    const x=sourceObject(sourceObject(a).shopMoney),y=sourceObject(sourceObject(b).shopMoney);
    return x.currencyCode===y.currencyCode && micros(sourceString(x.amount))===micros(sourceString(y.amount));
  };
  for (const prior of input.lines) {
    const next=lines.find(l=>l.id===prior.id);
    if (!next || ["quantity","isGiftCard","product"].some(k=>canonical(next[k])!==canonical(prior[k])) ||
      !["originalUnitPriceSet","originalTotalSet"].every(k=>moneyEqual(next[k],prior[k]))) return false;
  }
  // Refund summaries are real 040 evidence; they cannot be replaced by a different
  // refund set under an unchanged order revision.
  if (Array.isArray(original.refunds)) {
    if (source.refunds.length!==original.refunds.length) return false;
    for (const value of original.refunds) {
      const prior=sourceObject(value),next=source.refunds.find(r=>r.id===prior.id);
      if (!next || next.updatedAt!==prior.updatedAt || !moneyEqual(next.totalRefundedSet,prior.totalRefundedSet)) return false;
    }
  }
  return true;
}
/** Minimal factual pending fallback. No paid clock, original-purchase prices,
 * customer join or SKU is invented from the deliberately smaller bulk query.
 * Zero-quantity source lines remain in staging/outcome counts, not silently
 * relabeled as a valid positive-quantity original purchase. */
function pending(input: Input): Candidate {
  const o = input.original;
  const result = normalizeCommerce({
    shop: input.shop, id: shopifyId(o.id, "Order"), createdAt: sourceString(o.createdAt),
    updatedAt: sourceString(o.updatedAt), currency: sourceString(o.currencyCode),
    paidAt: null, paidEvidenceRef: null, checkoutId: null, shippingCountry: null, shippingRegion: null,
    linesComplete: true, lines: input.lines.filter(l => Number.isSafeInteger(l.quantity) && Number(l.quantity) > 0)
      .map(l => ({ id: shopifyId(l.id, "LineItem"), sku: null,
        productId: l.product === null ? null : shopifyId(sourceObject(l.product).id, "Product"),
        quantity: Number(l.quantity), itemClass: "unknown" as const, unitPrice: null,
        merchandiseDiscount: null, purchaseEvidenceRef: null, offers: [] })),
  }, { eligibility: "pending", commerceSource: "other", acquisitionEligible: false,
    approvalRef: "history-bridge:unclassified-not-an-eligibility-approval" }, input.publication);
  for (const row of result.orders) for (const name of [
    "purchase_merchandise_gross_usd", "purchase_discount_usd", "purchase_merchandise_net_usd",
  ]) row[name] = null;
  return { ...empty(), ...result };
}
export function normalizeHistoricalOrder(input: Input, source: PilotSource | null, unavailable?: string) {
  let facts = pending(input), outcome = unavailable ?? "pending_policy";
  const ref = input.evidenceRef;
  if (source) {
    if (source.commerce.shop !== input.shop || source.commerce.order.id !== input.original.id)
      throw new Error("history_bridge_wrong_source");
    if (source.commerce.order.updatedAt !== input.original.updatedAt) outcome = "source_revision_changed";
    else if (!sameInventory(input,source)) outcome = "source_inventory_mismatch";
    else {
      try {
        const o = source.commerce.order;
        const decision = { eligibility: o.test === true ? "excluded_test" as const : "pending" as const,
          commerceSource: "other" as const, acquisitionEligible: false,
          approvalRef: "history-bridge:unclassified-not-an-eligibility-approval" };
        const mapped = mapShopifyAnalyticsOrder(source.commerce, {
          decision, lineClasses: {}, sourceEvidenceRef: ref,
        }, input.publication);
        facts = { ...empty(), orders: mapped.orders, order_items: mapped.order_items, payments: mapped.payments };
        outcome = "pending_policy";
        if (input.policy) {
          // Exact historical interval is registered separately; neither product
          // match nor current physical-goods approval backdates eligibility.
          const full = mapPilotSource(source, mappingPolicy(source, input.policy), input.publication, ref);
          facts = full.facts; outcome = "financial_observed";
        }
      } catch (error) {
        // Explicit unsupported outcome with retained source, never a skipped ID.
        outcome = error instanceof Error && /^[a-z_]{1,80}$/.test(error.message)
          ? error.message : "unsupported_mapping";
      }
    }
  }
  if (validateCandidateGraph(facts, input.publication, "commerce-only", false).length)
    throw new Error("history_bridge_invalid_graph");
  return { facts, outcome, sourceLineCount: input.lineCount, canonicalLineCount: facts.order_items.length };
}

/** One durable order or one report date per step; caller may run a bounded
 * loop. Progress belongs to the database, not build memory or local files. */
export async function runHistoryReportStep(options: {
  client: AnalyticsRpcClient; projectRef: string; databaseUrl: string; runId: string;
  accessToken: string; fetcher?: typeof fetch; now?: () => string;
}) {
  validatePipelineTarget(options.projectRef, options.databaseUrl);
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(options.runId)) throw new Error("history_bridge_invalid_run");
  const common = { p_run: options.runId, p_project: options.projectRef, p_token: randomUUID() };
  const input = sourceObject(await pipelineRpc(options.client, "lean_history_report_claim", common));
  if (["disabled", "busy", "complete", "expired"].includes(String(input.state)))
    return { state: String(input.state) };
  if (input.state === "report") {
    const facts = sourceObject(input.facts) as Facts;
    const bases = sourceArray(input.spend) as SpendBase[];
    const seen = new Set<string>();
    for (const base of bases) {
      const key = `${base.provider}:${base.accountId}:${base.date}`;
      if (base.provider !== "google_ads" || base.date !== input.date || seen.has(key))
        throw new Error("history_bridge_spend_scope");
      seen.add(key); facts.marketing_spend_daily.push(...normalizeSpendBase(base, String(input.publication)));
    }
    const financial = input.financialComplete === true;
    const scope: ReportScope = { shop: String(input.shop), publication: String(input.publication),
      definition: "history-bridge-v1", model: "commerce-only", date: String(input.date), stale: true,
      gates: { ledger: financial, orders: financial, purchase: financial, productAllocation: financial,
        cash: false, customers: false, spend: bases.length > 0, attribution: false, behavior: false } };
    const comparisons = new Set(facts.marketing_spend_daily.map(r =>
      JSON.stringify([r.channel, r.source_campaign_id === null ? "spend_unallocated" : r.campaign_key])));
    const reports = { store_daily: [storeDaily(facts, scope)], product_daily: productDaily(facts, scope),
      acquisition_daily: acquisitionDaily(facts, scope, comparisons) };
    // No account-completeness/comparability evidence is created by this bridge.
    reports.store_daily[0].mer = null;
    (reports.store_daily[0].readiness as Record<string, string>).mer = "withheld";
    for (const rows of Object.values(reports)) for (const row of rows)
      row.readiness = Object.fromEntries(Object.entries(row.readiness as Record<string, string>)
        .map(([k, v]) => [k, v === "ready" ? "observed_unverified" : v]));
    const done = await pipelineRpc(options.client, "lean_history_report_day", {
      ...common, p_date: input.date, p_input_hash: input.inputHash, p_reports: reports,
      p_spend: facts.marketing_spend_daily,
    });
    return { state: done === true ? "report_written" : "changed", date: String(input.date) };
  }
  if (input.state !== "order") throw new Error("history_bridge_invalid_claim");
  let source = input.source === null ? null : sourceObject(input.source) as PilotSource;
  let unavailable: string | undefined;
  if (source === null && Number(input.lineCount) > 500) unavailable = "source_line_bound";
  if (source === null && input.canRead !== true) unavailable = "interrupted_source_attempt";
  if (source === null && !unavailable) {
    if (!options.accessToken.trim()) throw new Error("history_bridge_missing_token");
    let calls = 0, bytes = 0;
    const deadline = AbortSignal.timeout(60000), request = options.fetcher ?? fetch;
    const bounded: typeof fetch = async (url, init) => {
      if (++calls > 20) throw new Error("history_bridge_request_bound");
      const response = await request(url, { ...init, signal: AbortSignal.any([
        deadline, ...(init?.signal ? [init.signal] : []),
      ]) });
      const reader = response.body?.getReader(); if (!reader) throw new Error("history_bridge_empty_source");
      const chunks: Uint8Array[] = [];
      try { for (;;) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.length;
        if (bytes > 8388608 || deadline.aborted) { await reader.cancel(); throw new Error("history_bridge_byte_bound"); }
        chunks.push(part.value);
      } } finally { reader.releaseLock(); }
      return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
    };
    try {
      source = await readPilotSource({ shop: String(input.shop), accessToken: options.accessToken,
        fetcher: bounded, signal: deadline,
        projection: input.includeCustomerId === true ? "financial_customer_id" : "financial_no_geo",
      }, sourceString(sourceObject(input.original).id));
      if (input.includeCustomerId === true) {
        const customer = source.commerce.order.customer;
        if (customer !== null) shopifyId(sourceObject(customer).id, "Customer");
      }
    } catch {
      unavailable = "source_unavailable"; source = null;
    }
    // No storage error is turned into an unsupported-source success.
    if (source) {
      const capturedAt = (options.now ?? (() => new Date().toISOString()))(); nyDate(capturedAt);
      if (await pipelineRpc(options.client, "lean_history_report_retain", {
        ...common, p_order: source.commerce.order.id, p_source: source, p_captured_at: capturedAt,
      }) !== true) return { state: "changed" };
    }
  }
  const original = sourceObject(input.original);
  const output = normalizeHistoricalOrder({ original, lines: sourceArray(input.lines).map(sourceObject),
    lineCount: Number(input.lineCount), shop: String(input.shop), publication: String(input.publication),
    policy: input.policy === null ? null : sourceObject(input.policy) as PipelinePolicy,
    evidenceRef: source ? `history-report:${options.runId}:${String(original.id)}:sha256:${hash(source)}`
      : `history-import:${String(input.sourceJob)}:${String(original.id)}:${String(input.sourceHash)}`,
  }, source, unavailable);
  const done = await pipelineRpc(options.client, "lean_history_report_order", {
    ...common, p_order: original.id, p_facts: output.facts, p_outcome: output.outcome,
  });
  return { state: done === true ? "order_written" : "changed", outcome: output.outcome };
}
