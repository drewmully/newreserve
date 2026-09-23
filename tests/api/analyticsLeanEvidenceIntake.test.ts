import { expect, it } from "vitest";
import { assembleEvidence, evidenceDigest, evidenceSections, type EvidencePacket } from "@/lib/analytics/evidenceIntake";
import { fullFixture, fullProject, fullShop } from "../fixtures/analyticsFull";
export function intakeFixture() {
  const f = fullFixture();
  const scope = { projectRef: fullProject, shop: fullShop, fromDate: f.fromDate, throughDate: f.throughDate };
  return { scope, asOf: f.policy.asOf,
    bindings: [{ sourceId: "fixture:export", sections: [...evidenceSections], schemaVersion: "fixture-v1",
      approvalRef: "fixture:approved-binding", maxAgeSeconds: 3600, independentControlSource: true }],
    packets: evidenceSections.map(section => ({
      section, sourceId: "fixture:export", sourceRecordRef: `fixture:export/${section}`,
      schemaVersion: "fixture-v1", scope, capturedAt: f.policy.asOf,
      sha256: evidenceDigest(f.evidence[section]), payload: f.evidence[section],
    })) as EvidencePacket[],
  };
}
it("assembles every section with immutable provenance and no made-up defaults", () => {
  const result = assembleEvidence(intakeFixture());
  expect(result.evidence.ref).toBe(`intake:sha256:${result.digest}`);
  expect(result.lineage).toHaveLength(evidenceSections.length);
  expect(result.evidence.proofs).toEqual(fullFixture().evidence.proofs);
});
it("does not let packet ordering or object key order change source digests", () => {
  expect(evidenceDigest({ a: 1, b: 2 })).toBe(evidenceDigest({ b: 2, a: 1 }));
  const input = intakeFixture(), a = assembleEvidence(input);
  input.packets.reverse();
  expect(assembleEvidence(input).digest).toBe(a.digest);
});
it.each(["identity", "settlements", "proofs", "customerHistory"] as const)("requires the %s feed even if an empty result is legitimate", section => {
  const input = intakeFixture(); input.packets = input.packets.filter(p => p.section !== section);
  expect(() => assembleEvidence(input)).toThrow("missing_evidence_section");
});
it("rejects stale/future snapshots, scope drift, unapproved sources and tampered contents", () => {
  for (const mutate of [
    (p: EvidencePacket) => { p.capturedAt = "2026-03-01T00:00:00Z"; },
    (p: EvidencePacket) => { p.capturedAt = "2026-03-03T00:00:00Z"; },
    (p: EvidencePacket) => { p.scope = { ...p.scope, shop: "other.myshopify.com" }; },
    (p: EvidencePacket) => { p.sourceId = "unapproved"; },
    (p: EvidencePacket) => { p.sha256 = "0".repeat(64); },
  ]) {
    const input = intakeFixture(); mutate(input.packets[0]);
    expect(() => assembleEvidence(input)).toThrow();
  }
});
it("requires an explicitly independent control binding", () => {
  const input = intakeFixture(); input.bindings[0].independentControlSource = false;
  expect(() => assembleEvidence(input)).toThrow("independent_control_source_required");
});
it("does not replace missing boolean coverage with truthiness or zeroes", () => {
  const input = intakeFixture();
  const packet = input.packets.find(p => p.section === "sessionCoverage")!;
  packet.payload = { behaviorComplete: "true" } as unknown as typeof packet.payload;
  packet.sha256 = evidenceDigest(packet.payload);
  expect(() => assembleEvidence(input)).toThrow("invalid_session_evidence");
});
it("does not permit a deleted customer to remain currently permitted", () => {
  const input = intakeFixture(), packet = input.packets.find(p => p.section === "removedCustomers")!;
  packet.payload = ["customer-fixture"]; packet.sha256 = evidenceDigest(packet.payload);
  expect(() => assembleEvidence(input)).toThrow("permission_removal_conflict");
});
