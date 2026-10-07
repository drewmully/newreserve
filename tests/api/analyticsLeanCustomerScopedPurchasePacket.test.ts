import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { compileCustomerCyclePacket, validateCustomerCyclePacket, CUSTOMER_CYCLE_PACKET_KIND,
  CUSTOMER_SOURCE_READER_SHA256, type CustomerSourceCycle, type CustomerCycleIdentityReceipt,
  type CustomerCyclePacket } from "@/lib/analytics/customerScopedPurchasePacket";
import { consumeScopedCustomerPurchases, SCOPED_CUSTOMER_BUSINESS_EVIDENCE, SCOPED_CUSTOMER_DEFINITION } from "@/lib/analytics/customerScopedPurchaseConsumer";
import { readCustomerScopedPurchases, CUSTOMER_PURCHASE_ACCESS_QUERY, CUSTOMER_PURCHASE_COUNT_QUERY,
  CUSTOMER_PURCHASE_PAGE_QUERY } from "@/lib/analytics/customerScopedPurchaseSource";
import { SHOPIFY_FINANCIAL_CUSTOMER_QUERY } from "@/lib/analytics/shopifySource";
import { evidenceDigest } from "@/lib/analytics/evidenceIntake";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const shop = "mullybox-store.myshopify.com", start = Date.parse("2026-10-08T12:00:00.000Z");
const gid = (kind: string, id: number) => `gid://shopify/${kind}/${id}`;
const oldBundle = "f86edbdd17b8c30b5baf0659171ac869e23f2b4a73f3660b4db7267a6b393f20";
function cycle(): CustomerSourceCycle {
  return { cycleId: "00000000-0000-4000-8000-000000000001", grantId: "fixture-source-grant",
    grantRevision: "9007199254740993", projectRef: "xnfjdbpjuaezxjgargto", shop, reportDate: "2026-10-07",
    startedAt: new Date(start).toISOString(), deadline: new Date(start + 300000).toISOString(),
    authorizationRef: "fixture:source-cycle-read", appId: gid("App", 1), installationId: gid("AppInstallation", 2),
    sourceReaderSha256: CUSTOMER_SOURCE_READER_SHA256,
    sourceReaderEmissionSha256: sha("synthetic reader emission, not a production pin"),
    captureClosureSha256: sha("synthetic capture closure, not a production pin"),
    maxRequests: 65, maxResponseBytes: 1048576, maxTotalBytes: 16777216, maxActiveMs: 120000 };
}
/** The actual unchanged reader runs against a finite offline transport.
 * The first access exchange supplies the receipt; it is NOT another request.
 */
async function fixture(): Promise<Parameters<typeof compileCustomerCyclePacket>[0]> {
  const c = cycle(); let time = start, calls = 0, largest = 0;
  let identity: CustomerCycleIdentityReceipt | undefined;
  const money = { shopMoney: { amount: "10.00", currencyCode: "USD" } };
  const order = { id: gid("Order", 1), customer: { id: gid("Customer", 90) },
    createdAt: "2026-10-07T12:00:00Z", updatedAt: "2026-10-08T11:00:00Z", test: false,
    cancelledAt: null, edited: false, taxesIncluded: false, currencyCode: "USD",
    originalTotalPriceSet: money, subtotalPriceSet: money, transactionsCount: { count: 1, precision: "EXACT" },
    transactions: [{ id: gid("OrderTransaction", 1), kind: "SALE", status: "SUCCESS", gateway: "fixture",
      test: false, createdAt: "2026-10-07T11:59:58Z", processedAt: "2026-10-07T11:59:58Z",
      amountSet: money, parentTransaction: null }],
    lineItems: { nodes: [{ id: gid("LineItem", 1), sku: "SYNTHETIC", quantity: 1, isGiftCard: false,
      product: { id: "gid://shopify/Product/8501257044160" }, originalUnitPriceSet: money,
      originalTotalSet: money, discountAllocations: [] }], pageInfo: { hasNextPage: false, endCursor: null } } };
  const fetcher: typeof fetch = async (url, init) => {
    expect(String(url)).toBe(`https://${shop}/admin/api/2026-07/graphql.json`);
    const requestBody = String(init?.body), { query } = JSON.parse(requestBody), began = time;
    calls++; time += 12;
    let data: unknown;
    if (query === CUSTOMER_PURCHASE_ACCESS_QUERY) data = { shop: { myshopifyDomain: shop },
      currentAppInstallation: { id: c.installationId, app: { id: c.appId },
        accessScopes: ["read_orders", "read_all_orders", "read_customers", "read_products"].map(handle => ({ handle })) } };
    else if (query === CUSTOMER_PURCHASE_COUNT_QUERY) data = { ordersCount: { count: 1, precision: "EXACT" } };
    else if (query === CUSTOMER_PURCHASE_PAGE_QUERY) data = { orders: {
      nodes: [{ id: order.id, customer: order.customer, createdAt: order.createdAt, updatedAt: order.updatedAt }],
      pageInfo: { hasNextPage: false, endCursor: null } } };
    else { expect(query).toBe(SHOPIFY_FINANCIAL_CUSTOMER_QUERY); data = { order }; }
    const raw = JSON.stringify({ data }); largest = Math.max(largest, Buffer.byteLength(raw));
    if (query === CUSTOMER_PURCHASE_ACCESS_QUERY && !identity) identity = {
      startedAt: new Date(began).toISOString(), finishedAt: new Date(time).toISOString(),
      querySha256: sha(query), requestBodySha256: sha(requestBody), responseBodySha256: sha(raw),
      httpStatus: 200, apiVersion: "2026-07", shop, appId: c.appId, installationId: c.installationId,
      capabilities: { read_orders: true, write_orders: false, read_all_orders: true, read_customers: true, read_products: true },
    };
    return new Response(raw, { headers: { "X-Shopify-API-Version": "2026-07" } });
  };
  const source = await readCustomerScopedPurchases({ accessToken: "fixture-private-token", fetcher,
    now: () => new Date(time).toISOString(), plan: {
      projectRef: "xnfjdbpjuaezxjgargto", shop, authorizationRef: c.authorizationRef,
      appId: c.appId, installationId: c.installationId, expiresAt: new Date(start + 120000).toISOString(),
      members: [{ customerGid: gid("Customer", 90), anchorOrderGids: [gid("Order", 1)] }],
      maxRequests: 64, maxBytes: 16777216,
    } });
  expect(calls).toBe(source.requests);
  return { source, cycle: c, identityReceipt: identity!,
    sharedUsage: { requests: calls, responseBytes: source.responseBytes, activeMs: time - start, largestResponseBytes: largest },
    definition: { definition: SCOPED_CUSTOMER_DEFINITION, businessEvidence: { ...SCOPED_CUSTOMER_BUSINESS_EVIDENCE } } };
}
function target(source: Awaited<ReturnType<typeof fixture>>["source"]) {
  const s = source.members[0].sources[0], o = s.document.order;
  return { orderGid: String(o.id), customerGid: gid("Customer", 90), createdAt: String(o.createdAt),
    updatedAt: String(o.updatedAt), documentDigest: s.documentDigest };
}
describe("fresh customer source-only packet compiler", () => {
  it("compiles real reader output with synthetic transport; no extra identity request or old bundle stamp", async () => {
    const input = await fixture(), compiled = compileCustomerCyclePacket(input);
    const packet = JSON.parse(compiled.packetJson) as CustomerCyclePacket;
    expect(packet.kind).toBe(CUSTOMER_CYCLE_PACKET_KIND);
    expect(packet).not.toHaveProperty("bundleSha256");
    expect(compiled.packetJson).not.toContain(oldBundle);
    expect(compiled.packetJson).not.toContain("fixture-private-token");
    expect(packet.sharedUsage.requests).toBe(8);
    expect(packet.sharedUsage.requests).toBe(packet.source.requests);
    expect(packet.bindingSha256).toBe(evidenceDigest(input.cycle));
    expect(packet.identitySha256).toBe(evidenceDigest(input.identityReceipt));
    expect(compiled.binding.cycle).toEqual(input.cycle);
    expect(compiled.binding.cycle.grantRevision).toBe("9007199254740993");
    const result = consumeScopedCustomerPurchases({ ...compiled, targets: [target(input.source)] });
    expect(result.orders[0].status).toBe("first_observable");
    expect(result).toMatchObject({ sourceOnly: true, productionAdmission: false, wholeDayCustomerCoverage: false,
      cohortCoverage: false, customerGeneration: null });
  });
  it.each(["old_reader", "old_capture", "wrong_reader", "missing_pin", "numeric_revision", "overflow_revision",
    "long_cycle", "scope", "increased_cap"])
  ("refuses %s cycle provenance", async kind => {
    const x = await fixture();
    if (kind === "old_reader") x.cycle.sourceReaderEmissionSha256 = oldBundle;
    if (kind === "old_capture") x.cycle.captureClosureSha256 = oldBundle;
    if (kind === "wrong_reader") x.cycle.sourceReaderSha256 = "0".repeat(64) as typeof CUSTOMER_SOURCE_READER_SHA256;
    if (kind === "missing_pin") x.cycle.captureClosureSha256 = "";
    if (kind === "numeric_revision") x.cycle.grantRevision = 1 as unknown as string;
    if (kind === "overflow_revision") x.cycle.grantRevision = "9223372036854775808";
    if (kind === "long_cycle") x.cycle.deadline = new Date(start + 300001).toISOString();
    if (kind === "scope") x.cycle.authorizationRef = "another-authorization";
    if (kind === "increased_cap") x.cycle.maxRequests = 66 as 65;
    expect(() => compileCustomerCyclePacket(x)).toThrow();
  });
  it.each(["customers_scope", "products_scope", "shop", "app", "query", "request_hash", "response_hash", "http",
    "version", "before_reader", "after_reader"])
  ("refuses %s identity provenance", async kind => {
    const x = await fixture(), i = x.identityReceipt;
    if (kind === "customers_scope") i.capabilities.read_customers = false;
    if (kind === "products_scope") i.capabilities.read_products = false;
    if (kind === "shop") i.shop = "other.myshopify.com";
    if (kind === "app") i.appId = gid("App", 3);
    if (kind === "query") i.querySha256 = "0".repeat(64);
    if (kind === "request_hash") i.requestBodySha256 = "0".repeat(64);
    if (kind === "response_hash") i.responseBodySha256 = "";
    if (kind === "http") i.httpStatus = 201 as 200;
    if (kind === "version") i.apiVersion = "2026-10" as "2026-07";
    if (kind === "before_reader") i.startedAt = new Date(start - 1).toISOString();
    if (kind === "after_reader") i.finishedAt = new Date(start + 1000).toISOString();
    expect(() => compileCustomerCyclePacket(x)).toThrow();
  });
  it.each(["requests", "undercount", "response", "bytes", "active", "deadline"])
  ("refuses exhausted %s budget without inventing another allowance", async kind => {
    const x = await fixture();
    if (kind === "requests") x.sharedUsage.requests = 66;
    if (kind === "undercount") x.sharedUsage.requests = x.source.requests - 1;
    if (kind === "response") {
      x.sharedUsage.largestResponseBytes = 1048577;
      x.sharedUsage.responseBytes = 2097152;
    }
    if (kind === "bytes") x.sharedUsage.responseBytes = 16777217;
    if (kind === "active") x.sharedUsage.activeMs = 120000;
    if (kind === "deadline") x.cycle.deadline = x.source.capturedAt;
    expect(() => compileCustomerCyclePacket(x)).toThrow();
  });
  it("refuses a changed expected cycle or old receipt reuse", async () => {
    const x = await fixture(), c = compileCustomerCyclePacket(x), p = JSON.parse(c.packetJson) as CustomerCyclePacket;
    expect(() => validateCustomerCyclePacket(p, { ...x.cycle, grantRevision: "2" })).toThrow("cycle");
    x.source.members[0].sources[0].hydration = "retained";
    const { digest, ...payload } = x.source; void digest;
    x.source.digest = evidenceDigest(payload);
    expect(() => compileCustomerCyclePacket(x)).toThrow("source_provenance");
  });
  it("keeps fresh and Sep29 consumer branches disjoint", async () => {
    const x = await fixture(), c = compileCustomerCyclePacket(x), p = JSON.parse(c.packetJson);
    const { cycle: discarded, ...oldBinding } = c.binding; void discarded;
    expect(() => consumeScopedCustomerPurchases({ ...c, binding: oldBinding, targets: [target(x.source)] })).toThrow();
    const next = compileCustomerCyclePacket(x);
    p.kind = "b1-sep29-customer-source-only"; p.bundleSha256 = oldBundle;
    next.packetJson = JSON.stringify(p); next.binding.packetSha256 = sha(next.packetJson);
    expect(() => consumeScopedCustomerPurchases({ ...next, targets: [target(x.source)] })).toThrow("fresh_cycle_binding");
  });
  it("refuses an older anchor revision at the fresh consumer boundary instead of reusing it", async () => {
    const x = await fixture(), c = compileCustomerCyclePacket(x);
    const stale = { ...target(x.source), updatedAt: "2026-10-07T01:00:00Z" };
    expect(() => consumeScopedCustomerPurchases({ ...c, targets: [stale] })).toThrow("target_changed_or_uncovered");
    x.source.startedAt = "2026-10-07T12:00:00Z";
    expect(() => compileCustomerCyclePacket(x)).toThrow("source_cycle");
  });
});
