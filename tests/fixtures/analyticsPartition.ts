import { discoveryEnv, discoveryInput } from "./analyticsDiscovery";
import { agreementCollectionSource } from "./agreement-collection-source.mjs";
import { evidenceDigest } from "@/lib/analytics/evidenceIntake";
import type { PartitionCollectInput } from "@/lib/analytics/partitionRefresh";
import type { AgreementPolicy } from "@/lib/analytics/shopifyAgreements";
export const partitionEnv = { ...discoveryEnv, LEAN_SHOPIFY_AGREEMENTS_READ_APPROVED: "true",
  LEAN_PARTITION_COLLECTION_APPROVED: "true" };
export function partitionInput(): PartitionCollectInput {
  const seed = discoveryInput(), now = new Date().toISOString();
  const refresh = seed.refresh;
  refresh.readyAt = refresh.policy.asOf = refresh.intake.asOf = now;
  refresh.expiresAt = new Date(Date.parse(now) + 1800000).toISOString();
  refresh.intake.scope.throughDate = "2026-01-02"; refresh.accounts = []; refresh.maxSteps = 128;
  refresh.policy.behaviorMode = "excluded";
  for (const p of refresh.intake.packets) {
    p.capturedAt = now;
    if (["offers", "settlements", "replacements", "orderIdentities"].includes(p.section)) p.payload = [];
    if (p.section === "identity") Object.assign((p.payload as object[])[0], { namespace: "shopify_customer", identifier: "7" });
    p.sha256 = evidenceDigest(p.payload);
  }
  const { discover: ignored, ...common } = seed.collection; void ignored;
  return { kind: "mully-partition-collect-v1", refresh, collection: { ...common, maxOrders: 1000,
    maxRequests: 2000, maxBytes: 32000000, timeoutMs: 120000,
    partitions: [
      { id: "first", history: [{ from: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z", pageSize: 5, maxPages: 20 }],
        originalPurchases: { maxRequestsPerOrder: 3, orders: [{ orderGid: "gid://shopify/Order/1",
          policy: agreementCollectionSource().policy as Omit<AgreementPolicy, "sourceEvidenceRef"> }] } },
      { id: "second", history: [{ from: "2026-01-02T00:00:00Z", until: "2026-01-03T00:00:00Z", pageSize: 5, maxPages: 1 }] },
    ] } };
}
