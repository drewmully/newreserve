import { describe, expect, it } from "vitest";
import { evidenceDigest } from "@/lib/analytics/evidenceIntake";
import {
  readCustomerScopedPurchases, customerPurchaseSearch,
  CUSTOMER_PURCHASE_ACCESS_QUERY, CUSTOMER_PURCHASE_COUNT_QUERY, CUSTOMER_PURCHASE_PAGE_QUERY,
  type CustomerPurchaseReadPlan,
} from "@/lib/analytics/customerScopedPurchaseSource";
import { SHOPIFY_FINANCIAL_CUSTOMER_QUERY, type ShopifyOrderDocument } from "@/lib/analytics/shopifySource";
import { mapShopifyAnalyticsOrder } from "@/lib/analytics/shopifyMapping";

const now = "2026-10-07T06:00:00Z", shop = "mullybox-store.myshopify.com";
const gid = (kind: string, id: number) => `gid://shopify/${kind}/${id}`;
const plan = (): CustomerPurchaseReadPlan => ({
  projectRef: "xnfjdbpjuaezxjgargto", shop, authorizationRef: "fixture:current-project-authorization",
  appId: gid("App", 1), installationId: gid("AppInstallation", 2),
  expiresAt: "2026-10-07T06:02:00Z",
  members: [{ customerGid: gid("Customer", 90), anchorOrderGids: [gid("Order", 1)] }],
  maxRequests: 1250, maxBytes: 67108864,
});
const money = { shopMoney: { amount: "10", currencyCode: "USD" } };
function document(id: number, customer = 90): ShopifyOrderDocument {
  return { shop, apiVersion: "2026-07", projection: "financial_customer_id", order: {
    id: gid("Order", id), customer: { id: gid("Customer", customer) },
    createdAt: "2026-01-01T12:00:00Z", updatedAt: "2026-10-06T23:00:00Z",
    currencyCode: "USD", edited: false, taxesIncluded: false, test: false, cancelledAt: null,
    originalTotalPriceSet: money, subtotalPriceSet: money,
    transactionsCount: { count: 1, precision: "EXACT" },
    transactions: [{ id: gid("OrderTransaction", id), kind: "SALE", status: "SUCCESS", gateway: "fixture",
      test: false, createdAt: "2026-01-01T11:59:58Z", processedAt: "2026-01-01T11:59:58Z",
      amountSet: money, parentTransaction: null }],
    lineItems: { nodes: [{ id: gid("LineItem", id), sku: "FIXTURE", quantity: 1, isGiftCard: false,
      product: { id: gid("Product", 1) }, originalUnitPriceSet: money, originalTotalSet: money, discountAllocations: [] }],
    pageInfo: { hasNextPage: false, endCursor: null } },
  } };
}
type Mutation = (data: Record<string, unknown>, query: string, call: number, vars: Record<string, unknown>) => void;
function provider(docs = [document(1)], mutate?: Mutation) {
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  const queryCounts = new Map<string, number>();
  const fetcher: typeof fetch = async (url, init) => {
    expect(String(url)).toBe(`https://${shop}/admin/api/2026-07/graphql.json`);
    expect(init?.method).toBe("POST"); expect(init?.redirect).toBe("error");
    const { query, variables } = JSON.parse(String(init?.body));
    calls.push({ query, variables });
    const n = (queryCounts.get(query) ?? 0) + 1; queryCounts.set(query, n);
    let data: Record<string, unknown>;
    if (query === CUSTOMER_PURCHASE_ACCESS_QUERY) data = {
      shop: { myshopifyDomain: shop }, currentAppInstallation: { id: gid("AppInstallation", 2),
        app: { id: gid("App", 1) }, accessScopes: ["read_orders", "read_all_orders", "read_customers", "read_products"].map(handle => ({ handle })) },
    };
    else if (query === SHOPIFY_FINANCIAL_CUSTOMER_QUERY)
      data = { order: docs.find(d => d.order.id === variables.id)!.order };
    else {
      const owner = String(variables.search).match(/^customer_id:(\d+)$/)![1];
      const rows = docs.filter(d => (d.order.customer as { id: string }).id === `gid://shopify/Customer/${owner}`);
      if (query === CUSTOMER_PURCHASE_COUNT_QUERY) data = { ordersCount: { count: rows.length, precision: "EXACT" } };
      else {
        expect(query).toBe(CUSTOMER_PURCHASE_PAGE_QUERY);
        const offset = variables.cursor ? Number(String(variables.cursor).slice(1)) : 0;
        data = { orders: { nodes: rows.slice(offset, offset + 25).map(d => ({
          id: d.order.id, customer: d.order.customer, createdAt: d.order.createdAt, updatedAt: d.order.updatedAt,
        })), pageInfo: { hasNextPage: offset + 25 < rows.length,
          endCursor: rows.length ? `c${Math.min(offset + 25, rows.length)}` : null } } };
      }
    }
    data = structuredClone(data); mutate?.(data, query, n, variables);
    return Response.json({ data }, { headers: { "X-Shopify-API-Version": "2026-07" } });
  };
  return { calls, fetcher };
}
function run(p: ReturnType<typeof provider>, scope = plan(), retained?: Parameters<typeof readCustomerScopedPurchases>[0]["retained"]) {
  return readCustomerScopedPurchases({ plan: scope, accessToken: "fixture-token", fetcher: p.fetcher,
    now: () => now, retained });
}

describe("bounded customer purchase acquisition", () => {
  it("exhausts two members, rechecks inventory, and retains exact successful source clocks without metric admission", async () => {
    const docs = [document(1), document(2), document(3, 91)];
    const tx = docs[1].order.transactions as { processedAt: string; createdAt: string }[];
    tx[0].createdAt = tx[0].processedAt = "2026-02-01T12:00:00Z";
    const p = provider(docs), scope = plan();
    scope.members.push({ customerGid: gid("Customer", 91), anchorOrderGids: [gid("Order", 3)] });
    const result = await run(p, scope);
    expect(result.members.map(m => m.inventory.count)).toEqual([2, 1]);
    expect(result.members[0].sources.flatMap(s => s.successfulPayments.map(p => p.processedAt)))
      .toEqual(["2026-01-01T11:59:58Z", "2026-02-01T12:00:00Z"]);
    expect(result.members.every(m => JSON.stringify(m.inventory.orders) === JSON.stringify(m.recheck.orders))).toBe(true);
    expect(result).toMatchObject({ productionAdmission: false, migrationCoverage: "not_asserted",
      historicalOwnership: "not_asserted", deletedOrderCoverage: "not_asserted",
      pagination: "exhausted_and_rechecked", requests: 16 });
    const { digest, ...payload } = result;
    expect(digest).toBe(evidenceDigest(payload));
    expect(JSON.stringify(result)).not.toContain("fixture-token");
    expect(p.calls.every(c => !/email|phone|shippingAddress|metafields|displayName/.test(c.query))).toBe(true);
    expect(p.calls.find(c => c.query === CUSTOMER_PURCHASE_PAGE_QUERY)?.variables.search)
      .toBe("customer_id:90");
    expect(result.members[0].sources[0].document.order.createdAt).toBe("2026-01-01T12:00:00Z");
    // A current revision does not replace original creation or paid clocks.
    expect(result.members[0].sources[0].document.order.updatedAt).toBe("2026-10-06T23:00:00Z");
  });
  it("allows exactly 100 orders only after four EOF pages and an equal final scan", async () => {
    const p = provider(Array.from({ length: 100 }, (_, i) => document(i + 1)));
    const result = await run(p);
    expect(result.members[0].sources).toHaveLength(100);
    expect(result.members[0].inventory.pages).toHaveLength(4);
    expect(result.members[0].recheck.pages).toHaveLength(4);
    expect(result.requests).toBe(212);
  });
  it("refuses an unfinished fourth page even when exactly 100 rows were returned", async () => {
    const p = provider(Array.from({ length: 100 }, (_, i) => document(i + 1)), (data, query) => {
      if (query === CUSTOMER_PURCHASE_PAGE_QUERY)
        (data.orders as { pageInfo: { hasNextPage: boolean } }).pageInfo.hasNextPage = true;
    });
    await expect(run(p)).rejects.toThrow("incomplete_pagination");
    expect(p.calls.some(c => c.query === SHOPIFY_FINANCIAL_CUSTOMER_QUERY)).toBe(false);
  });
  it("hands unchanged documents to the existing paid-order mapper without a ledger/browser input", async () => {
    const result = await run(provider([document(1), document(2)]));
    const paid = result.members[0].sources.map(s => {
      const id = String(s.document.order.id).split("/").at(-1)!;
      return mapShopifyAnalyticsOrder(s.document, {
        sourceEvidenceRef: s.sourceRef, lineClasses: { [id]: "merchandise" },
        decision: { eligibility: "eligible", commerceSource: "storefront", acquisitionEligible: true,
          approvalRef: "fixture:existing-commerce-decision" },
      }, "fixture:purchase-proof").orders[0];
    });
    expect(paid).toHaveLength(2);
    expect(paid.map(o => o.paid_at)).toEqual(["2026-01-01T11:59:58Z", "2026-01-01T11:59:58Z"]);
    expect(paid.every(o => o.eligibility_status === "eligible")).toBe(true);
    // Payment evidence does not mint a canonical customer or history-complete flag.
    expect(paid.every(o => o.customer_id === null)).toBe(true);
    expect(result.productionAdmission).toBe(false);
  });
  it("refuses 101 for the actual member before hydration, without splitting or truncation", async () => {
    const p = provider(Array.from({ length: 101 }, (_, i) => document(i + 1)));
    await expect(run(p)).rejects.toThrow("member_count_bound");
    expect(p.calls.some(c => c.query === SHOPIFY_FINANCIAL_CUSTOMER_QUERY)).toBe(false);
  });
  it("reuses cash-owned retained hydration only at the exact observed revision, preserving its capture/ref", async () => {
    const doc = document(1), p = provider([doc]);
    const result = await run(p, plan(), [{ document: doc, capturedAt: "2026-10-06T23:01:00Z", evidenceRef: "fixture:cash-source" }]);
    expect(result.members[0].sources[0]).toMatchObject({ hydration: "retained",
      capturedAt: "2026-10-06T23:01:00Z", sourceRef: "fixture:cash-source" });
    expect(p.calls.some(c => c.query === SHOPIFY_FINANCIAL_CUSTOMER_QUERY)).toBe(false);
  });
  it.each(["old revision", "missing customer", "wrong owner", "unselected customer", "spare source", "open lines", "duplicate lines"] as const)(
    "refuses %s in retained hydration instead of rereading it silently", async kind => {
      const saved = document(1), p = provider([document(1)]);
      if (kind === "old revision") saved.order.updatedAt = "2026-01-01T13:00:00Z";
      if (kind === "missing customer") delete saved.order.customer;
      if (kind === "wrong owner") saved.order.customer = { id: gid("Customer", 91) };
      if (kind === "unselected customer") saved.projection = "financial_no_geo";
      if (kind === "spare source") saved.order.id = gid("Order", 2);
      const lines = saved.order.lineItems as { pageInfo: { hasNextPage: boolean }; nodes: unknown[] };
      if (kind === "open lines") lines.pageInfo.hasNextPage = true;
      if (kind === "duplicate lines") lines.nodes.push(lines.nodes[0]);
      await expect(run(p, plan(), [{ document: saved, capturedAt: now, evidenceRef: "fixture:cash-source" }])).rejects.toThrow();
      expect(p.calls.some(c => c.query === SHOPIFY_FINANCIAL_CUSTOMER_QUERY)).toBe(false);
    });
  it.each(["wrong shop", "wrong installation", "missing historical scope", "approximate count", "missing anchor",
    "null owner", "omitted owner", "other owner", "duplicate order", "empty open page", "loop cursor",
    "count mismatch", "changed final revision", "changed final membership", "future revision",
    "future creation", "extra contact field", "changed hydration revision", "changed hydration owner",
    "missing transaction", "unknown status", "nested contact field"] as const)("fails closed on %s", async kind => {
      const docs = kind === "loop cursor" ? Array.from({ length: 26 }, (_, i) => document(i + 1)) : [document(1)];
      const p = provider(docs, (data, query, call) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional malformed provider responses
        const a = data as Record<string, any>;
        if (query === CUSTOMER_PURCHASE_ACCESS_QUERY) {
          if (kind === "wrong shop") a.shop.myshopifyDomain = "other.myshopify.com";
          if (kind === "wrong installation") a.currentAppInstallation.id = gid("AppInstallation", 99);
          if (kind === "missing historical scope") a.currentAppInstallation.accessScopes = [{ handle: "read_orders" }];
        }
        if (query === CUSTOMER_PURCHASE_COUNT_QUERY) {
          if (kind === "approximate count") a.ordersCount.precision = "AT_LEAST";
          if (kind === "count mismatch") a.ordersCount.count = 2;
        }
        if (query === CUSTOMER_PURCHASE_PAGE_QUERY) {
          const o = a.orders.nodes[0];
          if (kind === "null owner") o.customer = null;
          if (kind === "omitted owner") delete o.customer;
          if (kind === "other owner") o.customer.id = gid("Customer", 91);
          if (kind === "missing anchor") o.id = gid("Order", 9);
          if (kind === "duplicate order") a.orders.nodes.push(o);
          if (kind === "empty open page") { a.orders.nodes = []; a.orders.pageInfo.hasNextPage = true; }
          if (kind === "loop cursor") { a.orders.pageInfo.hasNextPage = true; a.orders.pageInfo.endCursor = "c25"; }
          if (kind === "changed final revision" && call === 2) o.updatedAt = "2026-10-06T23:30:00Z";
          if (kind === "changed final membership" && call === 2) o.id = gid("Order", 9);
          if (kind === "future revision") o.updatedAt = "2026-10-08T00:00:00Z";
          if (kind === "future creation") o.createdAt = "2026-10-08T00:00:00Z";
          if (kind === "extra contact field") o.email = "not-retained@example.invalid";
        }
        if (query === SHOPIFY_FINANCIAL_CUSTOMER_QUERY) {
          if (kind === "changed hydration revision") a.order.updatedAt = "2026-10-06T23:30:00Z";
          if (kind === "changed hydration owner") a.order.customer.id = gid("Customer", 91);
          if (kind === "missing transaction") a.order.transactions = [];
          if (kind === "unknown status") a.order.transactions[0].status = "UNSUPPORTED";
          if (kind === "nested contact field") a.order.transactions[0].email = "not-retained@example.invalid";
        }
      });
      await expect(run(p)).rejects.toThrow();
    });
  it("refuses source errors, version drift and budget expiry without returning a partial packet", async () => {
    for (const kind of ["errors", "version", "budget", "bytes", "expired", "abort"]) {
      const p = provider(), scope = plan();
      if (kind === "budget") scope.maxRequests = 2;
      if (kind === "bytes") scope.maxBytes = 2;
      if (kind === "expired") scope.expiresAt = now;
      const signal = new AbortController(); if (kind === "abort") signal.abort();
      await expect(readCustomerScopedPurchases({ plan: scope, accessToken: "fixture", now: () => now, signal: signal.signal,
        fetcher: async (...args) => {
          if (kind === "errors") return Response.json({ data: {}, errors: [{}] }, { headers: { "X-Shopify-API-Version": "2026-07" } });
          if (kind === "version") return Response.json({ data: {} }, { headers: { "X-Shopify-API-Version": "2026-10" } });
          return p.fetcher(...args);
        } })).rejects.toThrow();
    }
  });
  it("keeps edited evidence and null successful clocks explicit rather than declaring first purchase", async () => {
    const doc = document(1); doc.order.edited = true;
    const tx = doc.order.transactions as { processedAt: string | null }[]; tx[0].processedAt = null;
    const result = await run(provider([doc]));
    expect(result.members[0].sources[0]).toMatchObject({ requiresOriginalPurchaseReview: true,
      successfulPayments: [{ transactionGid: gid("OrderTransaction", 1), kind: "sale", processedAt: null }] });
    expect(result.productionAdmission).toBe(false);
  });
  it("does not hide later-created orders whose successful purchase clock precedes creation", async () => {
    const doc = document(1);
    doc.order.createdAt = "2026-10-02T12:00:03Z";
    (doc.order.transactions as { processedAt: string }[])[0].processedAt = "2026-10-02T12:00:00Z";
    const result = await run(provider([doc]));
    expect(result.members[0].sources[0].successfulPayments[0].processedAt).toBe("2026-10-02T12:00:00Z");
    expect(result.coverage).toBe("current_shopify_customer_membership");
    expect(result.productionAdmission).toBe(false);
  });
  it("does not treat failed payment attempts or test orders as successful purchases", async () => {
    const doc = document(1);
    (doc.order.transactions as { status: string }[])[0].status = "FAILURE";
    expect((await run(provider([doc]))).members[0].sources[0].successfulPayments).toEqual([]);
    doc.order.test = true;
    Object.assign((doc.order.transactions as object[])[0], { status: "SUCCESS", test: true });
    expect((await run(provider([doc]))).members[0].sources[0].successfulPayments).toEqual([]);
  });
  it("rejects arbitrary customer search syntax and non-current project scope", async () => {
    expect(() => customerPurchaseSearch("90 OR *")).toThrow();
    const scope = plan(); Object.assign(scope, { projectRef: "xeqlgxvrhgwwudyqtnun" });
    const p = provider(); await expect(run(p, scope)).rejects.toThrow("scope");
    expect(p.calls).toHaveLength(0);
  });
  it("refuses clock regression after acquisition starts", async () => {
    const p = provider(); let ticks = 0;
    await expect(readCustomerScopedPurchases({ plan: plan(), accessToken: "fixture", fetcher: p.fetcher,
      now: () => ++ticks < 4 ? now : "2026-10-07T05:59:59Z" })).rejects.toThrow("clock");
  });
});
