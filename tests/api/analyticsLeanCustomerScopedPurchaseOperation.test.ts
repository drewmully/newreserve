import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { compileCustomerOperationPacket, validateCustomerSourceOperation, CUSTOMER_OPERATION_PACKET_KIND,
  type CustomerSourceOperation } from "@/lib/analytics/customerScopedPurchaseOperation";
import { CUSTOMER_SOURCE_READER_SHA256 } from "@/lib/analytics/customerScopedPurchasePacket";
import { captureSalesEventCustomers } from "@/lib/analytics/salesEventCustomerCapture";
import { CUSTOMER_PURCHASE_ACCESS_QUERY, CUSTOMER_PURCHASE_COUNT_QUERY, CUSTOMER_PURCHASE_PAGE_QUERY } from "@/lib/analytics/customerScopedPurchaseSource";
import { SHOPIFY_FINANCIAL_CUSTOMER_QUERY, sourceObject } from "@/lib/analytics/shopifySource";
import { bindSalesEventWindow, prepareSalesEventWindowReport, prepareSalesEventWindowRegistration } from "@/lib/analytics/salesEventWindowPreparation";
import { salesEventLocatorQuery, paymentEventLocatorQuery, SALES_EVENT_SHOP_QUERY, type RetainedEventJson } from "@/lib/analytics/salesEventWindowInput";
import { runtimeSource } from "../fixtures/analyticsRetainedRuntime";
import { fullFixture } from "../fixtures/analyticsFull";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const shop = "mullybox-store.myshopify.com", at = "2026-10-08T12:00:00.000Z", day = "2026-10-07";
function operation(): CustomerSourceOperation {
  return { operationId: "00000000-0000-4000-8000-000000000009", approvalRef: "fixture:one-read",
    actorRef: "fixture:operator", projectRef: "xnfjdbpjuaezxjgargto", shop, reportDate: day,
    startedAt: at, deadline: "2026-10-08T12:05:00.000Z", authorizationRef: "fixture:purchase-processing",
    appId: "gid://shopify/App/1", installationId: "gid://shopify/AppInstallation/2",
    sourceReaderSha256: CUSTOMER_SOURCE_READER_SHA256, sourceReaderEmissionSha256: sha("synthetic reader"),
    captureClosureSha256: sha("synthetic closure"), maxRequests: 65, maxResponseBytes: 1048576,
    maxTotalBytes: 16777216, maxActiveMs: 120000 };
}
function fixture() {
  const c = operation(), native = runtimeSource(), order = native.commerce.order;
  native.commerce.shop = shop; native.commerce.projection = "financial_customer_id";
  order.customer = { id: "gid://shopify/Customer/90" };
  order.createdAt = `${day}T12:00:00Z`; order.updatedAt = `${day}T12:02:00Z`;
  native.financial.updatedAt = order.updatedAt;
  const tx = sourceObject((order.transactions as unknown[])[0]);
  tx.createdAt = `${day}T12:00:00Z`; tx.processedAt = `${day}T12:01:00Z`;
  const line = sourceObject((sourceObject(order.lineItems).nodes as unknown[])[0]);
  line.product = { id: "gid://shopify/Product/8501257044160" };
  const retain = (value: unknown): RetainedEventJson => {
    const json = JSON.stringify(value);
    return { json, sha256: sha(json), evidenceRef: "fixture:retained", startedAt: at, finishedAt: at };
  };
  const salesNames = ["order_id", "second", "is_sales_reversal", "orders", "quantity_ordered", "reversed_quantity",
    "gross_sales", "discounts", "sales_reversals", "net_sales", "shipping_charges", "taxes", "duties", "additional_fees", "total_sales"];
  const paymentNames = ["order_id", "transaction_id", "second", "payment_gateway", "transaction_kind", "transaction_status",
    "transaction_currency", "gross_payments", "refunded_payments", "net_payments", "transactions"];
  const query = salesEventLocatorQuery(day, day);
  const source = bindSalesEventWindow({ version: 1,
    scope: { projectRef: c.projectRef, shop, fromDate: day, throughDate: day,
      sourceTimezone: "America/New_York", sourceCurrency: "USD" },
    locator: { ...retain({ sourceType: "shopify_connector", startedAt: at, finishedAt: at, query,
      result: { structured_content: { query, shopDomain: shop, chartHint: { currencyCode: "USD" },
        columns: salesNames.map((name, i) => ({ name, dataType: i === 0 ? "IDENTITY" : i === 1 ? "SECOND_TIMESTAMP" :
          i === 2 ? "BOOLEAN" : i < 6 ? "INTEGER" : "MONEY" })),
        rows: [["1", tx.processedAt, "false", "1", "2", "0", "20", "-2", "0", "18", "0", "4", "0", "0", "22"]], rowCount: 1 } } }),
      sourceType: "shopify_connector", apiVersion: null },
    paymentControls: { ...retain({ shopDomain: shop,
      columns: paymentNames.map((name, i) => ({ name, dataType: i < 2 ? "IDENTITY" : i === 2 ? "SECOND_TIMESTAMP" :
        i < 7 ? "STRING" : i === 10 ? "INTEGER" : "MONEY" })),
      results: [{ query: paymentEventLocatorQuery(day), rowCount: 1,
        rows: [["1", "4", tx.processedAt, "fixture", "sale", "success", "USD", "22", "0", "22", "1"]] }] }),
      sourceType: "shopify_connector", apiVersion: null, captureBasis: "recorded_interval" },
    metadata: retain({ projectRef: c.projectRef, shop, cutoff: at, metadataOnly: true,
      completeOriginalPopulation: false, financialHydrationComplete: false,
      orders: [{ id: order.id, createdAt: order.createdAt, updatedAt: order.updatedAt }] }),
    sources: [{ source: retain(native), sourceType: "native_shopify", apiVersion: "2026-07" }],
    businessPolicy: { decision: { eligibility: "eligible", commerceSource: "other", acquisitionEligible: false,
      approvalRef: "fixture:catalog" }, productClasses: { "8501257044160": "merchandise" },
      financialApprovalRef: "fixture:finance", saleClock: "paid_at", refundClock: "refund_created_at" } });
  let time = Date.parse(at), calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    expect(String(url)).toBe(`https://${shop}/admin/api/2026-07/graphql.json`);
    const { query: q } = JSON.parse(String(init?.body)); calls++; time += 10;
    let data: unknown;
    if (q === CUSTOMER_PURCHASE_ACCESS_QUERY) data = { shop: { myshopifyDomain: shop },
      currentAppInstallation: { id: c.installationId, app: { id: c.appId },
        accessScopes: ["read_orders", "read_all_orders", "read_customers", "read_products"].map(handle => ({ handle })) } };
    else if (q === CUSTOMER_PURCHASE_COUNT_QUERY) data = { ordersCount: { count: 1, precision: "EXACT" } };
    else if (q === CUSTOMER_PURCHASE_PAGE_QUERY) data = { orders: {
      nodes: [{ id: order.id, customer: order.customer, createdAt: order.createdAt, updatedAt: order.updatedAt }],
      pageInfo: { hasNextPage: false, endCursor: null } } };
    else { expect(q).toBe(SHOPIFY_FINANCIAL_CUSTOMER_QUERY); data = { order }; }
    return new Response(JSON.stringify({ data }), { headers: { "X-Shopify-API-Version": "2026-07" } });
  };
  const now = () => new Date(time).toISOString();
  return { c, native, source, fetcher, now, calls: () => calls };
}

it("runs unchanged reader through direct-operation capture, customer consumer and standalone report/registration", async () => {
  const f = fixture(), capture = await captureSalesEventCustomers({ source: f.source, operation: f.c,
    accessToken: "fixture:secret", fetcher: f.fetcher, now: f.now });
  expect(capture.state).toBe("source_complete");
  if (capture.state !== "source_complete") throw Error("fixture capture held");
  const packet = JSON.parse(capture.customers.packetJson);
  expect(packet.kind).toBe(CUSTOMER_OPERATION_PACKET_KIND);
  expect(packet).not.toHaveProperty("cycle"); expect(packet).not.toHaveProperty("bundleSha256");
  expect(packet.sharedUsage.requests).toBe(8); expect(f.calls()).toBe(8);
  expect(packet.source.requests).toBe(8);
  expect(JSON.stringify(capture)).not.toContain("fixture:secret");
  const { digest, ...body } = f.source; void digest;
  const source = bindSalesEventWindow({ ...body, customers: capture.customers });
  const policy = { ...fullFixture().policy, behaviorMode: "excluded" as const, asOf: f.now() };
  const report = prepareSalesEventWindowReport({ source, policy, publication: "full:fixture-operation" });
  expect(report.sourceBinding.scopedCustomers?.orders[0].status).toBe("first_observable");
  expect(report.result.reports.store_daily[0]).toMatchObject({ total_sales_usd: "22.000000", new_customers: 1,
    eligible_orders: 1, collected_cash_usd: null, spend_usd: null, ncac_usd: null });
  expect(report.operatingAuthority).toBeNull(); expect(report.fullStoreFinancialPopulation).toBe(false);
  expect(report.sourceBinding.scopedCustomers?.wholeDayCustomerCoverage).toBe(false);
  const prepared = prepareSalesEventWindowRegistration({ source, policy, runId: "fixture-operation", baseRunId: "fixture-base",
    authority: { approvalRef: "fixture:register-separate", actorRef: "fixture:operator", readyAt: f.now(),
      expiresAt: "2026-10-08T12:01:00.000Z", maxAgeSeconds: 120 } });
  expect(prepared.registration.args.p_scope.spendRuns).toEqual([]);
  expect(prepared.registration.args.p_scope.source.customers?.binding.operation).toEqual(f.c);
  expect(prepared).toMatchObject({ enabled: false, registered: false, metricAcceptance: false });
});

it.each(["approval", "actor", "grant", "cap", "deadline", "old-bundle", "reader", "both"])
("refuses %s before starting a source read", async kind => {
  const f = fixture();
  if (kind === "approval") f.c.approvalRef = "UNSET";
  if (kind === "actor") f.c.actorRef = "";
  if (kind === "grant") Object.assign(f.c, { grantId: "old-cycle" });
  if (kind === "cap") Object.assign(f.c, { maxRequests: 66 });
  if (kind === "deadline") f.c.deadline = "2026-10-08T12:05:00.001Z";
  if (kind === "old-bundle") f.c.captureClosureSha256 = "f86edbdd17b8c30b5baf0659171ac869e23f2b4a73f3660b4db7267a6b393f20";
  if (kind === "reader") Object.assign(f.c, { sourceReaderSha256: "0".repeat(64) });
  const options = { source: f.source, operation: f.c, accessToken: "fixture:secret", fetcher: f.fetcher, now: f.now };
  if (kind === "both") Object.assign(options, { cycle: {} });
  expect((await captureSalesEventCustomers(options)).state).toBe("held");
  expect(f.calls()).toBe(0);
});

it("keeps unknown customers null without a packet, not a zero or marketing dependency", () => {
  const f = fixture();
  const report = prepareSalesEventWindowReport({ source: f.source,
    policy: { ...fullFixture().policy, behaviorMode: "excluded", asOf: at }, publication: "fixture:no-customer" });
  expect(report.result.reports.store_daily[0].total_sales_usd).toBe("22.000000");
  expect(report.result.reports.store_daily[0].new_customers).toBeNull();
});

it("refuses operation identity, receipt or budget changes after actual synthetic capture", async () => {
  const f = fixture(), capture = await captureSalesEventCustomers({ source: f.source, operation: f.c,
    accessToken: "fixture:secret", fetcher: f.fetcher, now: f.now });
  if (capture.state !== "source_complete") throw Error("fixture capture held");
  const p = JSON.parse(capture.customers.packetJson);
  const input = { source: p.source, operation: p.operation, identityReceipt: p.identityReceipt, sharedUsage: p.sharedUsage,
    definition: { definition: capture.customers.binding.definition, businessEvidence: capture.customers.binding.businessEvidence } };
  for (const field of ["requests", "identity", "retained", "flag", "source-revision"]) {
    const x = structuredClone(input);
    if (field === "requests") x.sharedUsage.requests = x.source.requests - 1;
    if (field === "identity") x.identityReceipt.appId = "gid://shopify/App/3";
    if (field === "retained") x.source.members[0].sources[0].hydration = "retained";
    if (field === "flag") x.source.productionAdmission = true;
    if (field === "source-revision") x.source.members[0].sources[0].document.order.updatedAt = at;
    expect(() => compileCustomerOperationPacket(x)).toThrow();
  }
  expect(() => validateCustomerSourceOperation({ ...f.c, reportDate: "2026-10-08" })).toThrow();
});

it.each(["valid", "missing", "currency", "timezone", "query", "double-newline", "wrong-shop"])
("binds actual native shop metadata for current connector shape: %s", kind => {
  const f = fixture(), receipt = JSON.parse(f.source.locator.json);
  delete receipt.result.structured_content.chartHint;
  receipt.query = receipt.query.slice(0, -1);
  receipt.result.structured_content.query = receipt.query;
  if (kind === "double-newline") receipt.result.structured_content.query += "\n\n";
  f.source.locator.json = JSON.stringify(receipt); f.source.locator.sha256 = sha(f.source.locator.json);
  const value = { data: { shop: { myshopifyDomain: kind === "wrong-shop" ? "other.myshopify.com" : shop,
    currencyCode: kind === "currency" ? "EUR" : "USD", ianaTimezone: kind === "timezone" ? "UTC" : "America/New_York" } } };
  const json = JSON.stringify(value);
  f.source.shopMetadata = { json, sha256: sha(json), evidenceRef: "fixture:actual-query", startedAt: at, finishedAt: at,
    sourceType: "native_shopify", apiVersion: "2026-07", query: kind === "query" ? "other-query" : SALES_EVENT_SHOP_QUERY };
  if (kind === "missing") delete f.source.shopMetadata;
  const { digest, ...body } = f.source; void digest;
  const input = { source: bindSalesEventWindow(body), policy: { ...fullFixture().policy, behaviorMode: "excluded" as const, asOf: at },
    publication: "fixture:connector-shape" };
  if (kind === "valid") expect(prepareSalesEventWindowReport(input).result.reports.store_daily[0].total_sales_usd).toBe("22.000000");
  else expect(() => prepareSalesEventWindowReport(input)).toThrow();
});
