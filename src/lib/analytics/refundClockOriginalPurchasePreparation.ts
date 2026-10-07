import { evidenceDigest } from "./evidenceIntake";
import { prepareOriginalPurchases, type OriginalPurchaseInput } from "./originalPurchasePreparation";
import { mapShopifyAgreements, type AgreementDocument, type AgreementPolicy } from "./shopifyAgreements";
import type { PilotPolicy } from "./shopifyPilotMapping";
import type { PilotSource } from "./shopifyPilotSource";
import type { RefreshInput } from "./refreshPlan";
import { micros, nyDate } from "./primitives";
import { SHOPIFY_ANALYTICS_API_VERSION, shopifyId, sourceArray, sourceObject, sourceString,
  type SourceObject, type ShopifyOrderDocument } from "./shopifySource";

export type RefundClockOriginalPurchaseInput = {
  source: PilotSource;
  document: AgreementDocument;
  policy: PilotPolicy;
  sourceEvidenceRef: string;
  agreementEvidenceRef: string;
  sourceCapturedAt: string;
};
function refuse(code: string): never { throw new Error(`refund_clock_bridge_${code}`); }
function instant(value: unknown) { const v = sourceString(value); nyDate(v); return v; }
function complete(value: unknown): SourceObject[] {
  const c = sourceObject(value), p = sourceObject(c.pageInfo);
  if (p.hasNextPage !== false || (p.endCursor !== null && typeof p.endCursor !== "string"))
    refuse("incomplete_connection");
  const rows = sourceArray(c.nodes).map(sourceObject);
  if (rows.length > 100 || rows.some(r => typeof r.id !== "string" || !r.id) ||
      new Set(rows.map(r => r.id)).size !== rows.length) refuse("connection_set");
  return rows;
}
function reference(value: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 512) refuse("evidence_ref");
  return value;
}

/** Narrow economic correspondence, not a provider foreign key or new clock policy.
 * A complete sole ReturnAgreement may use the existing refund-created clock only
 * when its sole direct refund proves exactly the same event and line economics.
 * This pure preparation never establishes acquisition authority or completeness
 * of a reporting population. Other agreement shapes remain on their old path.
 */
export function mapRefundClockOriginalPurchase(input: RefundClockOriginalPurchaseInput) {
  const { source, document, policy } = input, o = sourceObject(source.commerce.order);
  const fin = sourceObject(source.financial), revision = instant(o.updatedAt);
  shopifyId(o.id, "Order");
  const capturedAt = instant(input.sourceCapturedAt);
  if (policy.saleClock !== "paid_at" || policy.refundClock !== "refund_created_at" ||
      !policy.financialApprovalRef.trim() || !policy.decision.approvalRef.trim() ||
      policy.decision.eligibility !== "eligible" || policy.refundSupplement !== undefined ||
      policy.orderSize !== undefined) refuse("policy");
  if (source.commerce.apiVersion !== SHOPIFY_ANALYTICS_API_VERSION ||
      document.apiVersion !== source.commerce.apiVersion || document.shop !== source.commerce.shop ||
      document.orderGid !== o.id || document.sourceUpdatedAt !== revision || document.complete !== true ||
      fin.id !== o.id || fin.updatedAt !== revision || fin.currencyCode !== "USD" ||
      o.currencyCode !== "USD" || Date.parse(capturedAt) < Date.parse(revision) ||
      Date.parse(instant(document.capturedAt)) < Date.parse(revision)) refuse("scope");
  if (o.test !== false || o.taxesIncluded !== false || o.edited !== true || o.cancelledAt !== null)
    refuse("order_shape");
  const money = (value: unknown) => {
    const m = sourceObject(sourceObject(value).shopMoney);
    if (m.currencyCode !== "USD") refuse("currency");
    return micros(sourceString(m.amount));
  };
  const positive = (value: unknown) => {
    const n = money(value); if (n < BigInt(0)) refuse("negative_source_money"); return n;
  };
  if (positive(fin.totalTipReceivedSet) !== BigInt(0) || positive(fin.totalTaxSet) !== BigInt(0) ||
      (fin.originalTotalDutiesSet !== null && positive(fin.originalTotalDutiesSet) !== BigInt(0)) ||
      (fin.originalTotalAdditionalFeesSet !== null && positive(fin.originalTotalAdditionalFeesSet) !== BigInt(0)))
    refuse("original_components");
  const lines = complete(o.lineItems), shipping = complete(fin.shippingLines);
  if (!lines.length || lines.some(l => l.isGiftCard !== false)) refuse("line_set");
  const agreements = sourceArray(document.agreements).map(sourceObject);
  const originals = agreements.filter(a => a.__typename === "OrderAgreement" && a.reason === "ORDER");
  const returns = agreements.filter(a => a.__typename === "ReturnAgreement" && a.reason === "RETURN");
  const refs = sourceArray(fin.refunds).map(sourceObject);
  if (agreements.length !== 2 || originals.length !== 1 || returns.length !== 1 ||
      refs.length !== 1 || !Array.isArray(source.refunds) || source.refunds.length !== 1)
    refuse("sole_return_required");
  const original = originals[0], returned = returns[0], refund = sourceObject(source.refunds[0]);
  shopifyId(refund.id, "Refund");
  if (refund.id !== refs[0].id || refund.updatedAt !== refs[0].updatedAt ||
      sourceObject(refund.order).id !== o.id ||
      Date.parse(instant(refund.updatedAt)) > Date.parse(revision)) refuse("refund_scope");
  const refundAt = instant(refund.createdAt), returnAt = instant(returned.happenedAt);
  if (returnAt !== refundAt || Date.parse(refundAt) > Date.parse(instant(refund.updatedAt)) ||
      Date.parse(refundAt) > Date.parse(revision)) refuse("clock");
  if (complete(refund.orderAdjustments).length || complete(refund.refundShippingLines).length ||
      !Array.isArray(refund.duties) || refund.duties.length) refuse("refund_components");
  const originalSales = sourceArray(original.sales).map(sourceObject);
  const productSales = originalSales.filter(s => s.__typename === "ProductSale" && s.lineType === "PRODUCT");
  const shippingSales = originalSales.filter(s => s.__typename === "ShippingLineSale" && s.lineType === "SHIPPING");
  if (productSales.length !== lines.length || productSales.length + shippingSales.length !== originalSales.length ||
      new Set(productSales.map(s => sourceObject(s.lineItem).id)).size !== lines.length)
    refuse("original_line_set");
  for (const sale of originalSales) {
    if (sale.actionType !== "ORDER" || money(sale.totalTaxAmount) !== BigInt(0)) refuse("original_components");
  }
  for (const sale of productSales) {
    const id = sourceObject(sale.lineItem).id, line = lines.find(l => l.id === id);
    if (!line || !Number.isSafeInteger(sale.quantity) || Number(sale.quantity) <= 0 ||
        policy.lineClasses[shopifyId(id, "LineItem")] !== "merchandise") refuse("original_line_set");
    // Establish coverage/classification with current IDs only. Original quantity
    // and value continue to come from the original agreement, never current lines.
    if (money(sale.totalDiscountAmountBeforeTaxes) < BigInt(0) ||
        money(sale.totalDiscountAmountBeforeTaxes) !== money(sale.totalDiscountAmountAfterTaxes))
      refuse("original_discount");
  }
  if (shippingSales.some(s => money(s.totalDiscountAmountBeforeTaxes) !== BigInt(0) ||
      money(s.totalDiscountAmountAfterTaxes) !== BigInt(0)) ||
      shippingSales.reduce((n, s) => n + positive(s.totalAmount), BigInt(0)) !==
      shipping.reduce((n, s) => n + positive(s.discountedPriceSet), BigInt(0))) refuse("original_shipping");
  const originalTotal = originalSales.reduce((n, s) => n + positive(s.totalAmount), BigInt(0));
  if (originalTotal !== positive(fin.originalTotalPriceSet) ||
      originalTotal !== positive(o.originalTotalPriceSet)) refuse("original_total");
  const refundLines = complete(refund.refundLineItems), returnSales = sourceArray(returned.sales).map(sourceObject);
  if (!refundLines.length || refundLines.length !== returnSales.length ||
      new Set(refundLines.map(l => sourceObject(l.lineItem).id)).size !== refundLines.length ||
      new Set(returnSales.map(s => sourceObject(s.lineItem).id)).size !== returnSales.length)
    refuse("return_line_set");
  const correspondences = refundLines.map(line => {
    const lineGid = sourceObject(line.lineItem).id;
    const sale = returnSales.find(s => sourceObject(s.lineItem).id === lineGid);
    const purchased = productSales.find(s => sourceObject(s.lineItem).id === lineGid);
    if (!sale || !purchased || sale.__typename !== "ProductSale" || sale.lineType !== "PRODUCT" ||
        sale.actionType !== "RETURN" || !Number.isSafeInteger(line.quantity) || Number(line.quantity) <= 0 ||
        sale.quantity !== -Number(line.quantity) || Number(line.quantity) > Number(purchased.quantity))
      refuse("return_quantity");
    const subtotal = positive(line.subtotalSet), tax = positive(line.totalTaxSet);
    if (tax !== BigInt(0) || money(sale.totalTaxAmount) !== -tax ||
        money(sale.totalAmount) !== -(subtotal + tax) || subtotal > positive(purchased.totalAmount))
      refuse("return_amount");
    const discount = money(sale.totalDiscountAmountBeforeTaxes);
    if (discount > BigInt(0) || discount !== money(sale.totalDiscountAmountAfterTaxes) ||
        -discount > money(purchased.totalDiscountAmountBeforeTaxes)) refuse("return_discount");
    return { lineGid, refundLineGid: line.id, returnSaleGid: sale.id,
      originalSaleGid: purchased.id, quantity: line.quantity };
  });
  const totalRefunded = positive(refund.totalRefundedSet);
  if (totalRefunded <= BigInt(0) || refundLines.reduce((n, l) => n + positive(l.subtotalSet) + positive(l.totalTaxSet), BigInt(0)) !==
      totalRefunded) refuse("refund_total");
  const transactions = sourceArray(o.transactions).map(sourceObject), refundTx = complete(refund.transactions);
  const successes = transactions.filter(t => t.kind === "REFUND" && t.status === "SUCCESS");
  if (!refundTx.length || successes.length !== refundTx.length) refuse("payment_set");
  const payments = refundTx.map(tx => {
    const t = successes.find(s => s.id === tx.id);
    const parent = t && transactions.find(p => p.id === sourceObject(t.parentTransaction).id);
    const processedAt = instant(tx.processedAt);
    if (!t || tx.kind !== "REFUND" || tx.status !== "SUCCESS" || t.processedAt !== processedAt ||
        positive(t.amountSet) !== positive(tx.amountSet) || !parent || parent.status !== "SUCCESS" ||
        !["SALE", "CAPTURE"].includes(String(parent.kind)) || parent.gateway !== t.gateway ||
        Date.parse(instant(parent.processedAt)) > Date.parse(processedAt) ||
        Date.parse(processedAt) > Date.parse(revision) || positive(tx.amountSet) > positive(parent.amountSet))
      refuse("payment_correspondence");
    return { transactionGid: tx.id, parentTransactionGid: parent.id, processedAt };
  });
  if (refundTx.reduce((n, t) => n + positive(t.amountSet), BigInt(0)) !== totalRefunded)
    refuse("payment_total");
  const derivation = {
    kind: "sole-return-direct-refund-clock-equivalence-v1",
    shop: document.shop, orderGid: document.orderGid, sourceUpdatedAt: revision,
    pilotSourceDigest: evidenceDigest(source), agreementDocumentDigest: evidenceDigest(document),
    policyDigest: evidenceDigest(policy),
    sourceEvidenceRef: reference(input.sourceEvidenceRef),
    agreementEvidenceRef: reference(input.agreementEvidenceRef), sourceCapturedAt: capturedAt,
    agreementCapturedAt: document.capturedAt,
    financialApprovalRef: policy.financialApprovalRef, decisionApprovalRef: policy.decision.approvalRef,
    saleClock: policy.saleClock, refundClock: policy.refundClock, refundCreatedAt: refundAt,
    returnAgreementHappenedAt: returnAt, refundGid: refund.id, returnAgreementGid: returned.id,
    correspondences, payments, nativeForeignKeyClaimed: false, populationCertified: false
  };
  const derivationDigest = evidenceDigest(derivation);
  const evidenceRef = `shopify-refund-clock-derivation:sha256:${derivationDigest}`;
  // This implementation clock is now source-proven equal to refund_created_at
  // for the sole change only. The real refs are preserved, not reissued as a
  // general approval of agreement_happened_at.
  const agreementPolicy: AgreementPolicy = {
    decision: policy.decision, lineClasses: policy.lineClasses,
    financialApprovalRef: policy.financialApprovalRef, saleClock: policy.saleClock,
    changeClock: "agreement_happened_at", sourceEvidenceRef: evidenceRef
  };
  const replacement = mapShopifyAgreements(source.commerce, document, agreementPolicy);
  if (Date.parse(refundAt) <= Date.parse(replacement.snapshot.paidAt!)) refuse("refund_before_purchase");
  const item: OriginalPurchaseInput = { orderGid: document.orderGid, document, policy: agreementPolicy };
  return { replacement, item, derivation, derivationDigest };
}

/** Additive entry. Old preparation and callers remain unchanged. The existing
 * replacement/deferred-source gates still run; this does not register a run.
 */
export function prepareRefundClockOriginalPurchases(refresh: RefreshInput, orders: ShopifyOrderDocument[],
  inputs: RefundClockOriginalPurchaseInput[], binding: { sourceId: string; schemaVersion: string }) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 100) refuse("budget");
  const prepared = inputs.map(mapRefundClockOriginalPurchase);
  for (const input of inputs) {
    const matching = orders.filter(o => o.order.id === input.source.commerce.order.id);
    if (matching.length !== 1 || evidenceDigest(matching[0]) !== evidenceDigest(input.source.commerce))
      refuse("preparation_source");
  }
  const result = prepareOriginalPurchases(refresh, orders, prepared.map(p => p.item), binding);
  const derivations = prepared.map(p => p.derivation);
  return { ...result, packet: { ...result.packet,
    sourceRecordRef: `shopify-refund-clock-sources:sha256:${evidenceDigest(derivations)}`,
    capturedAt: new Date(Math.min(...inputs.flatMap(i =>
      [Date.parse(i.sourceCapturedAt), Date.parse(i.document.capturedAt)]))).toISOString() },
    derivations, derivationDigest: evidenceDigest(derivations) };
}
