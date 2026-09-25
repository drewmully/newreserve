import { evidenceDigest } from "./evidenceIntake";
import { normalizeCommerce, type PurchaseLine } from "./commerce";
import { normalizeLedger, normalizePayment, type Movement, type Component } from "./financial";
import type { FullBuildEvidence } from "./fullReportBuild";
import { mapShopifyTransactions, type ShopifyMappingPolicy } from "./shopifyMapping";
import { decimal, micros, nyDate } from "./primitives";
import { SHOPIFY_ANALYTICS_API_VERSION, shopifyId, shopifyShop, sourceArray, sourceObject,
  sourceString, type SourceObject, type ShopifyOrderDocument } from "./shopifySource";

/** Page one agreement at a time so nested sale pagination is independently bounded. */
export const SHOPIFY_AGREEMENTS_QUERY = `
query AnalyticsAgreements($id: ID!, $agreementCursor: String, $saleCursor: String) {
  order(id: $id) {
    id updatedAt
    agreements(first: 1, after: $agreementCursor) {
      edges {
        cursor
        node {
          __typename id reason happenedAt
          sales(first: 100, after: $saleCursor) {
            nodes {
              __typename id actionType lineType quantity
              totalAmount { shopMoney { amount currencyCode } }
              totalTaxAmount { shopMoney { amount currencyCode } }
              totalDiscountAmountBeforeTaxes { shopMoney { amount currencyCode } }
              totalDiscountAmountAfterTaxes { shopMoney { amount currencyCode } }
              ... on ProductSale { lineItem { id } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
const REVISION_QUERY = `query AnalyticsAgreementRevision($id: ID!) { order(id: $id) { id updatedAt } }`;
export type AgreementDocument = {
  shop: string; apiVersion: typeof SHOPIFY_ANALYTICS_API_VERSION;
  orderGid: string; sourceUpdatedAt: string; capturedAt: string;
  agreements: SourceObject[]; complete: true;
};
function instant(value: unknown) { const s = sourceString(value); nyDate(s); return s; }
function connection(value: unknown) {
  const c = sourceObject(value), p = sourceObject(c.pageInfo);
  if (typeof p.hasNextPage !== "boolean" || (p.endCursor !== null && typeof p.endCursor !== "string") ||
      (p.hasNextPage && !p.endCursor)) throw new Error("agreement_incomplete_page");
  return { value: c, more: p.hasNextPage, cursor: p.endCursor as string | null };
}
function gid(value: unknown) {
  const id = sourceString(value);
  if (!/^gid:\/\/shopify\/[A-Za-z]+\/[1-9]\d*$/.test(id)) throw new Error("agreement_invalid_id");
  return id;
}
export async function readShopifyAgreements(options: {
  shop: string; accessToken: string; orderGid: string; sourceUpdatedAt: string;
  maxRequests: number; fetcher?: typeof fetch; now?: () => Date;
}): Promise<AgreementDocument> {
  const shop = shopifyShop(options.shop);
  shopifyId(options.orderGid, "Order"); instant(options.sourceUpdatedAt);
  if (!options.accessToken.trim() || !Number.isSafeInteger(options.maxRequests) ||
      options.maxRequests < 2 || options.maxRequests > 100) throw new Error("agreement_read_budget");
  let requests = 0;
  async function request(query: string, agreementCursor: string | null, saleCursor: string | null) {
    if (++requests > options.maxRequests) throw new Error("agreement_read_budget");
    let response: Response;
    try {
      response = await (options.fetcher ?? fetch)(`https://${shop}/admin/api/${SHOPIFY_ANALYTICS_API_VERSION}/graphql.json`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": options.accessToken },
        body: JSON.stringify({ query, variables: { id: options.orderGid, agreementCursor, saleCursor } }),
      });
    } catch { throw new Error("agreement_transport_failed"); }
    if (!response.ok) throw new Error("agreement_http_failed");
    if (response.headers.get("X-Shopify-API-Version") !== SHOPIFY_ANALYTICS_API_VERSION)
      throw new Error("agreement_api_version");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("agreement_invalid_response");
    const parts: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1000000) { await reader.cancel(); throw new Error("agreement_response_budget"); }
        parts.push(chunk.value);
      }
    } catch { throw new Error("agreement_response_failed"); } finally { reader.releaseLock(); }
    let body: SourceObject;
    try { body = sourceObject(JSON.parse(Buffer.concat(parts).toString("utf8"))); }
    catch { throw new Error("agreement_invalid_response"); }
    if (body.errors !== undefined && (!Array.isArray(body.errors) || body.errors.length))
      throw new Error("agreement_graphql_failed");
    const order = sourceObject(sourceObject(body.data).order);
    if (order.id !== options.orderGid || order.updatedAt !== options.sourceUpdatedAt)
      throw new Error("agreement_order_revision_changed");
    return order;
  }
  const agreements: SourceObject[] = [], seenAgreements = new Set<string>(), seenSales = new Set<string>();
  const outerCursors = new Set<string>();
  let agreementCursor: string | null = null;
  for (;;) {
    let saleCursor: string | null = null, initial: SourceObject | null = null;
    let nextAgreement: string | null = null, moreAgreements = false;
    const sales: SourceObject[] = [], innerCursors = new Set<string>();
    for (;;) {
      const order = await request(SHOPIFY_AGREEMENTS_QUERY, agreementCursor, saleCursor);
      const outer = connection(order.agreements), edges = sourceArray(outer.value.edges);
      if (edges.length !== 1) throw new Error("agreement_missing_or_oversized_page");
      const edge = sourceObject(edges[0]), node = sourceObject(edge.node);
      const metadata = { id: gid(node.id), __typename: sourceString(node.__typename),
        reason: sourceString(node.reason), happenedAt: instant(node.happenedAt) };
      const cursor = sourceString(edge.cursor);
      if (outer.cursor !== cursor) throw new Error("agreement_cursor_mismatch");
      if (initial && (evidenceDigest(metadata) !== evidenceDigest(initial) ||
          cursor !== nextAgreement || outer.more !== moreAgreements))
        throw new Error("agreement_changed_during_read");
      initial = metadata; nextAgreement = cursor; moreAgreements = outer.more;
      const inner = connection(node.sales), rows = sourceArray(inner.value.nodes).map(sourceObject);
      if (rows.length > 100 || (inner.more && !rows.length)) throw new Error("agreement_invalid_sales_page");
      for (const row of rows) {
        const id = gid(row.id);
        if (seenSales.has(id)) throw new Error("agreement_duplicate_sale");
        seenSales.add(id); sales.push(row);
      }
      if (sales.length > 1000) throw new Error("agreement_sale_budget");
      if (!inner.more) break;
      if (innerCursors.has(inner.cursor!)) throw new Error("agreement_cursor_loop");
      innerCursors.add(inner.cursor!); saleCursor = inner.cursor;
    }
    if (seenAgreements.has(initial!.id as string)) throw new Error("agreement_duplicate");
    seenAgreements.add(initial!.id as string); agreements.push({ ...initial, sales });
    if (!moreAgreements) break;
    if (outerCursors.has(nextAgreement!)) throw new Error("agreement_cursor_loop");
    outerCursors.add(nextAgreement!); agreementCursor = nextAgreement;
  }
  await request(REVISION_QUERY, null, null);
  const capturedAt = (options.now ?? (() => new Date()))().toISOString();
  if (Date.parse(capturedAt) < Date.parse(options.sourceUpdatedAt)) throw new Error("agreement_future_revision");
  return { shop, apiVersion: SHOPIFY_ANALYTICS_API_VERSION, orderGid: options.orderGid,
    sourceUpdatedAt: options.sourceUpdatedAt, capturedAt, agreements, complete: true };
}

export type AgreementPolicy = ShopifyMappingPolicy & {
  financialApprovalRef: string; saleClock: "paid_at"; changeClock: "agreement_happened_at";
};
/** Immutable original sale values, not present-day LineItem totals. No source
 * coverage, consent, settlement or independent reconciliation is inferred. */
export function mapShopifyAgreements(commerce: ShopifyOrderDocument, document: AgreementDocument,
  policy: AgreementPolicy): FullBuildEvidence["replacements"][number] {
  const shop = shopifyShop(commerce.shop), o = sourceObject(commerce.order);
  const orderId = shopifyId(o.id, "Order"), currency = sourceString(o.currencyCode);
  const createdAt = instant(o.createdAt), updatedAt = instant(o.updatedAt);
  instant(document.capturedAt);
  if (!/^[A-Z]{3}$/.test(currency) || commerce.apiVersion !== SHOPIFY_ANALYTICS_API_VERSION ||
      document.apiVersion !== SHOPIFY_ANALYTICS_API_VERSION || document.shop !== shop ||
      document.orderGid !== o.id || document.sourceUpdatedAt !== updatedAt || document.complete !== true ||
      Date.parse(updatedAt) < Date.parse(createdAt) || Date.parse(document.capturedAt) < Date.parse(updatedAt))
    throw new Error("agreement_source_scope");
  if (!policy.sourceEvidenceRef.trim() || !policy.financialApprovalRef.trim() ||
      !policy.decision.approvalRef.trim() || policy.saleClock !== "paid_at" ||
      policy.changeClock !== "agreement_happened_at") throw new Error("agreement_policy_required");
  // These exclusions still require explicit review rather than guessing their
  // cash/acquisition treatment from a cancellation flag.
  if (o.test !== false || o.cancelledAt !== null || policy.decision.eligibility !== "eligible")
    throw new Error("agreement_requires_eligible_order");
  function money(value: unknown) {
    const m = sourceObject(sourceObject(value).shopMoney);
    if (m.currencyCode !== currency) throw new Error("agreement_currency_mismatch");
    return micros(sourceString(m.amount));
  }
  const agreements = document.agreements.map(sourceObject);
  if (!agreements.length || agreements.length > 100 ||
      new Set(agreements.map(a => gid(a.id))).size !== agreements.length) throw new Error("agreement_invalid_set");
  const originals = agreements.filter(a => a.__typename === "OrderAgreement" && a.reason === "ORDER");
  if (originals.length !== 1) throw new Error("agreement_original_required");
  const original = originals[0], originalAt = instant(original.happenedAt);
  const originalSales = sourceArray(original.sales).map(sourceObject);
  const originalTotal = originalSales.reduce((n, s) => n + money(s.totalAmount), BigInt(0));
  if (originalTotal <= BigInt(0) || originalTotal !== money(o.originalTotalPriceSet))
    throw new Error("agreement_original_total_mismatch");
  const transactions = mapShopifyTransactions(o, shop, orderId, currency, false);
  const captures = transactions.filter(t => t.payment.status === "succeeded" &&
    ["capture", "sale"].includes(t.payment.kind)).sort((a, b) =>
    Date.parse(a.processedAt ?? "") - Date.parse(b.processedAt ?? ""));
  let captured = BigInt(0), paidAt: string | null = null;
  for (const t of captures) {
    if (!t.processedAt || Date.parse(t.processedAt) > Date.parse(updatedAt))
      throw new Error("agreement_paid_time_required");
    if (!paidAt) {
      captured += micros(t.payment.signedAmount);
      if (captured > originalTotal) throw new Error("agreement_ambiguous_original_payment");
      if (captured === originalTotal) paidAt = t.processedAt;
    }
  }
  if (!paidAt) throw new Error("agreement_original_payment_required");
  // If order edits preceded original full payment, later captures cannot prove
  // what amount originally made this purchase eligible.
  if (agreements.some(a => a !== original && Date.parse(instant(a.happenedAt)) <= Date.parse(paidAt!)))
    throw new Error("agreement_change_before_original_payment");
  const evidenceRef = policy.sourceEvidenceRef;
  const lines: PurchaseLine[] = [], movements: Movement[] = [], saleIds = new Set<string>();
  const originalLines = new Set(originalSales.filter(s => s.__typename === "ProductSale")
    .map(s => shopifyId(sourceObject(s.lineItem).id, "LineItem")));
  const allowedAgreements: Record<string, string> = { OrderAgreement: "ORDER", OrderEditAgreement: "ORDER_EDIT",
    RefundAgreement: "REFUND", ReturnAgreement: "RETURN" };
  const components: Record<string, { type: string; component: Component }> = {
    SHIPPING: { type: "ShippingLineSale", component: "shipping_net" },
    DUTY: { type: "DutySale", component: "duty_net" },
    ADJUSTMENT: { type: "AdjustmentSale", component: "other_sales_adjustment" },
    FEE: { type: "FeeSale", component: "fee" },
  };
  for (const a of agreements) {
    const happenedAt = instant(a.happenedAt);
    if (!Object.hasOwn(allowedAgreements, String(a.__typename)) || allowedAgreements[String(a.__typename)] !== a.reason ||
        Date.parse(happenedAt) < Date.parse(originalAt) || Date.parse(happenedAt) > Date.parse(updatedAt) ||
        Date.parse(originalAt) < Date.parse(createdAt)) throw new Error("agreement_type_or_time");
    const sales = sourceArray(a.sales).map(sourceObject);
    if (!sales.length || sales.length > 1000) throw new Error("agreement_invalid_sales");
    for (const s of sales) {
      const id = gid(s.id), action = sourceString(s.actionType), type = sourceString(s.lineType);
      if (saleIds.has(id)) throw new Error("agreement_duplicate_sale"); saleIds.add(id);
      if (!["ORDER", "RETURN", "UPDATE"].includes(action) || (a === original && action !== "ORDER"))
        throw new Error("agreement_unknown_action");
      const total = money(s.totalAmount), tax = money(s.totalTaxAmount), discount = money(s.totalDiscountAmountBeforeTaxes);
      // After-tax discounts need an approved allocation treatment; don't assign
      // all of a tax-inclusive discount to merchandise.
      if (money(s.totalDiscountAmountAfterTaxes) !== BigInt(0)) throw new Error("agreement_after_tax_discount_review");
      const net = total - tax;
      if (action === "ORDER" && (total < BigInt(0) || tax < BigInt(0) || discount < BigInt(0)) ||
          action === "RETURN" && (total > BigInt(0) || tax > BigInt(0)))
        throw new Error("agreement_action_sign");
      const slices: Movement["slices"] = [];
      function slice(component: Component, amount: bigint, lineId: string | null, unresolved = false) {
        slices.push({ id: component, component, amount: decimal(amount), lineId,
          allocation: lineId ? "allocated" : unresolved ? "unresolved" : "order_level", reversesEntryId: null });
      }
      if (type === "PRODUCT" && s.__typename === "ProductSale") {
        const lineId = shopifyId(sourceObject(s.lineItem).id, "LineItem");
        if (!Object.hasOwn(policy.lineClasses, lineId) || policy.lineClasses[lineId] !== "merchandise")
          throw new Error("agreement_line_class_required");
        const linked = originalLines.has(lineId) ? lineId : null;
        if (action === "ORDER" || action === "UPDATE") {
          const gross = net + discount;
          if (action === "ORDER" && gross < discount) throw new Error("agreement_invalid_purchase_value");
          slice("merchandise_gross", gross, linked, !linked);
          slice("merchandise_discount", -discount, linked, !linked);
          if (a === original) {
            if (!Number.isSafeInteger(s.quantity) || (s.quantity as number) <= 0 ||
                lines.some(l => l.id === lineId)) throw new Error("agreement_original_quantity");
            const quantity = s.quantity as number;
            if (gross % BigInt(quantity) !== BigInt(0)) throw new Error("agreement_unit_rounding_review");
            lines.push({ id: lineId, quantity, itemClass: "merchandise", sku: null, productId: null,
              unitPrice: decimal(gross / BigInt(quantity)), merchandiseDiscount: decimal(discount),
              purchaseEvidenceRef: evidenceRef, offers: [] });
          }
        } else slice(action === "RETURN" ? "merchandise_refund" : "other_sales_adjustment", net, linked, !linked);
        slice("tax_net", tax, linked, !linked);
      } else {
        const spec = Object.hasOwn(components, type) ? components[type] : null;
        if (!spec || spec.type !== s.__typename) throw new Error("agreement_unsupported_sale_type");
        slice(spec.component, net, null); slice("tax_net", tax, null);
      }
      const movement: Movement = { shop, orderId, id: `shopify-agreement-sale:${id}`,
        effectiveAt: a === original ? paidAt : happenedAt, currency, sourceTotal: decimal(total),
        evidenceRef, kind: action === "ORDER" ? "sale" : action === "RETURN" ? "refund" : "adjustment",
        salesEligible: true, slices };
      normalizeLedger(movement, "agreement-validation"); movements.push(movement);
    }
  }
  if (!lines.length) throw new Error("agreement_missing_merchandise");
  const snapshot = { shop, id: orderId, createdAt, updatedAt, currency, paidAt,
    paidEvidenceRef: evidenceRef, checkoutId: null, shippingCountry: null, shippingRegion: null,
    lines, linesComplete: true };
  normalizeCommerce(snapshot, policy.decision, "agreement-validation");
  const payments = transactions.map(t => t.payment);
  payments.forEach(p => normalizePayment(p, "agreement-validation"));
  return { snapshot, decision: policy.decision, movements, payments, evidenceRef };
}
