import { canonicalJson, evidenceDigest } from "./evidenceIntake";
import { reportDates } from "./commerceCandidate";
import { normalizeIdentity } from "./identity";
import { key, nyDate } from "./primitives";
import { shopifyId, shopifyShop } from "./shopifySource";
import type { FullBuildPolicy } from "./fullReportBuild";
import type { CustomerGenerationBinding, HistoryCustomerInput } from "./historyCustomerSource";

type Evidence = HistoryCustomerInput["evidence"];
export type CustomerHistoryScope = Pick<HistoryCustomerInput,
  "projectRef" | "shop" | "asOf" | "expiresAt" | "sourceOrigin" | "completeThrough" |
  "mappingVersion" | "policy" | "reporting"> & {
  sourceScopeHash: string; sourceCompletionHash: string; approvalRef: string; inventoryRef: string;
  migrationEvidenceRef: string; permissionEvidenceRef: string; permissionValidUntil: string;
  maxSourceAgeSeconds: number; authorityId: string; authorityScopeRef: string;
  authorityRevision: string; authorityFingerprint: string;
};
export type CustomerHistoryRegistration = {
  runId: string; sourceRun: string; scope: CustomerHistoryScope;
  members: { memberId: string; customerId: string | null; evidence: Evidence }[];
  inventory: { memberId: string; orderId: string; updatedAt: string; sourceHash: string;
    decision: HistoryCustomerInput["orders"][number]["decision"] }[];
};
export type CustomerAuthorityReceipt = HistoryCustomerInput["authority"] & {
  projectRef: string; shop: string; available: boolean;
};
/** Read from the owner-only completed-binding function, never assembled from profiles. */
export type CompletedCustomerReceipt = {
  state: "complete"; runId: string; projectRef: string; shop: string;
  sourceRun: string; sourceCompletionHash: string; generationHash: string; resultHash: string;
  mappingVersion: string; asOf: string; expiresAt: string;
  reporting: Omit<HistoryCustomerInput["reporting"], "cohortCoverage">; authority: CustomerAuthorityReceipt;
};
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v);
const text = (v: unknown) => typeof v === "string" && !!v.trim() && v.length <= 512 &&
  v === v.trim() && !/[\u0000-\u001f]/.test(v);
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function exact(value: object, keys: string[]) {
  if (!equal(Object.keys(value).sort(), keys.sort())) throw new Error("customer_preparation_fields");
}
function instant(value: string): bigint {
  nyDate(value);
  const fraction = (value.match(/\.(\d+)Z$/)?.[1] ?? "").padEnd(6, "0");
  return BigInt(Date.parse(value)) * BigInt(1000) + BigInt(fraction.slice(3));
}
function currentAuthority(a: CustomerAuthorityReceipt, now: string, target: { projectRef: string; shop: string }) {
  if (!a || a.available !== true || a.projectRef !== target.projectRef || a.shop !== target.shop ||
    ![a.authorityId, a.sourceId, a.schemaVersion, a.scopeRef, a.evidenceRef].every(text) ||
    typeof a.revision !== "string" || !/^[1-9]\d{0,18}$/.test(a.revision) ||
    BigInt(a.revision) > BigInt("9223372036854775807") ||
    !hash(a.fingerprint) || !Number.isSafeInteger(a.maxAgeSeconds) || a.maxAgeSeconds < 1 || a.maxAgeSeconds > 300)
    throw new Error("customer_preparation_authority");
  const at = instant(now), captured = instant(a.capturedAt), until = instant(a.validUntil);
  if (captured > at || at - captured > BigInt(a.maxAgeSeconds) * BigInt(1000000) || until <= at || until <= captured)
    throw new Error("customer_preparation_authority");
}

/** Offline shape/coverage preflight only. SQL rechecks the actual stored authority,
 * complete 040/041 source and fingerprints atomically. This never grants permission,
 * writes an authority receipt, calculates a generation/result hash or enables a run.
 */
export function prepareCustomerHistoryRegistration(input: CustomerHistoryRegistration,
  source: { state: "complete"; projectRef: string; shop: string; sourceRun: string;
    includeCustomerId: true; sourceScopeHash: string; sourceCompletionHash: string;
    orderCount: number; untilTime: string },
  authority: CustomerAuthorityReceipt, now: string) {
  const s = input.scope;
  exact(input, ["runId", "sourceRun", "scope", "members", "inventory"]);
  exact(s, ["projectRef", "shop", "asOf", "expiresAt", "sourceOrigin", "completeThrough", "mappingVersion",
    "policy", "reporting", "sourceScopeHash", "sourceCompletionHash", "approvalRef", "inventoryRef",
    "migrationEvidenceRef", "permissionEvidenceRef", "permissionValidUntil", "maxSourceAgeSeconds",
    "authorityId", "authorityScopeRef", "authorityRevision", "authorityFingerprint"]);
  shopifyShop(s.shop); currentAuthority(authority, now, s);
  const dates = reportDates(s.reporting.fromDate, s.reporting.throughDate);
  if (!id(input.runId) || !id(input.sourceRun) || !/^[a-z]{20}$/.test(s.projectRef) ||
    ![s.mappingVersion, s.approvalRef, s.inventoryRef, s.migrationEvidenceRef, s.permissionEvidenceRef,
      s.reporting.definition].every(text) || dates.length > 31 ||
    !hash(s.sourceScopeHash) || !hash(s.sourceCompletionHash) ||
    source.state !== "complete" || source.includeCustomerId !== true || source.projectRef !== s.projectRef ||
    source.shop !== s.shop || source.sourceRun !== input.sourceRun ||
    source.sourceScopeHash !== s.sourceScopeHash || source.sourceCompletionHash !== s.sourceCompletionHash ||
    !Number.isSafeInteger(source.orderCount) || source.orderCount < 1 || source.orderCount > 70000)
    throw new Error("customer_preparation_source");
  if (s.authorityId !== authority.authorityId || s.authorityScopeRef !== authority.scopeRef ||
    s.authorityRevision !== authority.revision || s.authorityFingerprint !== authority.fingerprint ||
    instant(s.permissionValidUntil) > instant(authority.validUntil) ||
    instant(s.expiresAt) > instant(s.permissionValidUntil) || instant(s.expiresAt) <= instant(now) ||
    instant(s.asOf) > instant(now) || instant(s.sourceOrigin) >= instant(s.completeThrough) ||
    instant(s.completeThrough) > instant(s.asOf) || instant(s.completeThrough) > instant(source.untilTime) ||
    !Number.isSafeInteger(s.maxSourceAgeSeconds) || s.maxSourceAgeSeconds < 1 || s.maxSourceAgeSeconds > 604800 ||
    instant(s.expiresAt) - instant(s.asOf) > BigInt(s.maxSourceAgeSeconds) * BigInt(1000000))
    throw new Error("customer_preparation_clock");
  if (!Array.isArray(input.members) || !input.members.length || input.members.length > 70000 ||
    !Array.isArray(input.inventory) || input.inventory.length !== source.orderCount ||
    Buffer.byteLength(canonicalJson(input)) > 268435456)
    throw new Error("customer_preparation_budget");
  const members = new Map<string, CustomerHistoryRegistration["members"][number]>(), customers = new Set<string>();
  let identities = 0;
  for (const member of input.members) {
    exact(member, ["memberId", "customerId", "evidence"]);
    const e = member.evidence, c = member.customerId;
    exact(e, ["ref", "identity", "currentlyPermitted", "removedCustomers", "customerHistory",
      "orderIdentities", "proofs", "externalControls", "cohortCoverage"]);
    if (!text(member.memberId) || member.memberId.length > 128 || members.has(member.memberId) ||
      !text(e.ref) || !Array.isArray(e.identity) || Buffer.byteLength(canonicalJson(e)) > 5000000)
      throw new Error("customer_preparation_member");
    if (c !== null) {
      if (!/^[A-Za-z0-9_:-]{8,128}$/.test(c) || /^\d+$/.test(c) || customers.has(c) ||
        !equal(e.currentlyPermitted, [c]) || e.removedCustomers.length ||
        !equal(Object.keys(e.customerHistory), [c])) throw new Error("customer_preparation_member");
      const h = e.customerHistory[c];
      if (!equal(h.expectedSources, ["shopify"]) || !equal(h.completeSources, ["shopify"]) ||
        h.migrationsReconciled !== true || !text(h.approvalRef) || h.completeThrough !== s.completeThrough)
        throw new Error("customer_preparation_history");
      customers.add(c);
    } else if (e.identity.length || e.currentlyPermitted.length || e.removedCustomers.length ||
      Object.keys(e.customerHistory).length || e.orderIdentities.length)
      throw new Error("customer_preparation_guest");
    for (const identity of e.identity) {
      normalizeIdentity(identity, "preparation");
      if (identity.customerId !== c || identity.mappingVersion !== s.mappingVersion)
        throw new Error("customer_preparation_identity");
    }
    if (!Array.isArray(e.orderIdentities) ||
      new Set(e.orderIdentities.map(link => link.orderId)).size !== e.orderIdentities.length ||
      e.orderIdentities.some(link => link.namespace !== "shopify_customer" || !/^[1-9]\d*$/.test(link.identifier) ||
        !text(link.evidenceRef)) || !e.externalControls.temporal_identity_intervals?.passed ||
      !text(e.externalControls.temporal_identity_intervals.evidenceRef) ||
      ["orders", "order_items", "customers", "identity_map"].some(table => {
        const proofs = e.proofs.filter(proof => proof.table === table);
        return proofs.length !== 1 || !proofs[0].complete || !proofs[0].independentlyExtracted || !text(proofs[0].evidenceRef);
      })) throw new Error("customer_preparation_independent_evidence");
    identities += e.identity.length;
    members.set(member.memberId, member);
  }
  if (identities > 100000) throw new Error("customer_preparation_budget");
  const orders = new Set<string>(), counts = new Map<string, number>(), memberKeys = new Map<string, string[]>();
  for (const row of input.inventory) {
    exact(row, ["memberId", "orderId", "updatedAt", "sourceHash", "decision"]);
    if (!members.has(row.memberId) || orders.has(row.orderId) ||
      !/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(row.orderId) || !hash(row.sourceHash) ||
      !["eligible", "excluded_test", "excluded_cancelled"].includes(row.decision.eligibility) ||
      !text(row.decision.approvalRef) ||
      instant(row.updatedAt) > instant(s.asOf)) throw new Error("customer_preparation_inventory");
    orders.add(row.orderId); counts.set(row.memberId, (counts.get(row.memberId) ?? 0) + 1);
    const keys = memberKeys.get(row.memberId) ?? [];
    keys.push(key(s.shop, shopifyId(row.orderId, "Order"))); memberKeys.set(row.memberId, keys);
  }
  for (const [memberId, member] of members) {
    const n = counts.get(memberId) ?? 0;
    if (n < 1 || n > 100 || member.customerId === null && n !== 1)
      throw new Error("customer_preparation_complete_member_bound");
    if (member.customerId !== null) {
      const expected = memberKeys.get(memberId)!.sort();
      if (!equal(member.evidence.orderIdentities.map(link => link.orderId).sort(), expected))
        throw new Error("customer_preparation_order_links");
    }
  }
  return { state: "prepared" as const, registered: false as const, enabled: false as const,
    generationHash: null, resultHash: null, preparationDigest: evidenceDigest(input),
    registration: { rpc: "lean_history_customer_register" as const, args: {
      p_run: input.runId, p_source_run: input.sourceRun, p_scope: structuredClone(s),
      p_members: structuredClone(input.members), p_inventory: structuredClone(input.inventory),
    } } };
}

/** Select one exact completed registered generation for this full-build policy.
 * Future windows remain independent. No newest-run fallback, unfinished hash,
 * evidence.customerGeneration construction, source read, looped execution or I/O.
 */
export function selectCompletedCustomerBinding(input: {
  registeredRunIds: string[]; receipts: CompletedCustomerReceipt[];
  projectRef: string; shop: string; fromDate: string; throughDate: string;
  policy: FullBuildPolicy; now: string;
}): CustomerGenerationBinding {
  shopifyShop(input.shop); instant(input.now); instant(input.policy.asOf);
  if (!/^[a-z]{20}$/.test(input.projectRef) || reportDates(input.fromDate, input.throughDate).length > 31)
    throw new Error("customer_binding_target");
  if (!input.registeredRunIds.length || input.registeredRunIds.length > 31 ||
    input.registeredRunIds.some(r => !id(r)) || new Set(input.registeredRunIds).size !== input.registeredRunIds.length ||
    input.receipts.length > 31 || new Set(input.receipts.map(r => r.runId)).size !== input.receipts.length ||
    input.receipts.some(r => !input.registeredRunIds.includes(r.runId)))
    throw new Error("customer_binding_registration");
  const matches = input.receipts.filter(r => r.projectRef === input.projectRef && r.shop === input.shop &&
    r.reporting.fromDate === input.fromDate && r.reporting.throughDate === input.throughDate &&
    r.reporting.definition === input.policy.definition && r.mappingVersion === input.policy.mappingVersion &&
    r.asOf === input.policy.asOf && equal(r.reporting.cohorts, input.policy.cohorts));
  if (matches.length !== 1) throw new Error("customer_binding_selection");
  const r = matches[0];
  if (r.state !== "complete" || !id(r.sourceRun) ||
    ![r.sourceCompletionHash, r.generationHash, r.resultHash].every(hash) ||
    instant(r.expiresAt) <= instant(input.now) || instant(r.asOf) > instant(input.now))
    throw new Error("customer_binding_unfinished_or_expired");
  currentAuthority(r.authority, input.now, input);
  if (instant(r.expiresAt) > instant(r.authority.validUntil))
    throw new Error("customer_binding_authority_expiry");
  const binding = { runId: r.runId, generationHash: r.generationHash, resultHash: r.resultHash,
    authorityId: r.authority.authorityId, authorityRevision: r.authority.revision,
    authorityFingerprint: r.authority.fingerprint };
  if (input.policy.customerGeneration && !equal(input.policy.customerGeneration, binding))
    throw new Error("customer_binding_conflict");
  return binding;
}
