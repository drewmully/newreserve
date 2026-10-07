import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evidenceDigest } from "@/lib/analytics/evidenceIntake";
import { key } from "@/lib/analytics/primitives";
import { consumeScopedCustomerPurchases, SCOPED_CUSTOMER_BUSINESS_EVIDENCE, SCOPED_CUSTOMER_DEFINITION,
  type ScopedCustomerPurchaseBinding, type ScopedCustomerPurchaseTarget } from "@/lib/analytics/customerScopedPurchaseConsumer";
import { CUSTOMER_PURCHASE_SCHEMA, CUSTOMER_PURCHASE_COUNT_QUERY, CUSTOMER_PURCHASE_PAGE_QUERY,
  type CustomerPurchaseObservation } from "@/lib/analytics/customerScopedPurchaseSource";
import { SHOPIFY_FINANCIAL_CUSTOMER_QUERY, type ShopifyOrderDocument } from "@/lib/analytics/shopifySource";

const shop = "mullybox-store.myshopify.com", projectRef = "xnfjdbpjuaezxjgargto";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const gid = (kind: string, id: number) => `gid://shopify/${kind}/${id}`;
const startedAt = "2026-10-07T06:52:29.188Z", capturedAt = "2026-10-07T06:52:35.501Z";
const merchandise = "gid://shopify/Product/8501257044160", annual = "gid://shopify/Product/8501257175232";
const money = { shopMoney: { amount: "10.00", currencyCode: "USD" } };
function document(id: number, customer: number, paidAt: string, product: string | null): ShopifyOrderDocument {
  return { shop, apiVersion: "2026-07", projection: "financial_customer_id", order: {
    id: gid("Order", id), customer: { id: gid("Customer", customer) }, createdAt: paidAt,
    updatedAt: "2026-10-07T01:00:00Z", currencyCode: "USD", edited: false, taxesIncluded: false,
    test: false, cancelledAt: null, originalTotalPriceSet: money, subtotalPriceSet: money,
    transactionsCount: { count: 1, precision: "EXACT" }, transactions: [{ id: gid("OrderTransaction", id),
      kind: "SALE", status: "SUCCESS", gateway: "fixture", test: false, createdAt: paidAt, processedAt: paidAt,
      amountSet: money, parentTransaction: null }],
    lineItems: { nodes: [{ id: gid("LineItem", id), sku: null, quantity: 1, isGiftCard: false,
      product: product ? { id: product } : null, originalUnitPriceSet: money, originalTotalSet: money, discountAllocations: [] }],
    pageInfo: { hasNextPage: false, endCursor: null } },
  } };
}
function packet() {
  const documents = [
    document(1, 90, "2023-08-26T18:39:24Z", null),
    document(2, 90, "2026-06-24T19:17:18Z", merchandise),
    document(3, 90, "2026-09-29T06:12:04Z", merchandise),
    document(4, 91, "2026-09-29T13:55:02Z", merchandise),
    document(5, 91, "2026-10-02T15:29:51Z", annual),
  ];
  const members = [90, 91].map(owner => {
    const docs = documents.filter(d => (d.order.customer as { id: string }).id === gid("Customer", owner));
    const rows = docs.map(d => ({ id: String(d.order.id), customerGid: gid("Customer", owner),
      createdAt: String(d.order.createdAt), updatedAt: String(d.order.updatedAt) }));
    const inventory = { count: rows.length, pages: [{ cursor: null, endCursor: null, hasNextPage: false, orders: rows }], orders: rows };
    return { customerGid: gid("Customer", owner), inventory, recheck: structuredClone(inventory),
      sources: docs.map(d => ({ document: d, documentDigest: evidenceDigest(d),
        capturedAt, sourceRef: `observed-customer-order:sha256:${evidenceDigest(d)}`, hydration: "read" as const,
        successfulPayments: [{ transactionGid: gid("OrderTransaction", Number(String(d.order.id).split("/").at(-1))),
          kind: "sale" as const, processedAt: String(d.order.createdAt) }], requiresOriginalPurchaseReview: false })) };
  });
  const source = {
    schemaVersion: CUSTOMER_PURCHASE_SCHEMA, scope: { projectRef, shop, authorizationRef: "fixture:current-source-read",
      appId: gid("App", 1), installationId: gid("AppInstallation", 2), expiresAt: "2026-10-07T06:54:00Z",
      members: [{ customerGid: gid("Customer", 90), anchorOrderGids: [gid("Order", 3)] },
        { customerGid: gid("Customer", 91), anchorOrderGids: [gid("Order", 4)] }], maxRequests: 64, maxBytes: 16775000 },
    startedAt, capturedAt, requests: 20, responseBytes: 2000,
    queryHashes: { inventory: evidenceDigest(CUSTOMER_PURCHASE_PAGE_QUERY), count: evidenceDigest(CUSTOMER_PURCHASE_COUNT_QUERY),
      hydration: evidenceDigest(SHOPIFY_FINANCIAL_CUSTOMER_QUERY) }, members,
    coverage: "current_shopify_customer_membership", pagination: "exhausted_and_rechecked",
    historicalOwnership: "not_asserted", deletedOrderCoverage: "not_asserted", migrationCoverage: "not_asserted",
    productionAdmission: false,
  } as Omit<CustomerPurchaseObservation, "digest">;
  return { version: 1, kind: "b1-sep29-customer-source-only", bindingSha256: "a".repeat(64),
    identitySha256: "b".repeat(64), bundleSha256: "f86edbdd17b8c30b5baf0659171ac869e23f2b4a73f3660b4db7267a6b393f20",
    source: { ...source, digest: evidenceDigest(source) }, retainedSourceReceipts: [],
    sharedUsage: { requests: 21, responseBytes: 2200, activeMs: 6609 }, sourceOnly: true,
    productionAdmission: false, customerOwnershipAccepted: false, financialMappingApproved: false,
    certified: false, registered: false, enabled: false };
}
type Packet = ReturnType<typeof packet>;
function bind(p: Packet, raw = JSON.stringify(p)): ScopedCustomerPurchaseBinding {
  const s = p.source;
  return { version: 1, packetSha256: sha(raw), sourceDigest: s.digest, bindingSha256: p.bindingSha256,
    identitySha256: p.identitySha256, projectRef: s.scope.projectRef, shop: s.scope.shop,
    authorizationRef: s.scope.authorizationRef, appId: s.scope.appId, installationId: s.scope.installationId,
    startedAt: s.startedAt, capturedAt: s.capturedAt, definition: SCOPED_CUSTOMER_DEFINITION,
    businessEvidence: { ...SCOPED_CUSTOMER_BUSINESS_EVIDENCE } };
}
function target(p: Packet, orderGid: string): ScopedCustomerPurchaseTarget {
  const s = p.source.members.flatMap(m => m.sources).find(s => s.document.order.id === orderGid)!;
  return { orderGid, customerGid: (s.document.order.customer as { id: string }).id,
    createdAt: String(s.document.order.createdAt), updatedAt: String(s.document.order.updatedAt),
    documentDigest: s.documentDigest };
}
function input(p = packet(), ids = [gid("Order", 3), gid("Order", 4)]) {
  return { packetJson: JSON.stringify(p), binding: bind(p), targets: ids.map(id => target(p, id)) };
}
function rehash(p: Packet) {
  const { digest, ...payload } = p.source;
  void digest;
  p.source.digest = evidenceDigest(payload);
  return p;
}
function rehashDocument(p: Packet, member = 0, order = 0) {
  const s = p.source.members[member].sources[order];
  s.documentDigest = evidenceDigest(s.document);
  if (s.hydration === "read") s.sourceRef = `observed-customer-order:sha256:${s.documentDigest}`;
  return rehash(p);
}
describe("scoped customer consumer", () => {
  it("keeps positive returning with unknown exact first; annual access is not merchandise repeat", () => {
    const r = consumeScopedCustomerPurchases(input(packet(), [gid("Order", 3), gid("Order", 4), gid("Order", 5)]));
    expect(r.orders.map(o => o.status)).toEqual(["returning", "first_observable", "not_eligible"]);
    expect(r.orders[0]).toMatchObject({ firstEligibleOrderGid: null, firstEligiblePaidAt: null,
      priorEligibleOrderGid: gid("Order", 2), priorEligiblePaidAt: "2026-06-24T19:17:18Z" });
    expect(r.orders[1]).toMatchObject({ firstEligibleOrderGid: gid("Order", 4), purchaseDate: "2026-09-29" });
    expect(r.orders[2].reason).toBe("retained_annual_access_only_business_classification");
    expect(r).toMatchObject({ productionAdmission: false, wholeDayCustomerCoverage: false, cohortCoverage: false,
      ltvEvidence: false, originalHistoricalOwnershipAsserted: false, browserPermissionAsserted: false, customerGeneration: null });
    expect(r).not.toHaveProperty("newCustomers"); expect(r).not.toHaveProperty("ncac");
    const { digest, ...body } = r; expect(digest).toBe(evidenceDigest(body));
  });
  it("uses paid clocks, not new-customer exclusion from an acquisition flag", () => {
    // The existing mapper receives acquisitionEligible=false internally, yet the
    // selected paid first purchase remains first_observable under this definition.
    const r = consumeScopedCustomerPurchases(input());
    expect(r.orders[1].status).toBe("first_observable");
    expect(r.orders[0].purchaseDate).toBe("2026-09-29");
    expect(r.bindingDigest).toBe(evidenceDigest(input().binding));
    expect(r.targetsDigest).toBe(evidenceDigest(input().targets));
  });
  it.each(["packet", "owner", "revision", "document", "duplicate", "uncovered"])("refuses changed %s target binding", kind => {
    const v = input();
    if (kind === "packet") v.packetJson += " ";
    if (kind === "owner") v.targets[0].customerGid = gid("Customer", 91);
    if (kind === "revision") v.targets[0].updatedAt = "2026-10-07T02:00:00Z";
    if (kind === "document") v.targets[0].documentDigest = "c".repeat(64);
    if (kind === "duplicate") v.targets.push(v.targets[0]);
    if (kind === "uncovered") v.targets[0].orderGid = gid("Order", 999);
    expect(() => consumeScopedCustomerPurchases(v)).toThrow();
  });
  it.each(["owner", "revision", "digest", "recheck", "page", "count", "over100", "capture", "extra_contact"])
  ("refuses internally inconsistent %s evidence even after envelope rehash", kind => {
    const p = packet(), m = p.source.members[0], s = m.sources[0];
    if (kind === "owner") s.document.order.customer = { id: gid("Customer", 91) };
    if (kind === "revision") s.document.order.updatedAt = "2026-10-07T02:00:00Z";
    if (kind === "digest") s.documentDigest = "c".repeat(64);
    if (kind === "recheck") m.recheck.orders[0].updatedAt = "2026-10-07T02:00:00Z";
    if (kind === "page") m.inventory.pages[0].hasNextPage = true;
    if (kind === "count") m.inventory.count++;
    if (kind === "over100") m.inventory.count = 101;
    if (kind === "capture") s.capturedAt = "2026-10-07T06:53:00Z";
    if (kind === "extra_contact") s.document.order.email = "fixture@example.invalid";
    if (["owner", "revision", "extra_contact"].includes(kind)) rehashDocument(p);
    rehash(p);
    expect(() => consumeScopedCustomerPurchases(input(p))).toThrow();
  });
  it.each(["definition", "catalog", "authorization", "whole_store", "production", "query"])
  ("refuses %s scope expansion", kind => {
    const p = packet(), v = input(p);
    if (kind === "definition") v.binding.definition = "made-up" as typeof SCOPED_CUSTOMER_DEFINITION;
    if (kind === "catalog") v.binding.businessEvidence = { ...SCOPED_CUSTOMER_BUSINESS_EVIDENCE,
      merchandiseReceiptSha256: "0".repeat(64) } as typeof SCOPED_CUSTOMER_BUSINESS_EVIDENCE;
    if (kind === "authorization") v.binding.authorizationRef = "another-scope";
    if (kind === "whole_store") p.source.coverage = "whole_store" as CustomerPurchaseObservation["coverage"];
    if (kind === "production") p.productionAdmission = true;
    if (kind === "query") p.source.queryHashes.inventory = "0".repeat(64);
    if (["whole_store", "production", "query"].includes(kind)) {
      rehash(p); Object.assign(v, input(p));
    }
    expect(() => consumeScopedCustomerPurchases(v)).toThrow();
  });
  it("withholds exact first when earlier product is unknown, not when only a later product is unknown", () => {
    const p = packet();
    p.source.members[0].sources[1].document.order.lineItems = structuredClone(
      p.source.members[0].sources[0].document.order.lineItems);
    rehashDocument(p, 0, 1);
    expect(consumeScopedCustomerPurchases(input(p)).orders[0]).toMatchObject({
      status: "unresolved", firstEligibleOrderGid: null, priorEligibleOrderGid: null });
    const q = packet(), later = q.source.members[1].sources[1];
    (later.document.order.lineItems as { nodes: { product: unknown }[] }).nodes[0].product = null;
    rehashDocument(q, 1, 1);
    expect(consumeScopedCustomerPurchases(input(q)).orders[1].status).toBe("first_observable");
  });
  it("does not let an edited earlier order establish or erase a known later prior witness", () => {
    const p = packet();
    p.source.members[0].sources[0].document.order.edited = true;
    p.source.members[0].sources[0].requiresOriginalPurchaseReview = true;
    rehashDocument(p);
    const result = consumeScopedCustomerPurchases(input(p));
    expect(result.orders[0]).toMatchObject({ status: "returning", firstEligibleOrderGid: null,
      priorEligibleOrderGid: gid("Order", 2) });
  });
  it("refuses a forged successful payment clock rather than trusting its summary", () => {
    const p = packet();
    p.source.members[1].sources[0].successfulPayments[0].processedAt = "2020-01-01T00:00:00Z";
    rehash(p);
    expect(() => consumeScopedCustomerPurchases(input(p))).toThrow("payment_proof");
  });
  it("does not call a partly paid target a first purchase", () => {
    const p = packet(), s = p.source.members[1].sources[0];
    (s.document.order.transactions as { amountSet: unknown }[])[0].amountSet =
      { shopMoney: { amount: "5.00", currencyCode: "USD" } };
    rehashDocument(p, 1, 0);
    expect(consumeScopedCustomerPurchases(input(p)).orders[1]).toMatchObject({
      status: "unresolved", paidAt: null, firstEligibleOrderGid: null });
  });
  it("keeps missing earlier payment clock unknown while retaining a demonstrated prior witness", () => {
    const p = packet(), s = p.source.members[0].sources[0];
    (s.document.order.transactions as { processedAt: string | null }[])[0].processedAt = null;
    s.successfulPayments[0].processedAt = null;
    rehashDocument(p);
    expect(consumeScopedCustomerPurchases(input(p)).orders[0]).toMatchObject({
      status: "returning", firstEligibleOrderGid: null, priorEligibleOrderGid: gid("Order", 2) });
  });
  it("contains no raw commerce document, transactions, SKU or line data in output", () => {
    const result = JSON.stringify(consumeScopedCustomerPurchases(input()));
    expect(result).not.toMatch(/lineItems|transactions|email|phone|sku|accessToken/);
  });
  it("uses the existing customer builder order-key tie break for equal paid clocks", () => {
    const p = packet(), m = p.source.members[1], at = String(m.sources[0].document.order.createdAt);
    const s = m.sources[1];
    s.document.order.createdAt = at;
    (s.document.order.transactions as { createdAt: string; processedAt: string }[])[0].createdAt = at;
    (s.document.order.transactions as { processedAt: string }[])[0].processedAt = at;
    s.successfulPayments[0].processedAt = at;
    (s.document.order.lineItems as { nodes: { product: unknown }[] }).nodes[0].product = { id: merchandise };
    for (const scan of [m.inventory, m.recheck]) {
      scan.orders[1].createdAt = at; scan.pages[0].orders[1].createdAt = at;
    }
    rehashDocument(p, 1, 1);
    const expected = ["4", "5"].sort((a, b) => key(shop, a).localeCompare(key(shop, b)))[0];
    const r = consumeScopedCustomerPurchases(input(p, [gid("Order", 4), gid("Order", 5)]));
    expect(r.orders.filter(o => o.status === "first_observable").map(o => o.orderGid))
      .toEqual([gid("Order", Number(expected))]);
    expect(r.orders.filter(o => o.status === "returning")).toHaveLength(1);
  });
  const actualPath = process.env.LEAN_TEST_SCOPED_CUSTOMER_PACKET;
  it.skipIf(!actualPath)("reconciles genuine 14/2-member packet and preserves original anchor captures", () => {
    const raw = readFileSync(actualPath!, "utf8"), p = JSON.parse(raw) as Packet;
    expect(sha(raw)).toBe("e8683aaf7d01b4ed887aff0720c69697029f1ad2ad570138ace7bdf47c2d7714");
    const ids = p.source.scope.members.flatMap(m => m.anchorOrderGids);
    const r = consumeScopedCustomerPurchases({ packetJson: raw, binding: bind(p, raw), targets: ids.map(id => target(p, id)) });
    expect(r.digest).toBe("cb95c5b76d81e829499cedf354059ff256cb7fd000f95939335334b6245bf44c");
    expect(r.orders.map(o => o.status)).toEqual(["returning", "first_observable"]);
    expect(r.orders.map(o => o.observedMemberOrderCount)).toEqual([14, 2]);
    expect(r.orders[0]).toMatchObject({ firstEligibleOrderGid: null, firstEligiblePaidAt: null,
      priorEligibleOrderGid: expect.any(String), priorEligiblePaidAt: expect.any(String) });
    expect(r.orders[1].firstEligibleOrderGid).toBe(ids[1]);
    const sources = p.source.members.flatMap(m => m.sources);
    for (const row of r.orders) {
      expect(row.originalCapturedAt).toBe(sources.find(s => s.document.order.id === row.orderGid)!.capturedAt);
    }
    const annualSource = sources.find(s => (s.document.order.lineItems as { nodes: { product: { id: string } | null }[] })
      .nodes.every(line => line.product?.id === annual))!;
    const excluded = consumeScopedCustomerPurchases({ packetJson: raw, binding: bind(p, raw),
      targets: [target(p, String(annualSource.document.order.id))] }).orders[0];
    expect(excluded.status).toBe("not_eligible");
    expect(excluded.reason).toBe("retained_annual_access_only_business_classification");
    expect(r.orders[0].priorEligibleDocumentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(r.sourceDigest).toBe("78c52bc4c7dc58070bd7cb4b2bf99ca08352f2f90fc6923e4ba2594c38bc2831");
  });
});
