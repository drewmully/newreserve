import { prepareFreshGoogleSpend } from "./googleSpendRegistration";
import { validateGoogleDeliveryBinding, type GoogleDeliveryBinding } from "./googleDeliveryReport";
import type { FullBuildEvidence, FullBuildPolicy } from "./fullReportBuild";
import type { FreshGoogleSpendReportInput } from "./googleSpendReportInput";
import { nyDate } from "./primitives";

export type GoogleWorkbookRegistration = {
  version: 1; projectRef: string; shop: string; runId: string; baseRunId: string;
  historyRuns: string[]; reportPolicy: Record<string, unknown>;
  fullPolicy: FullBuildPolicy; evidence: FullBuildEvidence; behavior: Record<string, unknown>;
  freshGoogleSpend: Omit<FreshGoogleSpendReportInput, "bases">;
  googleDelivery: GoogleDeliveryBinding; approvalRef: string; actorRef: string;
};
const ref = (s: unknown): s is string => typeof s === "string" && s === s.trim() &&
  s.length > 0 && s.length <= 512 && !/[\u0000-\u001f]/.test(s);
const object = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);

/** Owner preparation only. SQL checks real retained history; nothing is
 * enabled, registered, read, certified, selected or delivered by this function.
 */
export function prepareGoogleWorkbookRegistration(value: GoogleWorkbookRegistration) {
  const p = structuredClone(value);
  if (!object(p) || Object.keys(p).sort().join(",") !== ["version", "projectRef", "shop", "runId",
    "baseRunId", "historyRuns", "reportPolicy", "fullPolicy", "evidence", "behavior",
    "freshGoogleSpend", "googleDelivery", "approvalRef", "actorRef"].sort().join(",") ||
    p.version !== 1 || !/^[a-z]{20}$/.test(p.projectRef) ||
    !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(p.shop) ||
    ![p.runId, p.baseRunId].every(s => typeof s === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(s)) ||
    p.runId === p.baseRunId || !ref(p.approvalRef) || !ref(p.actorRef) ||
    !Array.isArray(p.historyRuns) || p.historyRuns.length < 1 || p.historyRuns.length > 5 ||
    new Set(p.historyRuns).size !== p.historyRuns.length ||
    !p.historyRuns.every(s => ref(s) && s.length <= 128) ||
    ![p.reportPolicy, p.fullPolicy, p.evidence, p.behavior, p.freshGoogleSpend].every(object))
    throw new Error("google_workbook_registration");
  if (Object.keys(p.freshGoogleSpend).sort().join(",") !== ["manifest", "controls", "marketingInventory"].sort().join(",") ||
    Object.hasOwn(p.evidence, "customerGeneration") || Object.hasOwn(p.fullPolicy, "googleDelivery") ||
    Object.hasOwn(p.fullPolicy, "freshGoogleSpend")) throw new Error("google_workbook_derived_input");
  const prepared = prepareFreshGoogleSpend(p.freshGoogleSpend.manifest), m = prepared.manifest;
  const delivery = validateGoogleDeliveryBinding(p.googleDelivery);
  if (m.projectRef !== p.projectRef || m.days.length !== 1 || m.sourceCurrency !== "USD" ||
    m.sourceTimezone !== "America/New_York" || delivery.accountId !== m.accountId ||
    delivery.date !== m.days[0].date || !Array.isArray(p.freshGoogleSpend.controls) ||
    p.freshGoogleSpend.controls.length !== 1 || p.freshGoogleSpend.controls[0].accountId !== m.accountId ||
    p.freshGoogleSpend.controls[0].date !== delivery.date ||
    p.freshGoogleSpend.marketingInventory.shop !== p.shop ||
    JSON.stringify(p.freshGoogleSpend.marketingInventory.dates) !== JSON.stringify([delivery.date]))
    throw new Error("google_workbook_one_day_scope");
  nyDate(p.fullPolicy.asOf);
  if (Date.parse(p.fullPolicy.asOf) < Date.parse(m.days[0].dueAt) ||
    Date.parse(p.fullPolicy.asOf) >= Date.parse(m.expiresAt) || !ref(p.fullPolicy.approvalRef))
    throw new Error("google_workbook_as_of");
  if (p.fullPolicy.customerGeneration !== undefined) {
    const c = p.fullPolicy.customerGeneration;
    if (!object(c) || Object.keys(c).sort().join(",") !== ["runId", "generationHash", "resultHash",
      "authorityId", "authorityRevision", "authorityFingerprint"].sort().join(",") ||
      !Object.values(c).every(ref)) throw new Error("google_workbook_customer_binding");
    // P4's completed-binding helper and the CURRENT SQL wrapper establish
    // completion/current authority. This compiler never supplies that evidence.
  }
  const scope = { version: 1, projectRef: p.projectRef, shop: p.shop,
    runId: p.runId, baseRunId: p.baseRunId, historyRuns: p.historyRuns, reportPolicy: p.reportPolicy,
    fromDate: delivery.date, throughDate: delivery.date, spendRegistration: prepared.registration.args.p_scope,
    fullPolicy: { ...p.fullPolicy, freshGoogleSpend: p.freshGoogleSpend, googleDelivery: delivery },
    evidence: p.evidence, behavior: p.behavior, approvalRef: p.approvalRef, actorRef: p.actorRef };
  if (Buffer.byteLength(JSON.stringify(scope)) > 5000000) throw new Error("google_workbook_registration_budget");
  return { state: "prepared" as const, enabled: false, registered: false, sourceAuthorityVerified: false,
    metricAcceptance: false, registration: { rpc: "lean_google_workbook_register", args: { p_scope: scope } },
    runId: p.runId, baseRunId: p.baseRunId, spendRunId: prepared.registration.args.p_scope.days[0].runId };
}
