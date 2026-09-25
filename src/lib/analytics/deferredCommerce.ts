import type { FullBuildEvidence } from "./fullReportBuild";
import { shopifyId, sourceArray, sourceObject, sourceString } from "./shopifySource";
import { nyDate } from "./primitives";

/** An explicit revision-bound handoff, never a catch-and-ignore mapping error. */
export type DeferredOrder = { orderGid: string; sourceUpdatedAt: string; evidenceRef: string };
export function deferredOrders(value: unknown): DeferredOrder[] {
  const rows = sourceArray(value ?? []);
  if (rows.length > 100) throw new Error("deferred_order_budget");
  const seen = new Set<string>();
  return rows.map(value => {
    const row = sourceObject(value);
    const orderGid = sourceString(row.orderGid), sourceUpdatedAt = sourceString(row.sourceUpdatedAt);
    const evidenceRef = sourceString(row.evidenceRef);
    shopifyId(orderGid, "Order"); nyDate(sourceUpdatedAt);
    if (!evidenceRef.trim() || seen.has(orderGid)) throw new Error("invalid_deferred_order");
    seen.add(orderGid);
    return { orderGid, sourceUpdatedAt, evidenceRef };
  });
}
export function verifyDeferredReplacements(rows: DeferredOrder[], evidence: FullBuildEvidence, shop: string) {
  for (const row of rows) {
    const replacements = evidence.replacements.filter(r => r.snapshot.shop === shop &&
      r.snapshot.id === shopifyId(row.orderGid, "Order"));
    if (replacements.length !== 1 || replacements[0].evidenceRef !== row.evidenceRef ||
        Date.parse(replacements[0].snapshot.updatedAt) !== Date.parse(row.sourceUpdatedAt))
      throw new Error("missing_revision_bound_original_purchase");
  }
}
