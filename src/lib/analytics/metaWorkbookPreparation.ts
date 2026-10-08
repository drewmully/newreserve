import { prepareSalesEventWindowRegistration, prepareSalesEventWindowReport } from "./salesEventWindowPreparation";
import type { SalesEventWindowInput } from "./salesEventWindowInput";
import type { FullBuildPolicy } from "./fullReportBuild";
import { buildFullReports } from "./fullReportBuild";
import { canonicalEventCycleServerTime } from "./salesEventCyclePreparation";
import { admitNativeSpendWindow, type NativeSpendWindowInput, type NativeSpendWindowBinding,
  type StandingMarketingScope } from "./nativeSpendWindowInput";
import { metaHourlyPacketFromCaptures, type MetaGraphCapture, type MetaHourlySpendDay } from "./metaHourlySpendInput";
import { prepareMetaSpendRegistration } from "./multiProviderSpendRegistration";
import { prepareMultiProviderSpendBuild } from "./multiProviderSpendInput";
import { guardFreshGoogleSpendReports } from "./googleSpendReportInput";
import type { SpendDayControl } from "./googleSpendAcceptance";
import { normalizeSpendBase, type SpendBase } from "./spend";
import { evidenceDigest } from "./evidenceIntake";

/** A separate one-use owner contract, NOT a Google grant or B1 standing claim.
 * Real source hashes are database readbacks; compilation does not authenticate them.
 */
export type MetaWorkbookContract = {
  version: 1; contractId: string; revision: "1"; projectRef: string; shop: string;
  googleCycleId: string; googleCaptureSha256: string; metaPacketSha256: string;
  runId: string; baseRunId: string; date: string;
  notBefore: string; expiresAt: string; maxAgeSeconds: number;
  approvalRef: string; actorRef: string; controlApprovalRef: string;
};
export type MetaWorkbookGoogleEvidence = {
  cycleId: string; grantId: string; grantRevision: string; projectRef: string; shop: string;
  accountId: string; loginCustomerId: string; date: string; startedAt: string; validUntil: string;
  captureSha256: string;
  packet: {
    manifest: unknown; base: SpendBase; costControl: SpendDayControl; asOf: string;
    receipt: { accountMetadata: NativeSpendWindowInput["google"]["accountMetadata"] };
  };
};
export type MetaWorkbookSources = {
  contract: MetaWorkbookContract;
  google: MetaWorkbookGoogleEvidence;
  meta: {
    packet: MetaHourlySpendDay; packetSha256: string; enabled: false;
    freshnessCutoffAt: string;
    receipts: { metadata: MetaGraphCapture; accountHours: MetaGraphCapture; campaignHours: MetaGraphCapture };
  };
  standingScope: StandingMarketingScope;
  source: SalesEventWindowInput; policy: FullBuildPolicy;
};
const hash = (v: string) => /^[a-f0-9]{64}$/.test(v);
const ref = (v: string) => typeof v === "string" && v === v.trim() && v.length > 0 &&
  v.length <= 512 && !/[\u0000-\u001f]/.test(v);
const time = (s: string) => {
  const canonical = canonicalEventCycleServerTime(s);
  return BigInt(Date.parse(canonical)) * BigInt(1000) + BigInt(canonical.slice(23, 26));
};
const same = (a: unknown, b: unknown) => evidenceDigest(a) === evidenceDigest(b);
function requireScope(ok: unknown) { if (!ok) throw new Error("meta_workbook_scope"); }

/** Uses unchanged native receipts, P6 and B1 compilers. No provider/DB calls,
 * no grant mutation, no borrowed Google full asOf, and no implicit activation.
 */
export function prepareMetaWorkbook(input: MetaWorkbookSources) {
  const { contract: c, google: g, meta: m, standingScope, source, policy } = input;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  requireScope(c.version === 1 && c.revision === "1" && /^[A-Za-z0-9_-]{1,100}$/.test(c.contractId) &&
    c.projectRef === "xnfjdbpjuaezxjgargto" && c.shop === "mullybox-store.myshopify.com" &&
    uuid.test(c.googleCycleId) && c.runId === `meta_workbook_${c.googleCycleId}` &&
    c.baseRunId === `meta_workbook_base_${c.googleCycleId}` &&
    [c.approvalRef, c.actorRef, c.controlApprovalRef].every(ref) &&
    [c.googleCaptureSha256, c.metaPacketSha256].every(hash) &&
    Number.isInteger(c.maxAgeSeconds) && c.maxAgeSeconds >= 1 && c.maxAgeSeconds <= 3600);
  requireScope(g.cycleId === c.googleCycleId && g.projectRef === c.projectRef && g.shop === c.shop &&
    g.accountId === "4335795219" && g.loginCustomerId === "9552995078" &&
    g.date === c.date && g.captureSha256 === c.googleCaptureSha256 &&
    source.scope.projectRef === c.projectRef && source.scope.shop === c.shop &&
    source.scope.fromDate === c.date && source.scope.throughDate === c.date &&
    policy.behaviorMode === "excluded" && policy.project === "353503" &&
    !["googleDelivery", "nativeSpendWindow", "salesEventWindow", "customerGeneration", "sessionEntryPolicy"]
      .some(k => Object.hasOwn(policy, k)));
  const now = time(policy.asOf), start = time(c.notBefore), end = time(c.expiresAt);
  requireScope(time(g.startedAt) <= start && start <= now && now < end &&
    end <= time(g.validUntil) && end - start <= BigInt(3600000000) &&
    now >= time(g.packet.asOf) && time(m.freshnessCutoffAt) >= start);
  requireScope(m.enabled === false && m.packetSha256 === c.metaPacketSha256 &&
    m.packet.accountId === "act_2796962933960445" && m.packet.date === c.date &&
    m.packet.projectRef === c.projectRef && m.packet.shop === c.shop &&
    m.packet.approvalRef === c.approvalRef && m.packet.actorRef === c.actorRef &&
    m.packet.control.approvalRef === c.controlApprovalRef &&
    m.packet.generationId === `meta_workbook_${c.googleCycleId}`);
  const decoded = metaHourlyPacketFromCaptures({
    projectRef: c.projectRef, shop: c.shop, generationId: m.packet.generationId,
    accountId: m.packet.accountId, date: c.date, approvalRef: c.approvalRef,
    actorRef: c.actorRef, controlApprovalRef: c.controlApprovalRef,
    ...m.receipts, freshnessCutoffAt: m.freshnessCutoffAt, asOf: policy.asOf,
  });
  requireScope(same(decoded, m.packet));
  for (const captured of [g.packet.base.completedAt, g.packet.costControl.capturedAt,
    m.packet.source.capturedAt, m.packet.control.capturedAt])
    requireScope(end <= time(captured) + BigInt(c.maxAgeSeconds) * BigInt(1000000));
  prepareMetaSpendRegistration(m.packet, { freshnessCutoffAt: m.freshnessCutoffAt, asOf: policy.asOf });
  const inventory = {
    shop: c.shop, dates: [c.date],
    accounts: standingScope.accounts.map(a => ({ provider: a.provider, accountId: a.accountId })),
    complete: false, independentlyExtracted: false,
    evidenceRef: standingScope.approvalRef, approvalRef: standingScope.approvalRef,
    capturedAt: standingScope.declaredAt, salesScope: "unverified" as const, salesCoverageRef: null,
    customerScope: "unverified" as const, customerCoverageRef: null,
  };
  const fresh = { manifest: g.packet.manifest, controls: [g.packet.costControl], marketingInventory: inventory };
  const prepared = prepareSalesEventWindowReport({ source, policy, publication: `full:${c.runId}` });
  requireScope(time(prepared.sourceBinding.oldestCaptureAt) >= start);
  const registration = prepareSalesEventWindowRegistration({
    source, policy, runId: c.runId, baseRunId: c.baseRunId,
    authority: { approvalRef: c.approvalRef, actorRef: c.actorRef, readyAt: policy.asOf,
      expiresAt: c.expiresAt, maxAgeSeconds: c.maxAgeSeconds },
    freshGoogleSpend: fresh,
  });
  const binding: Omit<NativeSpendWindowBinding, "digest"> = {
    version: 1, cycleId: c.googleCycleId, grantId: c.contractId, grantRevision: c.revision,
    projectRef: c.projectRef, shop: c.shop, runId: c.runId, date: c.date,
    standingScopeDigest: evidenceDigest(standingScope),
    googleCaptureSha256: c.googleCaptureSha256, metaPacketSha256: c.metaPacketSha256,
  };
  const body: Omit<NativeSpendWindowInput, "digest"> = {
    version: 1, binding, cycleStartedAt: canonicalEventCycleServerTime(g.startedAt),
    validUntil: c.expiresAt, scopeDefinition: standingScope,
    google: { manifest: g.packet.manifest, base: g.packet.base, control: g.packet.costControl,
      accountMetadata: g.packet.receipt.accountMetadata },
    meta: { packet: m.packet, receipts: m.receipts, freshnessCutoffAt: m.freshnessCutoffAt },
  };
  const spend: NativeSpendWindowInput = { ...body, digest: evidenceDigest(body) };
  const spendBinding: NativeSpendWindowBinding = { ...binding, digest: spend.digest };
  const base = structuredClone(prepared.buildInput.base);
  base.marketing_spend_daily = normalizeSpendBase(g.packet.base, `full:${c.runId}`);
  const evidence = { ...prepared.buildInput.evidence, nativeSpendWindow: spend,
    dateCoverage: prepared.buildInput.evidence.dateCoverage.map(d => ({ ...d, gates: { ...d.gates, spend: true } })) };
  const combined = prepareMultiProviderSpendBuild({
    base, evidence, projectRef: c.projectRef, shop: c.shop, publication: `full:${c.runId}`,
    fromDate: c.date, throughDate: c.date, asOf: policy.asOf, nativeSpendWindowBinding: spendBinding,
    freshGoogleSpend: { ...fresh, bases: [g.packet.base] },
    combined: { version: 1, projectRef: c.projectRef, shop: c.shop, runId: c.runId, inventory, metaDays: [m.packet] },
  });
  admitNativeSpendWindow(spend, { binding: spendBinding, projectRef: c.projectRef, shop: c.shop,
    publication: `full:${c.runId}`, fromDate: c.date, throughDate: c.date, asOf: policy.asOf,
    facts: combined.base.marketing_spend_daily });
  const result = buildFullReports({ ...prepared.buildInput, base: combined.base, evidence: combined.evidence,
    policy: { ...prepared.buildInput.policy, nativeSpendWindow: spendBinding } });
  guardFreshGoogleSpendReports(result.reports, combined.storeRatioAdmission);
  return {
    state: "prepared_disabled" as const, registered: false, enabled: false, sourceReads: 0,
    certified: false, googleGrantChanged: false, standingClaimed: false,
    result, nativeSpendWindow: spend, sourceBinding: prepared.sourceBinding,
    registration: { rpc: "lean_meta_workbook_stage", args: {
      p_contract: structuredClone(c), p_scope: registration.registration.args.p_scope, p_spend: spend,
    } },
  };
}
