import { createHash } from "node:crypto";
import type { FullBuildEvidence } from "./fullReportBuild";
import { normalizeIdentity } from "./identity";
import { normalizePayment } from "./financial";
import { nyDate } from "./primitives";
import { shopifyShop } from "./shopifySource";

export const evidenceSections = [
  "identity", "currentlyPermitted", "removedCustomers", "customerHistory", "orderIdentities",
  "checkout", "campaigns", "sessionCoverage", "attributionCoverage", "replacements",
  "settlements", "offers", "proofs", "externalControls", "dateCoverage", "comparisons", "cohortCoverage",
] as const;
export type EvidenceSection = typeof evidenceSections[number];
export type EvidenceScope = { projectRef: string; shop: string; fromDate: string; throughDate: string };
/** A source binding is reviewed configuration, not a caller-selected URL/table.
 * The connector/export feeding it must be independently verified in deployment.
 */
export type EvidenceBinding = {
  sourceId: string; sections: EvidenceSection[]; schemaVersion: string;
  approvalRef: string; maxAgeSeconds: number; independentControlSource: boolean;
};
export type EvidencePacket<K extends EvidenceSection = EvidenceSection> = {
  section: K; sourceId: string; sourceRecordRef: string; schemaVersion: string;
  scope: EvidenceScope; capturedAt: string; sha256: string; payload: FullBuildEvidence[K];
};
/** Object-key ordering must not create a new revision; array order remains meaningful. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  throw new Error("non_json_evidence");
}
export function evidenceDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 512;
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function assertRows(value: unknown): asserts value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 10000 || value.some(v => !object(v)))
    throw new Error("invalid_evidence_rows");
}
function assertRef(row: Record<string, unknown>) {
  if (!text(row.evidenceRef)) throw new Error("missing_evidence_lineage");
}
/** Shape/provenance validation is not a claim that a source is accurate. Full
 * graph, monetary and reconciliation validation still happens in the builder.
 */
function validatePayload(section: EvidenceSection, payload: unknown) {
  if (["currentlyPermitted", "removedCustomers", "comparisons"].includes(section)) {
    if (!Array.isArray(payload) || payload.length > 10000 || payload.some(v => !text(v)) ||
        new Set(payload).size !== payload.length) throw new Error("invalid_evidence_identifiers");
    return;
  }
  if (section === "customerHistory") {
    if (!object(payload)) throw new Error("invalid_history_evidence");
    for (const [id, e] of Object.entries(payload)) {
      if (!text(id) || !object(e) || !Array.isArray(e.expectedSources) || !Array.isArray(e.completeSources) ||
          [...e.expectedSources, ...e.completeSources].some(s => !text(s)) ||
          typeof e.migrationsReconciled !== "boolean" ||
          !(e.approvalRef === null || text(e.approvalRef))) throw new Error("invalid_history_evidence");
    }
    return;
  }
  if (section === "sessionCoverage") {
    if (!object(payload) || typeof payload.behaviorComplete !== "boolean" ||
        !text(payload.approvalRef) || !Number.isSafeInteger(payload.graceSeconds) ||
        Number(payload.graceSeconds) < 0) throw new Error("invalid_session_evidence");
    nyDate(String(payload.completeThrough));
    return;
  }
  if (section === "externalControls") {
    if (!object(payload)) throw new Error("invalid_control_evidence");
    for (const value of Object.values(payload)) {
      if (!object(value) || typeof value.passed !== "boolean") throw new Error("invalid_control_evidence");
      assertRef(value);
    }
    return;
  }
  assertRows(payload);
  for (const row of payload) {
    if (section === "campaigns") {
      if (!text(row.sessionKey) || !object(row.context)) throw new Error("invalid_campaign_evidence");
      assertRef(row.context);
    } else if (section !== "settlements") assertRef(row);
    if (section === "identity") normalizeIdentity(row as FullBuildEvidence["identity"][number], "intake");
    if (section === "settlements") {
      const p = row as FullBuildEvidence["settlements"][number];
      normalizePayment(p, "intake");
      if (!p.settledAt || !text(p.settlementEvidenceRef)) throw new Error("missing_settlement_authority");
    }
    if (section === "proofs") {
      if (row.independentlyExtracted !== true || typeof row.complete !== "boolean" ||
          !Array.isArray(row.expectedKeys) || !Array.isArray(row.keyFields) || !Array.isArray(row.amountChecks))
        throw new Error("invalid_independent_proof");
    }
    if (section === "dateCoverage") {
      if (!object(row.gates) || Object.values(row.gates).some(v => typeof v !== "boolean"))
        throw new Error("invalid_date_coverage");
    }
    if (section === "attributionCoverage") {
      if (!object(row.coverage) || ["lookbackComplete", "identityComplete", "graceComplete"]
        .some(k => typeof (row.coverage as Record<string, unknown>)[k] !== "boolean"))
        throw new Error("invalid_attribution_coverage");
    }
  }
}
type EvidenceIntake = {
  scope: EvidenceScope; asOf: string; bindings: EvidenceBinding[]; packets: EvidencePacket[];
};
/** Preflight only: validate every retained section before spending a source-read
 * budget. The collector may replace facts it actually reads, never controls,
 * identity, permission or history. This does not produce buildable evidence. */
export function validateRetainedEvidence(input: EvidenceIntake, replaced: ("orderIdentities" | "checkout")[]) {
  if (replaced.some(s => !["orderIdentities", "checkout"].includes(s)))
    throw new Error("unsupported_collected_section");
  inspectEvidence({ ...input, packets: input.packets.filter(p => !replaced.includes(p.section as typeof replaced[number])) },
    evidenceSections.filter(s => !replaced.includes(s as typeof replaced[number])));
}
export function assembleEvidence(input: EvidenceIntake): {
  evidence: FullBuildEvidence; lineage: Omit<EvidencePacket, "payload">[]; digest: string;
} {
  return inspectEvidence(input, evidenceSections);
}
function inspectEvidence(input: EvidenceIntake, required: readonly EvidenceSection[]) {
  shopifyShop(input.scope.shop); nyDate(input.asOf);
  if (!/^[a-z]{20}$/.test(input.scope.projectRef) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.scope.fromDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.scope.throughDate) ||
      input.scope.fromDate > input.scope.throughDate) throw new Error("invalid_evidence_scope");
  nyDate(`${input.scope.fromDate}T12:00:00Z`); nyDate(`${input.scope.throughDate}T12:00:00Z`);
  if (Buffer.byteLength(canonicalJson(input)) > 5000000) throw new Error("evidence_intake_budget");
  const bindings = new Map<string, EvidenceBinding>();
  for (const binding of input.bindings) {
    if (!text(binding.sourceId) || !text(binding.schemaVersion) || !text(binding.approvalRef) ||
        bindings.has(binding.sourceId) || !Number.isSafeInteger(binding.maxAgeSeconds) ||
        binding.maxAgeSeconds < 1 || binding.maxAgeSeconds > 604800 ||
        typeof binding.independentControlSource !== "boolean" ||
        !binding.sections.length || binding.sections.some(s => !evidenceSections.includes(s)))
      throw new Error("invalid_evidence_binding");
    bindings.set(binding.sourceId, binding);
  }
  const values: Partial<FullBuildEvidence> = {};
  const seen = new Set<EvidenceSection>();
  const lineage: Omit<EvidencePacket, "payload">[] = [];
  for (const packet of input.packets) {
    const binding = bindings.get(packet.sourceId);
    if (!evidenceSections.includes(packet.section) || seen.has(packet.section) || !binding ||
        !binding.sections.includes(packet.section) || binding.schemaVersion !== packet.schemaVersion ||
        !text(packet.sourceRecordRef) || canonicalJson(packet.scope) !== canonicalJson(input.scope))
      throw new Error("unapproved_or_duplicate_evidence_source");
    nyDate(packet.capturedAt);
    const age = Date.parse(input.asOf) - Date.parse(packet.capturedAt);
    if (age < 0 || age > binding.maxAgeSeconds * 1000) throw new Error("stale_or_future_evidence");
    if (packet.sha256 !== evidenceDigest(packet.payload)) throw new Error("evidence_digest_mismatch");
    if (["proofs", "externalControls", "dateCoverage", "cohortCoverage"].includes(packet.section) &&
        !binding.independentControlSource) throw new Error("independent_control_source_required");
    validatePayload(packet.section, packet.payload);
    Object.assign(values, { [packet.section]: structuredClone(packet.payload) });
    const { payload: _payload, ...entry } = packet; void _payload;
    lineage.push(entry); seen.add(packet.section);
  }
  if (required.some(section => !seen.has(section))) throw new Error("missing_evidence_section");
  // Current permission cannot override a deletion in the same snapshot.
  if (values.currentlyPermitted!.some(id => values.removedCustomers!.includes(id)))
    throw new Error("permission_removal_conflict");
  lineage.sort((a, b) => a.section.localeCompare(b.section));
  const digest = evidenceDigest({ scope: input.scope, bindings: input.bindings, lineage });
  return { evidence: { ...values, ref: `intake:sha256:${digest}` } as FullBuildEvidence, lineage, digest };
}
