/** Source-shaped SYNTHETIC records, not downloaded customer orders. No external calls. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapShopifyAnalyticsOrder, type ShopifyMappingPolicy } from "@/lib/analytics/shopifyMapping";
import {
  readShopifyAnalyticsOrder, SHOPIFY_ANALYTICS_API_VERSION, sourceObject,
  type SourceObject, type ShopifyOrderDocument,
} from "@/lib/analytics/shopifySource";
import { key } from "@/lib/analytics/primitives";

const shop = "mapping-fixture.myshopify.com";
const gid = (kind: string, id: string) => `gid://shopify/${kind}/${id}`;
const bag = (amount: string, currencyCode = "USD") => ({ shopMoney: { amount, currencyCode } });
function fixtureOrder(): SourceObject {
  return {
    id: gid("Order", "9007199254740993"), createdAt: "2026-03-08T04:00:00Z",
    updatedAt: "2026-03-09T12:00:00Z", currencyCode: "USD", edited: false, taxesIncluded: false,
    test: false, cancelledAt: null, cartToken: "cart_fixture",
    shippingAddress: { countryCodeV2: "US", provinceCode: "NY" },
    originalTotalPriceSet: bag("27"), subtotalPriceSet: bag("22"),
    // Deliberately different current totals. These must NEVER substitute for original values.
    currentTotalPriceSet: bag("22"), currentSubtotalPriceSet: bag("17"), processedAt: "2026-03-08T04:05:00Z",
    transactionsCount: { count: 2, precision: "EXACT" },
    transactions: [
      { id: gid("OrderTransaction", "888"), kind: "SALE", status: "SUCCESS", gateway: "fixture_gateway",
        test: false, createdAt: "2026-03-08T04:01:00Z", processedAt: "2026-03-08T04:30:00Z",
        amountSet: bag("27"), parentTransaction: null },
      { id: gid("OrderTransaction", "889"), kind: "REFUND", status: "SUCCESS", gateway: "fixture_gateway",
        test: false, createdAt: "2026-03-09T09:00:00Z", processedAt: "2026-03-09T09:01:00Z",
        amountSet: bag("5"), parentTransaction: { id: gid("OrderTransaction", "888"), gateway: "fixture_gateway" } },
    ],
    lineItems: {
      nodes: [
        { id: gid("LineItem", "9007199254740995"), sku: "BOX", quantity: 2, currentQuantity: 1, isGiftCard: false,
          product: { id: gid("Product", "701") }, originalUnitPriceSet: bag("10"), originalTotalSet: bag("20"),
          totalDiscountSet: bag("2"), // Omits another allocation; not the source used by the mapper.
          discountAllocations: [{ allocatedAmountSet: bag("2") }, { allocatedAmountSet: bag("1") }] },
        { id: gid("LineItem", "902"), sku: null, quantity: 1, isGiftCard: true, product: null,
          originalUnitPriceSet: bag("5"), originalTotalSet: bag("5"), discountAllocations: [] },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}
const policy = (): ShopifyMappingPolicy => ({
  decision: { eligibility: "eligible", commerceSource: "storefront", acquisitionEligible: true, approvalRef: "synthetic:catalog-policy" },
  sourceEvidenceRef: "synthetic:retained-source-1", lineClasses: { "9007199254740995": "merchandise", "902": "gift_card" },
});
const doc = (order = fixtureOrder()): ShopifyOrderDocument => ({ shop, apiVersion: SHOPIFY_ANALYTICS_API_VERSION, order });
const lines = (o: SourceObject) => sourceObject(o.lineItems).nodes as SourceObject[];
const txs = (o: SourceObject) => o.transactions as SourceObject[];
const map = (order = fixtureOrder(), p = policy()) => mapShopifyAnalyticsOrder(doc(order), p, "mapping-test");
let network: ReturnType<typeof vi.fn>;
beforeEach(() => {
  network = vi.fn(() => { throw new Error("external_network_forbidden"); });
  vi.stubGlobal("fetch", network);
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("actual Shopify Admin GraphQL shape mapping", () => {
  it("maps original quantities, all discount allocations, large IDs and separate payment clocks", () => {
    const result = map();
    expect(result.orders[0]).toMatchObject({
      source_order_id: "9007199254740993", order_id: key(shop, "9007199254740993"),
      purchase_merchandise_gross_usd: "20.000000", purchase_discount_usd: "3.000000",
      purchase_merchandise_net_usd: "17.000000", paid_at: "2026-03-08T04:30:00Z", purchase_date: "2026-03-07",
      customer_id: null, checkout_id: null,
    });
    expect(result.order_items[0]).toMatchObject({ source_line_id: "9007199254740995", quantity: "2.000000", purchase_net_usd: "17.000000" });
    expect(result.order_items[1].item_class).toBe("gift_card");
    expect(result.payments.map(p => p.source_amount)).toEqual(["27.000000", "-5.000000"]);
    expect(result.payments[1].parent_payment_id).toBe(result.payments[0].payment_id);
    expect(result.payments.every(p => p.cash_eligible === false && p.cash_amount_usd === null && p.settled_at === null)).toBe(true);
    expect(result.order_item_offers).toEqual([]);
    expect(result.publishable).toBe(false);
    expect(result).not.toHaveProperty("sales_ledger");
  });
  it("is deterministic on replay and changes keys across shops, not transport deliveries", () => {
    expect(map()).toEqual(map());
    expect(mapShopifyAnalyticsOrder({ ...doc(), shop: "another.myshopify.com" }, policy(), "mapping-test").orders[0].order_id)
      .not.toBe(map().orders[0].order_id);
  });
  it("preserves non-USD source amounts without inventing FX", () => {
    const order = JSON.parse(JSON.stringify(fixtureOrder()).replaceAll('"USD"', '"CAD"'));
    const result = map(order);
    expect(result.orders[0].purchase_merchandise_net_usd).toBeNull();
    expect(result.payments[0].source_currency).toBe("CAD");
    expect(result.payments[0].cash_amount_usd).toBeNull();
  });
  it("does not classify merchandise or infer offers without approved catalog evidence", () => {
    const p = policy(); p.lineClasses = {};
    expect(map(fixtureOrder(), p).orders[0].purchase_merchandise_net_usd).toBeNull();
    expect(map(fixtureOrder(), p).order_items[0].item_class).toBe("unknown");
  });
  it("accepts missing catalog products and treats an empty SKU as unknown", () => {
    const order = fixtureOrder(); lines(order)[0].sku = ""; lines(order)[0].product = null;
    expect(map(order).order_items[0]).toMatchObject({ sku: null, product_id: null, purchase_net_usd: "17.000000" });
  });
  it("does not count authorization and capture twice", () => {
    const order = fixtureOrder(), original = txs(order)[0];
    order.transactions = [
      { ...original, id: gid("OrderTransaction", "777"), kind: "AUTHORIZATION", processedAt: "2026-03-08T04:20:00Z" },
      { ...original, kind: "CAPTURE", parentTransaction: { id: gid("OrderTransaction", "777"), gateway: "fixture_gateway" } },
    ];
    expect(map(order).orders[0].paid_at).toBe("2026-03-08T04:30:00Z");
  });
  it("uses the final successful partial capture to establish full payment", () => {
    const order = fixtureOrder(), original = txs(order)[0];
    order.transactions = [
      { ...original, id: gid("OrderTransaction", "777"), kind: "AUTHORIZATION" },
      { ...original, kind: "CAPTURE", amountSet: bag("20"), parentTransaction: { id: gid("OrderTransaction", "777"), gateway: "fixture_gateway" } },
      { ...original, id: gid("OrderTransaction", "890"), kind: "CAPTURE", amountSet: bag("7"),
        processedAt: "2026-03-08T05:01:00Z", parentTransaction: { id: gid("OrderTransaction", "777"), gateway: "fixture_gateway" } },
    ];
    order.transactionsCount = { count: 3, precision: "EXACT" };
    expect(map(order).orders[0].paid_at).toBe("2026-03-08T05:01:00Z");
    txs(order)[1].processedAt = "2026-01-01T00:00:00Z";
    expect(map(order).orders[0].paid_at).toBe("2026-03-08T05:01:00Z");
  });
  it("accepts an associated provider payment timestamp before order creation", () => {
    const order = fixtureOrder();
    txs(order)[0].processedAt = "2026-03-08T03:59:59Z";
    expect(map(order).orders[0].paid_at).toBe("2026-03-08T03:59:59Z");
  });
  it.each(["PENDING", "AWAITING_RESPONSE", "FAILURE", "ERROR"])("does not treat %s as paid", status => {
    const order = fixtureOrder(); txs(order)[0].status = status;
    expect(() => map(order)).toThrow("missing_paid_evidence");
    const p = policy(); p.decision.eligibility = "pending";
    expect(map(order, p).orders[0].paid_at).toBeNull();
  });
  it("does not substitute order processedAt when transaction processedAt is absent", () => {
    const order = fixtureOrder(); txs(order)[0].processedAt = null;
    expect(() => map(order)).toThrow("missing_paid_evidence");
  });
  it("requires an exclusion policy for test orders and emits no test payments", () => {
    const order = fixtureOrder(); order.test = true; txs(order).forEach(t => { t.test = true; });
    expect(() => map(order)).toThrow("shopify_test_policy_mismatch");
    const p = policy(); p.decision.eligibility = "excluded_test";
    const result = map(order, p);
    expect(result.payments).toEqual([]);
    expect(result.orders[0].acquisition_eligible).toBe(false);
  });
  it("requires explicit treatment of cancelled orders", () => {
    const order = fixtureOrder(); order.cancelledAt = "2026-03-09T10:00:00Z";
    expect(() => map(order)).toThrow("shopify_cancellation_policy_required");
    const p = policy(); p.decision.eligibility = "excluded_cancelled";
    expect(map(order, p).orders[0].eligibility_status).toBe("excluded_cancelled");
  });
  const invalid: [string, (o: SourceObject) => void, string][] = [
    ["edited purchase", o => { o.edited = true; }, "shopify_original_purchase_snapshot_required"],
    ["tax-inclusive", o => { o.taxesIncluded = true; }, "shopify_tax_inclusive_mapping_required"],
    ["truncated lines", o => { sourceObject(sourceObject(o.lineItems).pageInfo).hasNextPage = true; }, "shopify_incomplete_lines"],
    ["duplicate line", o => { lines(o).push(lines(o)[0]); }, "shopify_duplicate_line"],
    ["line arithmetic mismatch", o => { lines(o)[0].originalTotalSet = bag("21"); }, "shopify_line_total_mismatch"],
    ["subtotal mismatch", o => { o.subtotalPriceSet = bag("21"); }, "shopify_subtotal_mismatch"],
    ["over-discount", o => { lines(o)[0].discountAllocations = [{ allocatedAmountSet: bag("21") }]; }, "shopify_discount_exceeds_gross"],
    ["money currency mismatch", o => { lines(o)[0].originalUnitPriceSet = bag("10", "CAD"); }, "shopify_currency_mismatch"],
    ["unsafe quantity", o => { lines(o)[0].quantity = Number.MAX_SAFE_INTEGER + 1; }, "shopify_invalid_quantity"],
    ["wrong ID resource", o => { lines(o)[0].id = gid("Order", "1"); }, "invalid_shopify_id"],
    ["duplicate transaction", o => { txs(o)[1] = txs(o)[0]; }, "shopify_duplicate_transaction"],
    ["truncated transactions", o => { sourceObject(o.transactionsCount).count = 3; }, "shopify_incomplete_transactions"],
    ["estimated transaction count", o => { sourceObject(o.transactionsCount).precision = "AT_LEAST"; }, "shopify_incomplete_transactions"],
    ["unknown status", o => { txs(o)[0].status = "UNKNOWN"; }, "shopify_unsupported_transaction"],
    ["suggested refund", o => { txs(o)[1].kind = "SUGGESTED_REFUND"; }, "shopify_unsupported_transaction"],
    ["cash change", o => { txs(o)[0].kind = "CHANGE"; }, "shopify_unsupported_transaction"],
    ["missing gateway", o => { txs(o)[0].gateway = null; }, "shopify_schema_drift"],
    ["missing parent", o => { txs(o)[1].parentTransaction = null; }, "shopify_missing_transaction_parent"],
    ["foreign parent", o => { sourceObject(txs(o)[1].parentTransaction).id = gid("OrderTransaction", "999"); }, "shopify_missing_transaction_parent"],
    ["gateway mismatch", o => { sourceObject(txs(o)[1].parentTransaction).gateway = "different"; }, "shopify_parent_gateway_mismatch"],
    ["mixed test transactions", o => { txs(o)[0].test = true; }, "shopify_mixed_test_transactions"],
    ["overpayment", o => { txs(o)[0].amountSet = bag("28"); }, "shopify_overpayment_requires_review"],
    ["partial payment", o => { txs(o)[0].amountSet = bag("26"); }, "missing_paid_evidence"],
    ["bad payment timestamp", o => { txs(o)[0].processedAt = "2027-01-01T00:00:00Z"; }, "shopify_invalid_paid_timestamp"],
    ["missing discount allocations", o => { delete lines(o)[0].discountAllocations; }, "shopify_schema_drift"],
  ];
  it.each(invalid)("fails closed on %s", (_, mutate, error) => {
    const order = fixtureOrder(); mutate(order);
    expect(() => map(order)).toThrow(error);
  });
  it("rejects missing durable evidence and conflicting gift-card classification", () => {
    const p = policy(); p.sourceEvidenceRef = "";
    expect(() => map(fixtureOrder(), p)).toThrow("shopify_missing_policy_evidence");
    const wrong = policy(); wrong.lineClasses = { "902": "merchandise" };
    expect(() => map(fixtureOrder(), wrong)).toThrow("shopify_item_class_conflict");
  });
});

const response = (order: SourceObject, version = SHOPIFY_ANALYTICS_API_VERSION) =>
  new Response(JSON.stringify({ data: { order } }), { headers: { "X-Shopify-API-Version": version } });
const readWith = (fetcher: typeof fetch, maxLinePages = 20) => readShopifyAnalyticsOrder({
  shop, accessToken: "synthetic-not-a-token", fetcher, maxLinePages,
}, gid("Order", "9007199254740993"));
describe("read-only Shopify order reader", () => {
  it("pins cartToken to the exact Admin API version that introduced it", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response(fixtureOrder()));
    const result = await readWith(fetcher);
    expect(result.order.cartToken).toBe("cart_fixture");
    for (const [url, init] of fetcher.mock.calls) {
      const body = JSON.parse(String(init?.body));
      expect(url).toContain("/admin/api/2026-07/graphql.json");
      expect(body.query).toMatch(/\bcartToken\b/);
    }
  });
  it("collects nested pages, verifies the revision, and feeds the actual mapper", async () => {
    const order = fixtureOrder(), first = structuredClone(order), second = structuredClone(order);
    first.lineItems = { nodes: [lines(order)[0]], pageInfo: { hasNextPage: true, endCursor: "next" } };
    second.lineItems = { nodes: [lines(order)[1]], pageInfo: { hasNextPage: false, endCursor: null } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(first)).mockResolvedValueOnce(response(second)).mockResolvedValueOnce(response(first));
    const result = mapShopifyAnalyticsOrder(await readWith(fetcher), policy(), "mapping-test");
    expect(result.orders[0].purchase_merchandise_net_usd).toBe("17.000000");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).variables.cursor)).toEqual([null, "next", null]);
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe(`https://${shop}/admin/api/2026-07/graphql.json`);
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeDefined();
      expect(JSON.parse(String(init?.body)).query).not.toMatch(/\bmutation\b/);
    }
  });
  it("rejects a changing source revision before returning any mapped document", async () => {
    const changed = fixtureOrder(); changed.updatedAt = "2026-03-10T12:00:00Z";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(fixtureOrder())).mockResolvedValueOnce(response(changed));
    await expect(readWith(fetcher)).rejects.toThrow("shopify_order_changed_during_read");
  });
  it("fails at the page cap instead of returning truncated records", async () => {
    const order = fixtureOrder(); sourceObject(order.lineItems).pageInfo = { hasNextPage: true, endCursor: "next" };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(order));
    await expect(readWith(fetcher, 1)).rejects.toThrow("incomplete_pagination");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects repeating pagination cursors", async () => {
    const order = fixtureOrder(); sourceObject(order.lineItems).pageInfo = { hasNextPage: true, endCursor: "same" };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response(order));
    await expect(readWith(fetcher)).rejects.toThrow("invalid_pagination");
  });
  it.each([
    ["HTTP error", () => new Response("private error", { status: 429 }), "shopify_http_failed"],
    ["version fallback", () => response(fixtureOrder(), "2026-04"), "shopify_api_version_mismatch"],
    ["missing version", () => new Response("{}"), "shopify_api_version_mismatch"],
    ["invalid JSON", () => new Response("private error", { headers: { "X-Shopify-API-Version": SHOPIFY_ANALYTICS_API_VERSION } }), "shopify_invalid_response"],
    ["partial GraphQL result", () => new Response(JSON.stringify({ data: { order: fixtureOrder() }, errors: [{ message: "private error" }] }),
      { headers: { "X-Shopify-API-Version": SHOPIFY_ANALYTICS_API_VERSION } }), "shopify_graphql_failed"],
  ] as const)("rejects %s without leaking response bodies", async (_, makeResponse, error) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(makeResponse());
    await expect(readWith(fetcher)).rejects.toThrow(error);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("sanitizes transport errors and does not retry", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("private token"));
    await expect(readWith(fetcher)).rejects.toThrow("shopify_transport_failed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects hostile shop names before sending credentials", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(readShopifyAnalyticsOrder({ shop: "example.com/path", accessToken: "secret", fetcher }, gid("Order", "1")))
      .rejects.toThrow("invalid_shopify_shop");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

it("inserts mapped rows into the real local Postgres schema and enforces replay keys", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role service_role;");
    await db.exec(readFileSync("sql/analytics/001_staging.sql", "utf8"));
    await db.query("insert into lean_private.publications(publication_id, contract_version) values ($1,$2)", ["mapping-test", "fixture"]);
    const result = map();
    for (const table of ["orders", "order_items", "order_item_offers", "payments"] as const) {
      for (const row of result[table]) {
        const keys = Object.keys(row);
        await db.query(`insert into lean_private."${table}" (${keys.map(k => `"${k}"`).join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(row));
      }
    }
    const order = (await db.query<{ net: string }>("select purchase_merchandise_net_usd::text as net from lean_private.orders")).rows[0];
    expect(order.net).toBe("17.000000"); // Independent fixed source fixture oracle, not mapper-derived.
    expect((await db.query("select * from lean_private.payments where cash_eligible")).rows).toHaveLength(0);
    expect((await db.query("select * from lean_private.sales_ledger")).rows).toHaveLength(0);
    await expect(db.exec("insert into lean_private.orders select * from lean_private.orders")).rejects.toThrow(/duplicate key/i);
  } finally { await db.close(); }
}, 30000);
