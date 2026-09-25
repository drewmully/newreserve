import { fullFixture, fullProject, fullShop } from "./analyticsFull";
import { evidenceDigest, evidenceSections, type EvidencePacket } from "@/lib/analytics/evidenceIntake";
import type { RefreshInput } from "@/lib/analytics/refreshPlan";
export function refreshFixture(): RefreshInput {
  const f = fullFixture(), asOf = new Date().toISOString();
  const scope = { projectRef: fullProject, shop: fullShop, fromDate: f.fromDate, throughDate: f.throughDate };
  return {
    intake: { scope, asOf,
      bindings: [{ sourceId: "fixture:export", sections: [...evidenceSections], schemaVersion: "fixture-v1",
        approvalRef: "fixture:binding", maxAgeSeconds: 3600, independentControlSource: true }],
      packets: evidenceSections.map(section => ({ section, sourceId: "fixture:export",
        sourceRecordRef: `fixture:export/${section}`, schemaVersion: "fixture-v1", scope,
        capturedAt: asOf, sha256: evidenceDigest(f.evidence[section]), payload: f.evidence[section],
      })) as EvidencePacket[],
    },
    policy: { ...f.policy, asOf }, behavior: f.behavior,
    commercePolicy: { decision: { eligibility: "eligible", commerceSource: "storefront",
      acquisitionEligible: true, approvalRef: "fixture:decision" }, productClasses: { "3": "merchandise" },
    financialApprovalRef: "fixture:financial", saleClock: "paid_at", refundClock: "refund_created_at" },
    history: [{ from: "2026-01-01T00:00:00Z", until: "2026-02-01T00:00:00Z", pageSize: 2, maxPages: 2 }],
    accounts: [{ accountId: "1234567890", loginCustomerId: null, maxPages: 1 }],
    approvalRef: "fixture:refresh", actorRef: "fixture:owner", revision: "fixture-v1",
    readyAt: asOf, expiresAt: new Date(Date.parse(asOf) + 1800000).toISOString(), maxSteps: 5,
  };
}
