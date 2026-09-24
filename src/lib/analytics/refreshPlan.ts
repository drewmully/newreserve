import { assembleEvidence, evidenceDigest } from "./evidenceIntake";
import type { FullBuildPolicy } from "./fullReportBuild";
import { validateBehaviorSource, type BehaviorSource } from "./posthogSource";
import type { PipelinePolicy } from "./shopifyPipeline";
import { reportDates } from "./commerceCandidate";
import { nyDate } from "./primitives";

export type RefreshInput = {
  intake: Parameters<typeof assembleEvidence>[0];
  policy: FullBuildPolicy; behavior: BehaviorSource;
  commercePolicy: PipelinePolicy & { deferredOrders?: unknown[] };
  history: { from: string; until: string; pageSize: number; maxPages: number;
    scanBasis?: "created_at" | "updated_at" }[];
  accounts: { accountId: string; loginCustomerId: string | null; maxPages: number }[];
  approvalRef: string; actorRef: string; revision: string;
  readyAt: string; expiresAt: string; maxSteps: number;
};
/** Pure preparation: no network, database write, credential or activation.
 * Every refresh needs newly captured source evidence. Advancing a date on an
 * old all-passed fixture is not an acceptable refresh.
 */
export function prepareRefresh(input: RefreshInput) {
  const { scope } = input.intake;
  const assembled = assembleEvidence(input.intake);
  validateBehaviorSource(input.behavior);
  const dates = reportDates(scope.fromDate, scope.throughDate);
  if (dates.length > 31 || !input.approvalRef?.trim() || !input.actorRef?.trim() ||
      !/^[a-zA-Z0-9_.:-]{1,128}$/.test(input.revision)) throw new Error("invalid_refresh_approval");
  if (input.policy.asOf !== input.intake.asOf || input.policy.project !== input.behavior.project ||
      !input.policy.approvalRef?.trim() || !input.commercePolicy.decision?.approvalRef?.trim() ||
      !input.commercePolicy.financialApprovalRef?.trim()) throw new Error("refresh_policy_mismatch");
  nyDate(input.readyAt); nyDate(input.expiresAt);
  if (Date.parse(input.readyAt) < Date.parse(input.intake.asOf) ||
      Date.parse(input.expiresAt) <= Date.parse(input.readyAt) ||
      Date.parse(input.expiresAt) - Date.parse(input.intake.asOf) > 86400000 ||
      !Number.isSafeInteger(input.maxSteps) || input.maxSteps < 3 || input.maxSteps > 128)
    throw new Error("invalid_refresh_execution_window");
  // Current consent/removal evidence must remain within its approved freshness
  // bound for the entire run, not just when this plan is prepared.
  for (const packet of input.intake.packets) {
    const binding = input.intake.bindings.find(b => b.sourceId === packet.sourceId)!;
    if (Date.parse(input.expiresAt) - Date.parse(packet.capturedAt) > binding.maxAgeSeconds * 1000)
      throw new Error("refresh_outlives_evidence");
  }
  if (!input.history.length || input.history.length > 5) throw new Error("refresh_history_budget");
  let pages = 0, rows = 0;
  const windows = input.history.map(h => {
    nyDate(h.from); nyDate(h.until);
    if (Date.parse(h.until) <= Date.parse(h.from) || Date.parse(h.until) > Date.parse(input.intake.asOf) ||
        h.scanBasis !== undefined && !["created_at", "updated_at"].includes(h.scanBasis) ||
        !Number.isSafeInteger(h.pageSize) || h.pageSize < 1 || h.pageSize > 5 ||
        !Number.isSafeInteger(h.maxPages) || h.maxPages < 1)
      throw new Error("invalid_refresh_history");
    pages += h.maxPages; rows += h.maxPages * h.pageSize;
    return { ...h };
  }).sort((a, b) => a.from.localeCompare(b.from));
  if (pages > 25 || rows > 100) throw new Error("refresh_history_budget");
  // Creation backfills and update scans may overlap; duplicate orders are
  // revision-deduplicated downstream. Within one basis, overlapping jobs are
  // wasteful and risk exhausting the approved read budget.
  if (windows.some((w, i) => windows.slice(0, i).some(prior =>
    (w.scanBasis ?? "created_at") === (prior.scanBasis ?? "created_at") &&
    Date.parse(w.from) < Date.parse(prior.until))))
    throw new Error("overlapping_refresh_history");
  const accounts = new Set<string>();
  for (const a of input.accounts) {
    if (!/^\d{10}$/.test(a.accountId) || accounts.has(a.accountId) ||
        a.loginCustomerId !== null && !/^\d{10}$/.test(a.loginCustomerId) ||
        !Number.isSafeInteger(a.maxPages) || a.maxPages < 1 || a.maxPages > 10)
      throw new Error("invalid_refresh_account");
    accounts.add(a.accountId);
  }
  if (dates.length * accounts.size > 100 || pages + dates.length * accounts.size + 2 > input.maxSteps)
    throw new Error("refresh_step_budget");
  // A changing evidence/source/policy revision gets new immutable jobs. Same
  // approved input produces the same IDs for safe registration reconciliation.
  const digest = evidenceDigest(input), runId = `refresh:${digest.slice(0, 48)}`;
  const common = { projectRef: scope.projectRef, approvalRef: input.approvalRef, actorRef: input.actorRef };
  const history = windows.map((h, i) => ({ ...common, ...h, shop: scope.shop, runId: `${runId}:h${i}` }));
  const spend = input.accounts.flatMap((a, i) => dates.map((date, j) => ({
    ...common, ...a, date, runId: `${runId}:s${i}:${j}`,
  })));
  return {
    version: 1, ...common, runId, digest, evidenceDigest: assembled.digest, lineage: assembled.lineage,
    history, spend,
    base: { ...common, runId: `${runId}:base`, shop: scope.shop, fromDate: scope.fromDate,
      throughDate: scope.throughDate, historyRuns: history.map(h => h.runId), spendRuns: spend.map(s => s.runId),
      policy: input.commercePolicy },
    full: { ...common, runId, baseRun: `${runId}:base`, policy: input.policy,
      behavior: input.behavior, evidence: assembled.evidence },
    queue: { readyAt: input.readyAt, expiresAt: input.expiresAt, maxSteps: input.maxSteps },
  };
}
export type PreparedRefresh = ReturnType<typeof prepareRefresh>;
