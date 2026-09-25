import { buildFullReports, type FullBuildEvidence, type FullBuildPolicy } from "./fullReportBuild";
import { readPosthogBehavior, validateBehaviorSource, type BehaviorSource } from "./posthogSource";
import { pipelineRpc, validatePipelineTarget } from "./shopifyPipeline";
import { sourceObject, sourceString } from "./shopifySource";
import type { AnalyticsRpcClient } from "./rpcStore";
import type { Candidate } from "./certification";
import { randomUUID } from "node:crypto";
import { deferredOrders, verifyDeferredReplacements } from "./deferredCommerce";

/** Evidence can narrow observed coverage; it cannot extend a source read.
 * This is deliberately conservative at the NY calendar-day edges.
 */
export function boundBehaviorEvidence(evidence: FullBuildEvidence, source: BehaviorSource,
  policy: FullBuildPolicy, facts: Candidate): FullBuildEvidence {
  const bounded = structuredClone(evidence);
  const from = Date.parse(source.from), until = Date.parse(source.until);
  const declaredThrough = Date.parse(bounded.sessionCoverage.completeThrough);
  if (!Number.isFinite(declaredThrough)) throw new Error("invalid_behavior_coverage");
  bounded.sessionCoverage.completeThrough = new Date(Math.min(until, declaredThrough)).toISOString();
  const orders = new Map(facts.orders.map(row => [row.order_id, row]));
  bounded.attributionCoverage = bounded.attributionCoverage.map(row => {
    const paid = Date.parse(String(orders.get(row.orderId)?.paid_at));
    return { ...row, coverage: { ...row.coverage,
      lookbackComplete: row.coverage.lookbackComplete && Number.isFinite(paid) &&
        from <= paid - policy.attribution.lookbackDays * 86400000 && until > paid,
      graceComplete: row.coverage.graceComplete && Number.isFinite(paid) &&
        Math.min(until, declaredThrough) >= paid + bounded.sessionCoverage.graceSeconds * 1000,
    } };
  });
  bounded.dateCoverage = bounded.dateCoverage.map(row => {
    // NY midnight is 04:00/05:00 UTC. Requiring the whole enclosing UTC span
    // avoids certifying a partially read local day without a timezone oracle.
    const start = Date.parse(`${row.date}T00:00:00Z`);
    const dayCovered = from <= start && until >= start + 30 * 3600000;
    return { ...row, gates: { ...row.gates, behavior: row.gates.behavior && dayCovered,
      attribution: row.gates.attribution && dayCovered &&
        bounded.attributionCoverage.every(r => r.coverage.lookbackComplete && r.coverage.graceComplete) } };
  });
  return bounded;
}

export async function runFullReportJob(options: {
  client: AnalyticsRpcClient; projectRef: string; databaseUrl: string; runId: string;
  posthogKey: string; request?: typeof fetch;
}) {
  validatePipelineTarget(options.projectRef, options.databaseUrl);
  if (!options.runId.trim() || options.runId.length > 128) throw new Error("invalid_full_run");
  const args = { p_run: options.runId, p_project_ref: options.projectRef };
  const input = sourceObject(await pipelineRpc(options.client, "lean_full_inputs", args));
  if (["disabled", "blocked", "complete"].includes(String(input.state))) return { state: String(input.state) };
  if (input.state !== "ready") throw new Error("invalid_full_input");
  const policy = sourceObject(input.policy) as FullBuildPolicy;
  const evidence = sourceObject(input.evidence) as FullBuildEvidence;
  const behavior = sourceObject(input.behavior) as BehaviorSource;
  verifyDeferredReplacements(deferredOrders(input.deferredOrders), evidence, sourceString(input.shop));
  validateBehaviorSource(behavior);
  if (behavior.project !== policy.project || Date.parse(behavior.until) > Date.parse(policy.asOf) ||
      Object.values(policy.stages).some(f => !Object.hasOwn(behavior.families, f)) ||
      Object.keys(behavior.families).some(f => !Object.values(policy.stages).includes(f)))
    throw new Error("full_behavior_policy_mismatch");
  const lease = { ...args, p_token: randomUUID() };
  const claimed = await pipelineRpc(options.client, "lean_full_claim", lease);
  if (claimed === false) return { state: "busy_or_exhausted" };
  if (claimed !== true) throw new Error("invalid_full_claim");
  let result: ReturnType<typeof buildFullReports>;
  try {
    const events = await readPosthogBehavior(behavior, options.posthogKey, options.request);
    const base = sourceObject(input.facts) as Candidate;
    result = buildFullReports({ base,
      publication: sourceString(input.publication), shop: sourceString(input.shop),
      fromDate: sourceString(input.fromDate), throughDate: sourceString(input.throughDate),
      policy, evidence: boundBehaviorEvidence(evidence, behavior, policy, base), events });
  } catch {
    await pipelineRpc(options.client, "lean_full_fail", lease);
    throw new Error("full_transform_unavailable");
  }
  // Ambiguous response is never replayed here. A subsequent invocation first reads state.
  const done = await pipelineRpc(options.client, "lean_full_finish", {
    ...lease, p_input_hash: sourceString(input.inputHash), p_facts: result.facts,
    p_reports: result.reports, p_manifest: result.manifest,
  });
  if (typeof done !== "boolean") throw new Error("invalid_full_finish");
  return { state: done ? "complete" : "changed", certification: "unverified",
    reports: Object.fromEntries(Object.entries(result.reports).map(([name, rows]) => [name, rows.length])) };
}
