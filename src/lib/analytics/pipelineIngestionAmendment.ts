import { createHash } from "node:crypto";
import { sourceArray, sourceObject, sourceString, shopifyId } from "./shopifySource";
import type { PipelinePolicy } from "./shopifyPipeline";
import type { PilotSource } from "./shopifyPilotSource";
import { micros } from "./primitives";

export const INGESTION_SCOPE = "799209cbd0913f5257afaabefc478ec7e402640b4ac5c30e5f9ee81eeee30689";
export const INGESTION_PRODUCTS = ["10244806213824", "10249371680960", "8501257306304"] as const;
export const REFUND_SUPPLEMENT = {
  sourceSha256: "967d4d3a6027912a30137d71263421f6c4c64e9a692d49a2f605f1c837ce55c1",
  orderSha256: "e1258896ebc6a0b1e91b373df4b30ce1c853e2ec517d17e83494b08e0d268ca8",
  refundSha256: "7b7fe316531d8046efd16f034bea909fb1fa77b11c3d9070bf675e40f1f95fa4",
  adjustmentSha256: "5ddf837de8d28b8cec35fcedbef01490e110dc28ff61c2da8dedf05222e33c50",
  evidenceSha256: "df50358fabf53683c634e5f2f56712d3dab0472f2e0cf0a7db2365f7c28e4cfe",
  kind: "refund_discrepancy", reason: "Refund discrepancy",
  amount: "-13.50", taxAmount: "0.00", currency: "USD",
} as const;
export type IngestionAdmission = {
  version: "ingestion-amendment-20261002";
  revision: number; approvalRef: string; scopeSha256: typeof INGESTION_SCOPE;
  retainedSourceSha256: string | null;
};
export type RefundSupplement = { admission: IngestionAdmission; evidence: typeof REFUND_SUPPLEMENT };

/** Only the installed owner-controlled claim may supply this separate context.
 * Never reinterpret an extra field in the original frozen mapping policy. */
export function ingestionAdmission(value: unknown): IngestionAdmission | undefined {
  if (value === undefined || value === null) return undefined;
  const a = sourceObject(value);
  if (Object.keys(a).sort().join(",") !==
      "approvalRef,retainedSourceSha256,revision,scopeSha256,version" ||
      a.version !== "ingestion-amendment-20261002" || a.scopeSha256 !== INGESTION_SCOPE ||
      !Number.isSafeInteger(a.revision) || (a.revision as number) < 1 ||
      typeof a.approvalRef !== "string" || !a.approvalRef.trim() || a.approvalRef.length > 500 ||
      !(a.retainedSourceSha256 === null || typeof a.retainedSourceSha256 === "string" &&
        /^[a-f0-9]{64}$/.test(a.retainedSourceSha256))) throw new Error("ingestion_admission_invalid");
  return a as IngestionAdmission;
}

export function amendedPipelinePolicy(source: PilotSource, policy: PipelinePolicy, value: unknown) {
  if (Object.hasOwn(policy, "refundSupplement")) throw new Error("ingestion_frozen_policy_changed");
  const admission = ingestionAdmission(value);
  if (!admission) return { policy, admission: undefined };
  if (source.commerce.shop !== "mullybox-store.myshopify.com" ||
      source.commerce.projection !== "financial_no_geo_order_size" ||
      policy.sourceProjection !== "financial_no_geo_order_size" ||
      policy.sourceRetention !== "financial_allowlist_v1" || policy.retainedReports !== "product-v1")
    throw new Error("ingestion_target_changed");
  const classes = { ...policy.productClasses };
  let used = false;
  for (const value of sourceArray(sourceObject(source.commerce.order.lineItems).nodes)) {
    const line = sourceObject(value), product = shopifyId(sourceObject(line.product).id, "Product");
    if ((INGESTION_PRODUCTS as readonly string[]).includes(product)) {
      if (Object.hasOwn(classes, product) && classes[product] !== "merchandise")
        throw new Error("ingestion_catalog_conflict");
      classes[product] = "merchandise"; used = true;
    }
  }
  const refund = admission.retainedSourceSha256 === REFUND_SUPPLEMENT.sourceSha256;
  if (refund) used = true;
  return { policy: { ...policy, productClasses: classes,
    ...(refund ? { refundSupplement: { admission, evidence: REFUND_SUPPLEMENT } } : {}) },
    admission: used ? admission : undefined };
}

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
/** Historical REST evidence supplements an ID-only immutable GraphQL source.
 * Nothing is patched into source, and no amount or type is inferred. */
export function approvedRefundDiscrepancy(source: PilotSource, refund: Record<string, unknown>,
  supplement: RefundSupplement | undefined): string {
  if (!supplement || !ingestionAdmission(supplement.admission) ||
      supplement.admission.retainedSourceSha256 !== REFUND_SUPPLEMENT.sourceSha256 ||
      JSON.stringify(supplement.evidence) !== JSON.stringify(REFUND_SUPPLEMENT))
    throw new Error("ingestion_refund_unapproved");
  const order = sourceString(source.commerce.order.id), id = sourceString(refund.id);
  shopifyId(order, "Order"); shopifyId(id, "Refund");
  const connection = sourceObject(refund.orderAdjustments);
  const adjustments = sourceArray(connection.nodes).map(sourceObject);
  if (source.commerce.shop !== "mullybox-store.myshopify.com" ||
      hash(order) !== REFUND_SUPPLEMENT.orderSha256 || hash(id) !== REFUND_SUPPLEMENT.refundSha256 ||
      sourceObject(refund.order).id !== order || connection.pageInfo === null ||
      sourceObject(connection.pageInfo).hasNextPage !== false || adjustments.length !== 1 ||
      Object.keys(adjustments[0]).join(",") !== "id" ||
      hash(sourceString(adjustments[0].id)) !== REFUND_SUPPLEMENT.adjustmentSha256 ||
      source.refunds.length !== 1 ||
      sourceArray(sourceObject(refund.refundLineItems).nodes).length !== 0 ||
      sourceArray(sourceObject(refund.refundShippingLines).nodes).length !== 0 ||
      sourceObject(sourceObject(refund.totalRefundedSet).shopMoney).currencyCode !== "USD" ||
      micros(sourceString(sourceObject(sourceObject(refund.totalRefundedSet).shopMoney).amount)) !== BigInt(13500000))
    throw new Error("ingestion_refund_evidence_mismatch");
  return REFUND_SUPPLEMENT.amount;
}
