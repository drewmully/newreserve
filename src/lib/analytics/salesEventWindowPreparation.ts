import { buildFullReports, type FullBuildEvidence, type FullBuildPolicy } from "./fullReportBuild";
import { evidenceDigest } from "./evidenceIntake";
import { prepareSalesEventWindow, type SalesEventWindowInput } from "./salesEventWindowInput";
import { nyDate } from "./primitives";
import type { AnalyticsRpcClient } from "./rpcStore";
import { pipelineRpc, validatePipelineTarget } from "./shopifyPipeline";
import { prepareFreshGoogleSpend } from "./googleSpendRegistration";
import type { FreshGoogleSpendReportInput } from "./googleSpendReportInput";

export function bindSalesEventWindow(value: Omit<SalesEventWindowInput, "digest">): SalesEventWindowInput {
  return { ...structuredClone(value), digest: evidenceDigest(value) };
}

/** Explicit unavailable-domain evidence, not measured zero, empty consent,
 * complete customer history, or a recycled prior full-input packet.
 */
export function prepareSalesEventWindowReport(input: {
  source: SalesEventWindowInput; policy: FullBuildPolicy; publication: string;
}) {
  const { source, publication } = input, scope = source.scope;
  if (input.policy.behaviorMode !== "excluded" || input.policy.customerGeneration !== undefined ||
      input.policy.salesEventWindow !== undefined)
    throw new Error("sales_event_window_separate_domain_preparation");
  const prepared = prepareSalesEventWindow(source, { ...scope, publication, asOf: input.policy.asOf });
  const policy: FullBuildPolicy = { ...structuredClone(input.policy),
    salesEventWindow: { version: 1, digest: source.digest } };
  const evidence: FullBuildEvidence = {
    ref: prepared.ref, identity: [], currentlyPermitted: [], removedCustomers: [], customerHistory: {},
    orderIdentities: [], checkout: [], campaigns: [],
    sessionCoverage: { behaviorComplete: false, completeThrough: prepared.oldestCaptureAt,
      graceSeconds: 0, approvalRef: policy.approvalRef },
    attributionCoverage: [], replacements: prepared.replacements, settlements: [], offers: [],
    proofs: [], externalControls: {},
    dateCoverage: prepared.dates.map(date => ({ date, evidenceRef: prepared.ref, gates: {
      ledger: true, orders: true, purchase: true, productAllocation: true,
      cash: false, customers: false, spend: false, behavior: false, attribution: false
    } })), comparisons: [], cohortCoverage: [], salesEventWindow: source
  };
  const buildInput = { base: prepared.base, publication, shop: scope.shop,
    fromDate: scope.fromDate, throughDate: scope.throughDate, policy, evidence, events: [] };
  const result = buildFullReports(buildInput);
  return { buildInput, result, deferredOrders: prepared.deferred,
    sourceBinding: { digest: source.digest, sourceBindings: prepared.sourceBindings,
      independentEvents: prepared.summaries, oldestCaptureAt: prepared.oldestCaptureAt,
      latestCaptureAt: prepared.latestCaptureAt, metadata: prepared.metadataDisposition,
      paidWindowProof: prepared.paidWindowProof, scopedCustomers: prepared.scopedCustomers,
      composedDailyCustomers: Object.fromEntries(prepared.customerCounts),
      customerCompositionScope: "complete_paid_window_plus_selected_current_observable_shopify_history" },
    status: "private_event_window_candidate" as const, certified: false,
    operatingAuthority: null, fullStoreFinancialPopulation: false, sourceReads: 0 };
}

export type SalesEventWindowAuthority = {
  approvalRef: string; actorRef: string; readyAt: string; expiresAt: string; maxAgeSeconds: number;
};
/** Operating authority is mandatory here, never copied from the business-policy
 * refs. This compiler only prepares owner RPC arguments and never enables them.
 */
export function prepareSalesEventWindowRegistration(input: {
  source: SalesEventWindowInput; policy: FullBuildPolicy; runId: string; baseRunId: string;
  authority: SalesEventWindowAuthority;
  /** Optional genuine separately registered Google source. Meta may bind to the
   * same disabled run through its existing owner-only registration, not here. */
  freshGoogleSpend?: Omit<FreshGoogleSpendReportInput, "bases">;
}) {
  const { authority: a, source, runId, baseRunId } = input;
  if (!a || Object.keys(a).sort().join(",") !== ["approvalRef", "actorRef", "readyAt", "expiresAt", "maxAgeSeconds"].sort().join(",") ||
      ![a.approvalRef, a.actorRef].every(v => typeof v === "string" && v.trim() && v.length <= 512) ||
      ![runId, baseRunId].every(v => /^[A-Za-z0-9:_-]{1,100}$/.test(v)) || runId === baseRunId ||
      !Number.isSafeInteger(a.maxAgeSeconds) || a.maxAgeSeconds < 1 || a.maxAgeSeconds > 86400)
    throw new Error("sales_event_window_operating_authority_required");
  nyDate(a.readyAt); nyDate(a.expiresAt);
  const candidate = prepareSalesEventWindowReport({ source, policy: input.policy, publication: `full:${runId}` });
  const fresh = input.freshGoogleSpend;
  let spendRuns: string[] = [];
  if (fresh) {
    const validated = prepareFreshGoogleSpend(fresh.manifest);
    const m = validated.manifest;
    if (m.projectRef !== source.scope.projectRef || m.sourceCurrency !== "USD" ||
        m.sourceTimezone !== "America/New_York" || fresh.marketingInventory.shop !== source.scope.shop ||
        JSON.stringify(m.days.map(d => d.date).sort()) !== JSON.stringify(candidate.buildInput.evidence.dateCoverage.map(d => d.date).sort()) ||
        Date.parse(a.expiresAt) > Date.parse(m.expiresAt))
      throw new Error("sales_event_window_spend_scope");
    spendRuns = validated.registration.args.p_scope.days.map(d => d.runId);
  }
  if (Date.parse(a.readyAt) < Date.parse(input.policy.asOf) ||
      Date.parse(a.expiresAt) <= Date.parse(a.readyAt) ||
      Date.parse(a.expiresAt) - Date.parse(a.readyAt) > 86400000 ||
      Date.parse(a.expiresAt) - Date.parse(candidate.sourceBinding.oldestCaptureAt) > a.maxAgeSeconds * 1000)
    throw new Error("sales_event_window_authority_outlives_evidence");
  const payload = { version: 1, projectRef: source.scope.projectRef, shop: source.scope.shop,
    runId, baseRunId, fromDate: source.scope.fromDate, throughDate: source.scope.throughDate,
    source, sourceDigest: source.digest, authority: a,
    reportPolicy: { ...source.businessPolicy, deferredOrders: candidate.deferredOrders,
      salesEventWindow: { version: 1, digest: source.digest } },
    fullPolicy: { ...candidate.buildInput.policy, ...(fresh ? { freshGoogleSpend: fresh } : {}) },
    spendRuns, evidence: candidate.buildInput.evidence, behavior: {},
    oldestCaptureAt: candidate.sourceBinding.oldestCaptureAt,
    latestCaptureAt: candidate.sourceBinding.latestCaptureAt };
  if (Buffer.byteLength(JSON.stringify(payload)) > 8000000) throw new Error("sales_event_window_registration_budget");
  return { state: "prepared_disabled" as const, enabled: false, registered: false, metricAcceptance: false,
    registration: { rpc: "lean_sales_event_window_register", args: { p_scope: payload } } };
}

/** Explicit owner-only path. The runtime role has no execute grant for this RPC.
 * Read-only preparation and the full-report worker never call it.
 */
export async function registerSalesEventWindow(options: {
  client: AnalyticsRpcClient; projectRef: string; databaseUrl: string;
  input: Parameters<typeof prepareSalesEventWindowRegistration>[0];
}) {
  validatePipelineTarget(options.projectRef, options.databaseUrl);
  if (options.input.source.scope.projectRef !== options.projectRef)
    throw new Error("sales_event_window_registration_target");
  const prepared = prepareSalesEventWindowRegistration(options.input);
  const result = await pipelineRpc(options.client, prepared.registration.rpc, prepared.registration.args);
  if (result !== options.input.runId) throw new Error("sales_event_window_registration_changed");
  return { runId: options.input.runId, state: "registered_disabled", enabled: false, published: false };
}
