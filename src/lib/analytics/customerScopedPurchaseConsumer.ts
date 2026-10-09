import { createHash } from "node:crypto";
import { canonicalJson, evidenceDigest } from "./evidenceIntake";
import { key, nyDate } from "./primitives";
import { mapShopifyAnalyticsOrder, mapShopifyTransactions } from "./shopifyMapping";
import { SHOPIFY_FINANCIAL_CUSTOMER_QUERY, shopifyId, sourceObject, sourceArray } from "./shopifySource";
import { CUSTOMER_PURCHASE_SCHEMA, CUSTOMER_PURCHASE_COUNT_QUERY,
  CUSTOMER_PURCHASE_PAGE_QUERY, type CustomerPurchaseObservation, type CustomerPurchaseHeader } from "./customerScopedPurchaseSource";
import { CUSTOMER_CYCLE_PACKET_KIND, validateCustomerCyclePacket,
  type CustomerCyclePacket, type CustomerSourceCycle } from "./customerScopedPurchasePacket";
import { CUSTOMER_OPERATION_PACKET_KIND, validateCustomerOperationPacket,
  type CustomerOperationPacket, type CustomerSourceOperation } from "./customerScopedPurchaseOperation";

export const SCOPED_CUSTOMER_DEFINITION = "current-observable-shopify-merchandise-first-purchase-v1";
/** Existing business classification evidence, not renewed processing authority. */
export const SCOPED_CUSTOMER_BUSINESS_EVIDENCE = {
  merchandiseReceiptSha256: "fd3d7175227dcbda932f810d33fdf83eb9107c400e226772afbb467a891d36df",
  annualAccessReadbackSha256: "ffac14965ad0dee3744f05f3b942bb7952b9c2b9c8ff8c9ef94998d289764805",
  annualAccessApprovalSha256: "0936e436e05665ab9f712a805220bcc19d0fec30779e52bb49c5bd04805f33c7",
} as const;
export type ScopedCustomerPurchaseBinding = {
  version: 1; packetSha256: string; sourceDigest: string; bindingSha256: string; identitySha256: string;
  projectRef: string; shop: string; authorizationRef: string; appId: string; installationId: string;
  startedAt: string; capturedAt: string; definition: typeof SCOPED_CUSTOMER_DEFINITION;
  businessEvidence: typeof SCOPED_CUSTOMER_BUSINESS_EVIDENCE;
  /** Separate default-off fresh-cycle provenance; absent for the original pair. */
  cycle?: CustomerSourceCycle;
  /** A separately approved finite read, not a cycle grant. Mutually exclusive. */
  operation?: CustomerSourceOperation;
};
/** Derive from the event-window's retained commerce source, not an identity flag. */
export type ScopedCustomerPurchaseTarget = {
  orderGid: string; customerGid: string; createdAt: string; updatedAt: string; documentDigest: string;
};
type OrderProof = {
  orderGid: string; customerGid: string; documentDigest: string; sourceRef: string;
  capturedAt: string; createdAt: string; updatedAt: string; paidAt: string | null;
  disposition: "eligible_merchandise" | "excluded_test" | "excluded_cancelled" |
    "excluded_annual_access" | "not_paid" | "unresolved";
  reason: string;
};
export type ScopedCustomerPurchaseResult = {
  version: 1; definition: typeof SCOPED_CUSTOMER_DEFINITION;
  packetSha256: string; sourceDigest: string; bindingDigest: string; targetsDigest: string;
  projectRef: string; shop: string; authorizationRef: string;
  sourceStartedAt: string; sourceCapturedAt: string;
  coverage: "selected_orders_with_complete_current_observable_customer_inventory";
  orders: (ScopedCustomerPurchaseTarget & {
    status: "returning" | "first_observable" | "unresolved" | "not_eligible";
    reason: string; paidAt: string | null; purchaseDate: string | null;
    sourceRef: string; originalCapturedAt: string; observedMemberOrderCount: number;
    firstEligibleOrderGid: string | null; firstEligiblePaidAt: string | null;
    priorEligibleOrderGid: string | null; priorEligiblePaidAt: string | null;
    priorEligibleDocumentDigest: string | null;
  })[];
  sourceOnly: true; productionAdmission: false; wholeDayCustomerCoverage: false;
  cohortCoverage: false; ltvEvidence: false; originalHistoricalOwnershipAsserted: false;
  browserPermissionAsserted: false; customerGeneration: null; digest: string;
};
type OriginalPacket = {
  version: 1; kind: "b1-sep29-customer-source-only"; bindingSha256: string; identitySha256: string; bundleSha256: string;
  source: CustomerPurchaseObservation;
  retainedSourceReceipts: { assetId: string; sourceSha256: string; startedAt: string;
    finishedAt: string; hashAlgorithm: string }[];
  sharedUsage: { requests: number; responseBytes: number; activeMs: number };
  sourceOnly: true; productionAdmission: false; customerOwnershipAccepted: false;
  financialMappingApproved: false; certified: false; registered: false; enabled: false;
};
type Packet = OriginalPacket | CustomerCyclePacket | CustomerOperationPacket;
const bundle = "f86edbdd17b8c30b5baf0659171ac869e23f2b4a73f3660b4db7267a6b393f20";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function fail(code: string): never { throw new Error(`scoped_customer_${code}`); }
function exact(value: object, fields: string[]) {
  if (!same(Object.keys(sourceObject(value)).sort(), [...fields].sort())) fail("fields");
}
function instant(t: string): string {
  nyDate(t);
  return t.replace(/(?:\.(\d+))?Z$/, (_, digits: string | undefined) => `.${(digits ?? "").padEnd(6, "0")}Z`);
}
const ordered = (a: OrderProof, b: OrderProof) =>
  instant(a.paidAt!).localeCompare(instant(b.paidAt!)) ||
  key("mullybox-store.myshopify.com", shopifyId(a.orderGid, "Order"))
    .localeCompare(key("mullybox-store.myshopify.com", shopifyId(b.orderGid, "Order")));

function validateInventory(scan: CustomerPurchaseObservation["members"][number]["inventory"], owner: string) {
  exact(scan, ["count", "pages", "orders"]);
  if (!Number.isSafeInteger(scan.count) || scan.count < 1 || scan.count > 100 ||
      !Array.isArray(scan.pages) || !scan.pages.length || scan.pages.length > 4 ||
      !Array.isArray(scan.orders) || scan.orders.length !== scan.count) fail("inventory");
  const seen = new Set<string>(), cursors = new Set<string>(), rows: CustomerPurchaseHeader[] = [];
  let cursor: string | null = null, previous = "";
  for (const [index, page] of scan.pages.entries()) {
    exact(page, ["cursor", "endCursor", "hasNextPage", "orders"]);
    if (page.cursor !== cursor || page.hasNextPage !== (index < scan.pages.length - 1) ||
        page.endCursor !== null && (typeof page.endCursor !== "string" || !page.endCursor || page.endCursor.length > 4096) ||
        !Array.isArray(page.orders) || !page.orders.length || page.orders.length > 25) fail("pagination");
    for (const row of page.orders) {
      exact(row, ["id", "customerGid", "createdAt", "updatedAt"]);
      shopifyId(row.id, "Order");
      if (row.customerGid !== owner || seen.has(row.id) || instant(row.createdAt) < previous ||
          instant(row.updatedAt) < instant(row.createdAt)) fail("inventory_owner_or_revision");
      previous = instant(row.createdAt); seen.add(row.id); rows.push(row);
    }
    if (page.hasNextPage && (!page.endCursor || cursors.has(page.endCursor))) fail("pagination");
    if (page.endCursor) cursors.add(page.endCursor);
    cursor = page.endCursor;
  }
  if (rows.length !== scan.count || !same([...rows].sort((a, b) => a.id.localeCompare(b.id)), scan.orders))
    fail("inventory");
}

function orderProof(item: CustomerPurchaseObservation["members"][number]["sources"][number],
  owner: string, authorizationRef: string): OrderProof {
  const doc = item.document, order = doc.order, lines = sourceArray(sourceObject(order.lineItems).nodes).map(sourceObject);
  const base = { orderGid: String(order.id), customerGid: owner, documentDigest: item.documentDigest,
    sourceRef: item.sourceRef, capturedAt: item.capturedAt, createdAt: String(order.createdAt),
    updatedAt: String(order.updatedAt), paidAt: null };
  if (typeof order.test !== "boolean" || typeof order.edited !== "boolean" ||
      typeof order.taxesIncluded !== "boolean" || item.requiresOriginalPurchaseReview !== order.edited ||
      sourceObject(sourceObject(order.lineItems).pageInfo).hasNextPage !== false || lines.length > 500) fail("order_shape");
  if (order.cancelledAt !== null) nyDate(String(order.cancelledAt));
  const txs = mapShopifyTransactions(order, doc.shop, shopifyId(order.id, "Order"), String(order.currencyCode), order.test);
  const captures = txs.filter(t => !order.test && t.payment.status === "succeeded" &&
    ["sale", "capture"].includes(t.payment.kind));
  if (!same(item.successfulPayments, captures.map(t => ({
    transactionGid: `gid://shopify/OrderTransaction/${t.payment.id}`, kind: t.payment.kind, processedAt: t.processedAt,
  })))) fail("payment_proof");
  if (captures.some(t => t.processedAt && instant(t.processedAt) > instant(String(order.updatedAt)))) fail("payment_clock");
  if (order.test) return { ...base, disposition: "excluded_test", reason: "source_test_order" };
  if (order.cancelledAt !== null) return { ...base, disposition: "excluded_cancelled", reason: "source_cancelled_order" };
  if (order.edited || order.taxesIncluded || order.currencyCode !== "USD" || !lines.length)
    return { ...base, disposition: "unresolved", reason: "original_purchase_mapping_required" };
  const lineClasses = Object.fromEntries(lines.map(line => {
    const id = shopifyId(line.id, "LineItem");
    const product = line.product === null ? null : shopifyId(sourceObject(line.product).id, "Product");
    return [id, product === "8501257044160" ? "merchandise" as const : "unknown" as const];
  }));
  // Use the existing original-purchase arithmetic and paid-clock checks.
  // Pending here is only the mapper's input, never a new business exclusion.
  const mapped = mapShopifyAnalyticsOrder(doc, { lineClasses, sourceEvidenceRef: item.sourceRef,
    decision: { eligibility: "pending", commerceSource: "other", acquisitionEligible: false,
      approvalRef: authorizationRef } }, "scoped-customer-source-only");
  const paidAt = mapped.orders[0].paid_at as string | null;
  const annualOnly = lines.every(line => line.product !== null &&
    sourceObject(line.product).id === "gid://shopify/Product/8501257175232" &&
    line.isGiftCard === false && Number.isSafeInteger(line.quantity) && Number(line.quantity) > 0);
  if (annualOnly) return { ...base, paidAt, disposition: "excluded_annual_access",
    reason: "retained_annual_access_only_business_classification" };
  if (lines.some(line => line.product === null || sourceObject(line.product).id !== "gid://shopify/Product/8501257044160" ||
      line.isGiftCard !== false)) return { ...base, paidAt, disposition: "unresolved", reason: "unresolved_product_class" };
  if (!paidAt) return { ...base, disposition: captures.length ? "unresolved" : "not_paid",
    reason: captures.length ? "paid_clock_or_full_payment_unresolved" : "no_successful_purchase_payment" };
  return { ...base, paidAt, disposition: "eligible_merchandise", reason: "known_merchandise_original_paid_purchase" };
}

/** Pure, source-pinned selected-order conclusions. The outer event-window
 * registration must authenticate this binding; self-consistent JSON is not
 * production authority. Never returns customer table rows or daily counts.
 */
export function consumeScopedCustomerPurchases(input: {
  packetJson: string; binding: ScopedCustomerPurchaseBinding; targets: ScopedCustomerPurchaseTarget[];
}): ScopedCustomerPurchaseResult {
  const b = input.binding;
  const freshCycle = Object.hasOwn(b, "cycle");
  const oneOperation = Object.hasOwn(b, "operation"), freshSource = freshCycle || oneOperation;
  if (freshCycle && oneOperation) fail("ambiguous_capture_authority");
  exact(b, ["version", "packetSha256", "sourceDigest", "bindingSha256", "identitySha256", "projectRef", "shop",
    "authorizationRef", "appId", "installationId", "startedAt", "capturedAt", "definition", "businessEvidence",
    ...(freshCycle ? ["cycle"] : []), ...(oneOperation ? ["operation"] : [])]);
  if (typeof input.packetJson !== "string" || Buffer.byteLength(input.packetJson) > 16777216 ||
      b.version !== 1 || ![b.packetSha256, b.sourceDigest, b.bindingSha256, b.identitySha256].every(hash) ||
      sha(input.packetJson) !== b.packetSha256 || b.projectRef !== "xnfjdbpjuaezxjgargto" ||
      b.shop !== "mullybox-store.myshopify.com" || b.definition !== SCOPED_CUSTOMER_DEFINITION ||
      !same(b.businessEvidence, SCOPED_CUSTOMER_BUSINESS_EVIDENCE) ||
      typeof b.authorizationRef !== "string" || !b.authorizationRef.trim() || b.authorizationRef.length > 512)
    fail("binding");
  const packet = JSON.parse(input.packetJson) as Packet, s = packet.source;
  if (oneOperation) {
    if (packet.kind !== CUSTOMER_OPERATION_PACKET_KIND || !b.operation ||
        packet.bindingSha256 !== b.bindingSha256 || packet.identitySha256 !== b.identitySha256) fail("operation_binding");
    validateCustomerOperationPacket(packet, b.operation);
  } else if (freshCycle) {
    if (packet.kind !== CUSTOMER_CYCLE_PACKET_KIND || !b.cycle ||
        packet.bindingSha256 !== b.bindingSha256 || packet.identitySha256 !== b.identitySha256) fail("fresh_cycle_binding");
    validateCustomerCyclePacket(packet, b.cycle);
  } else {
    exact(packet, ["version", "kind", "bindingSha256", "identitySha256", "bundleSha256", "source",
      "retainedSourceReceipts", "sharedUsage", "sourceOnly", "productionAdmission", "customerOwnershipAccepted",
      "financialMappingApproved", "certified", "registered", "enabled"]);
    if (packet.version !== 1 || packet.kind !== "b1-sep29-customer-source-only" || packet.bundleSha256 !== bundle ||
        packet.bindingSha256 !== b.bindingSha256 || packet.identitySha256 !== b.identitySha256 ||
        packet.sourceOnly !== true || [packet.productionAdmission, packet.customerOwnershipAccepted,
          packet.financialMappingApproved, packet.certified, packet.registered, packet.enabled].some(v => v !== false))
      fail("source_packet");
  }
  exact(s, ["schemaVersion", "scope", "startedAt", "capturedAt", "requests", "responseBytes", "queryHashes",
    "members", "coverage", "pagination", "historicalOwnership", "deletedOrderCoverage", "migrationCoverage",
    "productionAdmission", "digest"]);
  exact(s.scope, ["projectRef", "shop", "authorizationRef", "appId", "installationId", "expiresAt",
    "members", "maxRequests", "maxBytes"]);
  exact(packet.sharedUsage, ["requests", "responseBytes", "activeMs", ...(freshSource ? ["largestResponseBytes"] : [])]);
  const { digest, ...body } = s;
  if (s.schemaVersion !== CUSTOMER_PURCHASE_SCHEMA || digest !== b.sourceDigest || evidenceDigest(body) !== digest ||
      s.coverage !== "current_shopify_customer_membership" || s.pagination !== "exhausted_and_rechecked" ||
      [s.historicalOwnership, s.deletedOrderCoverage, s.migrationCoverage].some(v => v !== "not_asserted") ||
      s.productionAdmission !== false || s.startedAt !== b.startedAt || s.capturedAt !== b.capturedAt ||
      instant(s.capturedAt) < instant(s.startedAt) || instant(s.capturedAt) >= instant(s.scope.expiresAt) ||
      s.scope.projectRef !== b.projectRef || s.scope.shop !== b.shop ||
      s.scope.authorizationRef !== b.authorizationRef || s.scope.appId !== b.appId ||
      s.scope.installationId !== b.installationId || !/^gid:\/\/shopify\/App\/[1-9]\d*$/.test(b.appId) ||
      !/^gid:\/\/shopify\/AppInstallation\/[1-9]\d*$/.test(b.installationId) ||
      !same(s.queryHashes, { inventory: evidenceDigest(CUSTOMER_PURCHASE_PAGE_QUERY),
        count: evidenceDigest(CUSTOMER_PURCHASE_COUNT_QUERY), hydration: evidenceDigest(SHOPIFY_FINANCIAL_CUSTOMER_QUERY) }))
    fail("source_binding");
  if (!Number.isSafeInteger(s.requests) || s.requests < 1 || s.requests > 64 ||
      !Number.isSafeInteger(s.responseBytes) || s.responseBytes < 1 ||
      (freshSource ? packet.sharedUsage.requests < s.requests : packet.sharedUsage.requests !== s.requests + 1) ||
      packet.sharedUsage.requests > 65 ||
      !Number.isSafeInteger(packet.sharedUsage.responseBytes) ||
      (freshSource ? packet.sharedUsage.responseBytes < s.responseBytes : packet.sharedUsage.responseBytes <= s.responseBytes) ||
      packet.sharedUsage.responseBytes > 16777216 || !Number.isSafeInteger(packet.sharedUsage.activeMs) ||
      packet.sharedUsage.activeMs < 0 || packet.sharedUsage.activeMs >= 120000 ||
      Date.parse(s.capturedAt) - Date.parse(s.startedAt) > packet.sharedUsage.activeMs ||
      Date.parse(s.scope.expiresAt) - Date.parse(s.startedAt) > 900000 ||
      !Number.isSafeInteger(s.scope.maxRequests) || s.scope.maxRequests < s.requests || s.scope.maxRequests > 64 ||
      !Number.isSafeInteger(s.scope.maxBytes) || s.scope.maxBytes < s.responseBytes || s.scope.maxBytes > 16777216 ||
      !Array.isArray(s.members) || !s.members.length || s.members.length > 4 ||
      s.scope.members.length !== s.members.length || !Array.isArray(packet.retainedSourceReceipts) ||
      packet.retainedSourceReceipts.length > 4) fail("bounds");
  const memberProofs = new Map<string, OrderProof[]>(), sourceOrders = new Map<string, OrderProof>();
  const usedRetained = new Set<string>();
  for (const member of s.members) {
    exact(member, ["customerGid", "inventory", "recheck", "sources"]);
    shopifyId(member.customerGid, "Customer");
    if (memberProofs.has(member.customerGid)) fail("duplicate_member");
    validateInventory(member.inventory, member.customerGid); validateInventory(member.recheck, member.customerGid);
    if (!same(member.inventory.orders, member.recheck.orders) || !Array.isArray(member.sources) ||
        member.sources.length !== member.inventory.count) fail("incomplete_member");
    const scope = s.scope.members.filter(m => m.customerGid === member.customerGid);
    if (scope.length !== 1 || !Array.isArray(scope[0].anchorOrderGids) || !scope[0].anchorOrderGids.length ||
        scope[0].anchorOrderGids.length > 100 || new Set(scope[0].anchorOrderGids).size !== scope[0].anchorOrderGids.length ||
        scope[0].anchorOrderGids.some(id => !member.inventory.orders.some(o => o.id === id))) fail("member_scope");
    const proofs: OrderProof[] = [];
    for (const item of member.sources) {
      exact(item, ["document", "documentDigest", "capturedAt", "sourceRef", "hydration",
        "successfulPayments", "requiresOriginalPurchaseReview"]);
      const doc = item.document, order = doc.order, head = member.inventory.orders.find(o => o.id === order.id);
      exact(doc, ["shop", "apiVersion", "projection", "order"]); exact(sourceObject(order.customer), ["id"]);
      exact(order, ["id", "customer", "createdAt", "updatedAt", "currencyCode", "edited", "taxesIncluded",
        "test", "cancelledAt", "originalTotalPriceSet", "subtotalPriceSet", "transactionsCount", "transactions", "lineItems"]);
      if (!head || sourceOrders.has(head.id) || doc.shop !== b.shop || doc.apiVersion !== "2026-07" ||
          doc.projection !== "financial_customer_id" || evidenceDigest(doc) !== item.documentDigest ||
          sourceObject(order.customer).id !== member.customerGid || order.createdAt !== head.createdAt ||
          order.updatedAt !== head.updatedAt || instant(head.updatedAt) > instant(s.capturedAt) ||
          instant(String(order.updatedAt)) > instant(item.capturedAt) || instant(item.capturedAt) > instant(s.capturedAt))
        fail("document_owner_revision_or_digest");
      if (item.hydration === "read") {
        if (item.sourceRef !== `observed-customer-order:sha256:${item.documentDigest}` ||
            instant(item.capturedAt) < instant(s.startedAt)) fail("source_capture");
      } else if (item.hydration === "retained") {
        const receipt = packet.retainedSourceReceipts.filter(r =>
          item.sourceRef === `asset:${r.assetId}#sourceSha256=${r.sourceSha256}`);
        if (receipt.length !== 1 || !hash(receipt[0].sourceSha256) ||
            receipt[0].hashAlgorithm !== "SHA256(JSON.stringify(source))" ||
            receipt[0].finishedAt !== item.capturedAt || instant(receipt[0].startedAt) > instant(item.capturedAt) ||
            instant(item.capturedAt) > instant(s.startedAt) || usedRetained.has(receipt[0].assetId)) fail("retained_capture");
        exact(receipt[0], ["assetId", "sourceSha256", "startedAt", "finishedAt", "hashAlgorithm"]);
        usedRetained.add(receipt[0].assetId);
      } else fail("hydration");
      const proof = orderProof(item, member.customerGid, b.authorizationRef);
      proofs.push(proof); sourceOrders.set(head.id, proof);
    }
    memberProofs.set(member.customerGid, proofs);
  }
  if (usedRetained.size !== packet.retainedSourceReceipts.length || !Array.isArray(input.targets) ||
      !input.targets.length || input.targets.length > 400) fail("target_scope");
  const selected = new Set<string>();
  const orders: ScopedCustomerPurchaseResult["orders"] = input.targets.map(target => {
    exact(target, ["orderGid", "customerGid", "createdAt", "updatedAt", "documentDigest"]);
    const o = sourceOrders.get(target.orderGid), history = memberProofs.get(target.customerGid);
    if (!o || !history || selected.has(target.orderGid) || o.customerGid !== target.customerGid ||
        o.createdAt !== target.createdAt || o.updatedAt !== target.updatedAt || o.documentDigest !== target.documentDigest)
      fail("target_changed_or_uncovered");
    selected.add(target.orderGid);
    const eligible = history.filter(r => r.disposition === "eligible_merchandise").sort(ordered);
    const first = eligible[0];
    const earlierUnknown = first && history.some(r => r.disposition === "unresolved" &&
      (r.paidAt === null || ordered(r, first) < 0));
    const exactFirst = first && !earlierUnknown ? first : undefined;
    const prior = o.paidAt && eligible.find(r => ordered(r, o) < 0);
    const status = o.disposition === "unresolved" ? "unresolved" : o.disposition !== "eligible_merchandise"
      ? "not_eligible" : prior ? "returning" : exactFirst?.orderGid === o.orderGid ? "first_observable" : "unresolved";
    return { ...target, status, reason: status === "returning" ? "demonstrated_prior_eligible_purchase"
      : status === "first_observable" ? "no_prior_eligible_purchase_in_complete_observable_inventory"
        : status === "unresolved" && o.disposition === "eligible_merchandise" ? "earlier_purchase_eligibility_unknown" : o.reason,
    paidAt: o.paidAt, purchaseDate: o.paidAt ? nyDate(o.paidAt) : null,
    sourceRef: o.sourceRef, originalCapturedAt: o.capturedAt, observedMemberOrderCount: history.length,
    firstEligibleOrderGid: exactFirst?.orderGid ?? null, firstEligiblePaidAt: exactFirst?.paidAt ?? null,
    priorEligibleOrderGid: prior ? prior.orderGid : null, priorEligiblePaidAt: prior ? prior.paidAt : null,
    priorEligibleDocumentDigest: prior ? prior.documentDigest : null };
  });
  const result: Omit<ScopedCustomerPurchaseResult, "digest"> = {
    version: 1, definition: SCOPED_CUSTOMER_DEFINITION, packetSha256: b.packetSha256, sourceDigest: b.sourceDigest,
    bindingDigest: evidenceDigest(b), targetsDigest: evidenceDigest(input.targets),
    projectRef: b.projectRef, shop: b.shop, authorizationRef: b.authorizationRef,
    sourceStartedAt: b.startedAt, sourceCapturedAt: b.capturedAt,
    coverage: "selected_orders_with_complete_current_observable_customer_inventory", orders,
    sourceOnly: true, productionAdmission: false, wholeDayCustomerCoverage: false, cohortCoverage: false,
    ltvEvidence: false, originalHistoricalOwnershipAsserted: false, browserPermissionAsserted: false, customerGeneration: null,
  };
  return { ...result, digest: evidenceDigest(result) };
}
