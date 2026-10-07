import { bindSalesEventWindow, prepareSalesEventWindowReport, prepareSalesEventWindowRegistration } from "./salesEventWindowPreparation";
import { admitNativeSpendWindow, type NativeSpendWindowInput, type NativeSpendWindowBinding,
  type StandingMarketingScope } from "./nativeSpendWindowInput";
import { prepareMultiProviderSpendBuild } from "./multiProviderSpendInput";
import { normalizeSpendBase, type SpendBase } from "./spend";
import type { SpendDayControl } from "./googleSpendAcceptance";
import type { FullBuildPolicy } from "./fullReportBuild";
import { buildFullReports } from "./fullReportBuild";
import { guardFreshGoogleSpendReports } from "./googleSpendReportInput";
import type { MetaHourlySpendDay, MetaGraphCapture } from "./metaHourlySpendInput";
import type { SalesEventWindowInput } from "./salesEventWindowInput";
import { evidenceDigest } from "./evidenceIntake";
import { pipelineRpc, validatePipelineTarget } from "./shopifyPipeline";
import type { AnalyticsRpcClient } from "./rpcStore";
import { nyDate } from "./primitives";

// PostgreSQL jsonb renders this server-owned timestamptz in the connection zone.
// Convert the whole-second offset separately from its six-digit fraction. Raw
// getter evidence remains in the retained claim, never rounded or overwritten.
export function canonicalEventCycleServerTime(value: string) {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!m) throw new Error("invalid_event_cycle_server_time");
  const seconds = Date.parse(`${m[1]}Z`);
  if (!Number.isFinite(seconds) || new Date(seconds).toISOString().slice(0, 19) !== m[1] ||
      m[3] !== "Z" && (Number(m[5]) > 23 || Number(m[6]) > 59)) throw new Error("invalid_event_cycle_server_time");
  const offset = m[3] === "Z" ? 0 : (Number(m[5]) * 60 + Number(m[6])) * (m[4] === "+" ? 1 : -1);
  const canonical = `${new Date(seconds - offset * 60000).toISOString().slice(0, 19)}.${(m[2] ?? "").padEnd(6, "0")}Z`;
  nyDate(canonical);
  return canonical;
}

/** Read only from the restricted server claim, not a caller-selected account. */
export type SalesEventCycleClaim = {
  state: "capture"; cycleId: string; grantId: string; grantRevision: string;
  projectRef: string; shop: string; reportDate: string; runId: string; baseRunId: string;
  slotOrdinal: number; slotNotBeforeUTC: string;
  startedAt: string; deadline: string; validUntil: string; authorizationRef: string;
  approvalRef: string; actorRef: string; maxAgeSeconds: number;
  policy: Omit<FullBuildPolicy, "asOf">; businessPolicy: SalesEventWindowInput["businessPolicy"];
  standingScope: StandingMarketingScope; google: {
    cycleId: string; startedAt: string; validUntil: string; captureSha256: string;
    slotOrdinal: number; slotNotBeforeUTC: string;
    packet: { manifest: unknown; base: SpendBase; costControl: SpendDayControl; asOf: string;
      receipt: { accountMetadata: NativeSpendWindowInput["google"]["accountMetadata"] } };
    metaPacket: MetaHourlySpendDay; metaPacketSha256: string;
    metaReceipts: { metadata: MetaGraphCapture; accountHours: MetaGraphCapture; campaignHours: MetaGraphCapture };
    metaBinding: { freshnessCutoffAt: string };
  };
};

/** All authority fields below come from a finite disabled-by-default grant.
 * Pure compilation is not a registration, renewal or publication.
 */
export function prepareSalesEventCycle(input: {
  claim: SalesEventCycleClaim; source: SalesEventWindowInput; asOf: string;
}) {
  const c = input.claim, source = input.source, g = c.google;
  if (c.state !== "capture" || c.cycleId !== g.cycleId || c.runId !== `event_auto_${c.cycleId}` ||
      !Number.isInteger(c.slotOrdinal) || c.slotOrdinal < 1 || c.slotOrdinal > 1000 || c.slotOrdinal !== g.slotOrdinal ||
      !Number.isFinite(Date.parse(c.slotNotBeforeUTC)) || c.slotNotBeforeUTC !== g.slotNotBeforeUTC ||
      Date.parse(c.slotNotBeforeUTC) > Date.parse(c.startedAt) ||
      c.baseRunId !== `event_auto_base_${c.cycleId}` || source.scope.projectRef !== c.projectRef ||
      source.scope.shop !== c.shop || source.scope.fromDate !== c.reportDate || source.scope.throughDate !== c.reportDate ||
      evidenceDigest(source.businessPolicy) !== evidenceDigest(c.businessPolicy) ||
      Date.parse(input.asOf) < Date.parse(c.startedAt) || Date.parse(input.asOf) >= Date.parse(c.deadline) ||
      Date.parse(c.validUntil) > Date.parse(g.validUntil) ||
      Date.parse(input.asOf) < Date.parse(g.packet.asOf)) throw new Error("sales_event_cycle_scope");
  const policy = { ...c.policy, asOf: input.asOf };
  const prepared = prepareSalesEventWindowReport({ source, policy, publication: `full:${c.runId}` });
  if (Date.parse(prepared.sourceBinding.oldestCaptureAt) < Date.parse(c.startedAt) ||
      typeof prepared.sourceBinding.composedDailyCustomers[c.reportDate] !== "number")
    throw new Error("sales_event_cycle_source_or_customer_incomplete");
  // This legacy-shaped field remains explicitly unverified. The new scoped
  // branch binds the standing declaration and fresh identity separately.
  const inventory = { shop: c.shop, dates: [c.reportDate],
    accounts: c.standingScope.accounts.map(a => ({ provider: a.provider, accountId: a.accountId })),
    complete: false, independentlyExtracted: false, evidenceRef: c.standingScope.approvalRef,
    approvalRef: c.standingScope.approvalRef, capturedAt: c.standingScope.declaredAt,
    salesScope: "unverified" as const, salesCoverageRef: null,
    customerScope: "unverified" as const, customerCoverageRef: null };
  const fresh = { manifest: g.packet.manifest, controls: [g.packet.costControl], marketingInventory: inventory };
  const registration = prepareSalesEventWindowRegistration({ source, policy,
    runId: c.runId, baseRunId: c.baseRunId, authority: { approvalRef: c.approvalRef, actorRef: c.actorRef,
      readyAt: input.asOf, expiresAt: c.validUntil, maxAgeSeconds: c.maxAgeSeconds }, freshGoogleSpend: fresh });
  const binding: Omit<NativeSpendWindowBinding, "digest"> = { version: 1, cycleId: c.cycleId,
    grantId: c.grantId, grantRevision: c.grantRevision, projectRef: c.projectRef, shop: c.shop,
    runId: c.runId, date: c.reportDate, standingScopeDigest: evidenceDigest(c.standingScope),
    googleCaptureSha256: g.captureSha256, metaPacketSha256: g.metaPacketSha256 };
  const body: Omit<NativeSpendWindowInput, "digest"> = { version: 1, binding,
    cycleStartedAt: canonicalEventCycleServerTime(g.startedAt), validUntil: c.validUntil, scopeDefinition: c.standingScope,
    google: { manifest: g.packet.manifest, base: g.packet.base, control: g.packet.costControl,
      accountMetadata: g.packet.receipt.accountMetadata },
    meta: { packet: g.metaPacket, receipts: g.metaReceipts, freshnessCutoffAt: g.metaBinding.freshnessCutoffAt } };
  const spend: NativeSpendWindowInput = { ...body, digest: evidenceDigest(body) };
  const spendBinding: NativeSpendWindowBinding = { ...binding, digest: spend.digest };
  const base = structuredClone(prepared.buildInput.base);
  base.marketing_spend_daily = normalizeSpendBase(g.packet.base, `full:${c.runId}`);
  const evidence = { ...prepared.buildInput.evidence, nativeSpendWindow: spend,
    dateCoverage: prepared.buildInput.evidence.dateCoverage.map(d => ({ ...d, gates: { ...d.gates, spend: true } })) };
  const combined = prepareMultiProviderSpendBuild({ base, evidence, projectRef: c.projectRef,
    shop: c.shop, publication: `full:${c.runId}`, fromDate: c.reportDate, throughDate: c.reportDate, asOf: input.asOf,
    nativeSpendWindowBinding: spendBinding, freshGoogleSpend: { ...fresh, bases: [g.packet.base] },
    combined: { version: 1, projectRef: c.projectRef, shop: c.shop, runId: c.runId, inventory, metaDays: [g.metaPacket] } });
  admitNativeSpendWindow(spend, { binding: spendBinding, projectRef: c.projectRef, shop: c.shop,
    publication: `full:${c.runId}`, fromDate: c.reportDate, throughDate: c.reportDate, asOf: input.asOf,
    facts: combined.base.marketing_spend_daily });
  const result = buildFullReports({ ...prepared.buildInput, base: combined.base, evidence: combined.evidence,
    policy: { ...prepared.buildInput.policy, nativeSpendWindow: spendBinding } });
  guardFreshGoogleSpendReports(result.reports, combined.storeRatioAdmission);
  return { state: "prepared_disabled" as const, registered: false, enabled: false, sourceReads: 0,
    certified: false, result, sourceBinding: prepared.sourceBinding, nativeSpendWindow: spend,
    registration: { rpc: "lean_sales_event_cycle_stage", args: { p_cycle: c.cycleId,
      p_scope: registration.registration.args.p_scope, p_spend: spend } } };
}

/** This restricted call never enables. An ambiguous commit is not retried. */
export async function stageSalesEventCycle(options: {
  client: AnalyticsRpcClient; projectRef: string; databaseUrl: string;
  input: Parameters<typeof prepareSalesEventCycle>[0];
}) {
  validatePipelineTarget(options.projectRef, options.databaseUrl);
  if (options.input.claim.projectRef !== options.projectRef) throw new Error("sales_event_cycle_project");
  const prepared = prepareSalesEventCycle(options.input);
  const state = await pipelineRpc(options.client, prepared.registration.rpc, prepared.registration.args);
  if (state !== options.input.claim.runId) throw new Error("sales_event_cycle_stage_changed");
  return { runId: state, state: "staged_disabled", enabled: false, published: false };
}

/** Attach a separately acquired fresh customer packet without changing sources. */
export function withCycleCustomers(source: SalesEventWindowInput, customers: NonNullable<SalesEventWindowInput["customers"]>) {
  const { digest, ...body } = source;
  if (evidenceDigest(body) !== digest || source.customers) throw new Error("sales_event_cycle_source_changed");
  return bindSalesEventWindow({ ...body, customers });
}
