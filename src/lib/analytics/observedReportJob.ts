import { buildCommerceCandidate, reportDates, type RetainedCommerce } from "./commerceCandidate";
import { mappingPolicy, pipelineRpc, validatePipelineTarget, type PipelinePolicy } from "./shopifyPipeline";
import type { AnalyticsRpcClient } from "./rpcStore";
import type { PilotSource } from "./shopifyPilotSource";
import { normalizeSpendBase, type SpendBase } from "./spend";
import { sourceArray, sourceObject, sourceString } from "./shopifySource";
import { acquisitionDaily, type Facts, type ReportScope } from "./reporting";
import { validateCandidateGraph } from "./certification";
import { decimal, micros, type Row } from "./primitives";

/** Saved sources only: no vendor credentials, source discovery or live requests.
 * This joins selected observations, NOT independently certified store coverage.
 */
export async function runObservedReportJob(options: {
  client: AnalyticsRpcClient; projectRef: string; databaseUrl: string; runId: string;
}) {
  validatePipelineTarget(options.projectRef, options.databaseUrl);
  if (!options.runId.trim() || options.runId.length > 128) throw new Error("invalid_report_run");
  const args = { p_run: options.runId, p_project_ref: options.projectRef };
  const input = sourceObject(await pipelineRpc(options.client, "lean_report_inputs", args));
  if (["disabled", "blocked", "complete"].includes(String(input.state))) return { state: String(input.state) };
  if (input.state !== "ready") throw new Error("invalid_report_input");
  const shop = sourceString(input.shop), publication = sourceString(input.publication);
  const definition = "observed-sources-v1", fromDate = sourceString(input.fromDate), throughDate = sourceString(input.throughDate);
  const dates = reportDates(fromDate, throughDate);
  if (dates.length > 31) throw new Error("report_date_budget");
  const policy = sourceObject(input.policy) as PipelinePolicy;
  const sources = sourceArray(input.history);
  if (sources.length > 100) throw new Error("report_order_budget");
  const skus = new Set<unknown>();
  const records: RetainedCommerce[] = sources.map(value => {
    const item = sourceObject(value), source = sourceObject(item.source) as PilotSource;
    for (const line of sourceArray(sourceObject(source.commerce.order.lineItems).nodes))
      skus.add(sourceObject(line).sku ?? "unknown");
    return { source, policy: mappingPolicy(source, policy), evidenceRef: sourceString(item.evidenceRef) };
  });
  if (skus.size * dates.length > 20000) throw new Error("report_product_budget");
  const result = buildCommerceCandidate(records, { shop, publication, definition, fromDate, throughDate });
  const bases = sourceArray(input.spend) as SpendBase[];
  const seen = new Set<string>();
  if (bases.reduce((n, base) => n + base.rows.length, 0) > 10000) throw new Error("report_spend_budget");
  for (const base of bases) {
    const scope = JSON.stringify([base.provider, base.accountId, base.date]);
    if (base.provider !== "google_ads" || !dates.includes(base.date) || seen.has(scope))
      throw new Error("report_spend_scope");
    seen.add(scope);
    result.facts.marketing_spend_daily.push(...normalizeSpendBase(base, publication));
  }
  if (validateCandidateGraph(result.facts, publication, "commerce-only", false).length)
    throw new Error("report_invalid_graph");
  const acquisition: Row[] = [];
  for (const date of dates) {
    const selected = result.facts.marketing_spend_daily.filter(row => row.report_date === date);
    // A missing account/day stays null; only returned compatible observations sum.
    const spend = selected.length && selected.every(row => row.spend_usd !== null)
      ? decimal(selected.reduce((n, row) => n + micros(row.spend_usd as string), BigInt(0))) : null;
    const store = result.reports.store_daily.find(row => row.report_date === date)!;
    store.spend_usd = spend;
    (store.readiness as Record<string, string>).spend_usd = spend === null ? "withheld" : "observed_unverified";
    const s: ReportScope = { shop, publication, definition, model: "commerce-only", date, stale: true,
      gates: { ledger: false, cash: false, orders: false, purchase: false, customers: false,
        spend: selected.length > 0, attribution: false, behavior: false, productAllocation: false } };
    const comparisons = new Set(selected.map(row => JSON.stringify([row.channel,
      row.source_campaign_id === null ? "spend_unallocated" : row.campaign_key])));
    acquisition.push(...acquisitionDaily(result.facts as Facts, s, comparisons));
  }
  for (const row of acquisition) row.readiness = Object.fromEntries(
    Object.entries(row.readiness as Record<string, string>).map(([k, v]) => [k, v === "ready" ? "observed_unverified" : v]));
  const reports = { ...result.reports, acquisition_daily: acquisition };
  const payload = { facts: result.facts, reports };
  if (Buffer.byteLength(JSON.stringify(payload)) > 16000000) throw new Error("report_payload_budget");
  // Never catch and replay: the write may have committed before a lost response.
  const committed = await pipelineRpc(options.client, "lean_report_finish", {
    ...args, p_input_hash: sourceString(input.inputHash), p_facts: payload.facts, p_reports: payload.reports,
  });
  if (typeof committed !== "boolean") throw new Error("invalid_report_finish");
  return { state: committed ? "complete" : "changed", certification: "unverified" };
}
