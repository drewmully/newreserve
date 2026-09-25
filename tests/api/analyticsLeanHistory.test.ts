import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCommerceCandidate, reportDates } from "@/lib/analytics/commerceCandidate";
import {
  HISTORY_ACCESS_QUERY, HISTORY_ORDERS_QUERY, HISTORY_UPDATED_ORDERS_QUERY, historySearch, runShopifyHistory,
  type HistoryOptions,
} from "@/lib/analytics/shopifyHistory";
import { readPilotSource, type PilotSource } from "@/lib/analytics/shopifyPilotSource";
import { type PilotPolicy } from "@/lib/analytics/shopifyPilotMapping";

vi.mock("@/lib/analytics/shopifyPilotSource", () => ({ readPilotSource: vi.fn() }));
const shop = "fixture.myshopify.com";
const gid = (kind: string, id: string) => `gid://shopify/${kind}/${id}`;
const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
const connection = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
function fixture(id = "1"): PilotSource {
  const order = {
    id: gid("Order", id), createdAt: "2026-01-01T12:00:00Z", updatedAt: "2026-01-02T15:00:00Z",
    currencyCode: "USD", edited: false, taxesIncluded: false, test: false, cancelledAt: null, shippingAddress: null,
    originalTotalPriceSet: money("20"), subtotalPriceSet: money("20"),
    transactionsCount: { count: 1, precision: "EXACT" },
    transactions: [{ id: gid("OrderTransaction", `${id}4`), kind: "SALE", status: "SUCCESS", gateway: "fixture",
      test: false, createdAt: "2026-01-01T12:00:00Z", processedAt: "2026-01-01T12:01:00Z",
      amountSet: money("20"), parentTransaction: null }],
    lineItems: connection([{ id: gid("LineItem", "2"), sku: "SKU", quantity: 2, isGiftCard: false,
      product: { id: gid("Product", "3") }, originalUnitPriceSet: money("10"),
      originalTotalSet: money("20"), discountAllocations: [] }]),
  };
  return {
    commerce: { shop, apiVersion: "2026-07", order },
    financial: { id: order.id, updatedAt: order.updatedAt, currencyCode: "USD",
      originalTotalPriceSet: money("20"), totalTaxSet: money("0"), originalTotalDutiesSet: null,
      originalTotalAdditionalFeesSet: null, totalTipReceivedSet: money("0"), shippingLines: connection([]), refunds: [] },
    refunds: [],
  };
}
const policy: PilotPolicy = {
  decision: { eligibility: "eligible", commerceSource: "storefront", acquisitionEligible: false, approvalRef: "fixture:eligibility" },
  lineClasses: { "2": "merchandise" }, financialApprovalRef: "fixture:finance", saleClock: "paid_at", refundClock: "refund_created_at",
};
const record = (source = fixture()) => ({ source, evidenceRef: "fixture:retained", policy: structuredClone(policy) });
const scope = { shop, publication: "fixture:publication", definition: "fixture:v1", fromDate: "2026-01-01", throughDate: "2026-01-03" };
const options = (): HistoryOptions => ({
  shop, fromTime: "2026-01-01T00:00:00Z", untilTime: "2026-01-03T00:00:00Z",
  approvalRef: "fixture:scope", accessToken: "fixture:not-a-real-token",
  now: "2026-09-22T12:00:00Z", pageSize: 2, signal: AbortSignal.timeout(30000),
});
function network(pages: unknown[], scopes = ["read_orders", "read_all_orders"]) {
  return vi.fn<typeof fetch>(async (url, init) => {
    expect(url).toBe(`https://${shop}/admin/api/2026-07/graphql.json`);
    expect(init?.redirect).toBe("error"); expect(init?.method).toBe("POST");
    const { query, variables } = JSON.parse(String(init?.body));
    expect([HISTORY_ACCESS_QUERY, HISTORY_ORDERS_QUERY]).toContain(query);
    if (query === HISTORY_ORDERS_QUERY) {
      expect(variables.search).toBe(historySearch(options()));
      expect(variables.first).toBe(2);
    }
    const data = query === HISTORY_ACCESS_QUERY
      ? { currentAppInstallation: { accessScopes: scopes.map(handle => ({ handle })) } }
      : { orders: pages.shift() };
    return new Response(JSON.stringify({ data }), { headers: { "X-Shopify-API-Version": "2026-07" } });
  });
}
const node = () => {
  const { id, createdAt, updatedAt } = fixture().commerce.order;
  return { id, createdAt, updatedAt };
};
let forbiddenNetwork: ReturnType<typeof vi.fn>;
beforeEach(() => {
  forbiddenNetwork = vi.fn(() => { throw new Error("external_network_forbidden"); });
  vi.stubGlobal("fetch", forbiddenNetwork);
  vi.mocked(readPilotSource).mockReset().mockResolvedValue(fixture());
});
afterEach(() => { expect(forbiddenNetwork).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("bounded Shopify history ingestion", () => {
  it("hydrates an older purchase found by its update clock and commits only after complete source reads", async () => {
    const source = fixture(); source.commerce.order.createdAt = "2025-01-01T12:00:00Z";
    vi.mocked(readPilotSource).mockResolvedValue(source);
    const config = { ...options(), scanBasis: "updated_at" as const };
    const fetcher = vi.fn<typeof fetch>(async (_, init) => {
      const { query, variables } = JSON.parse(String(init?.body));
      if (query !== HISTORY_ACCESS_QUERY) {
        expect(query).toBe(HISTORY_UPDATED_ORDERS_QUERY);
        expect(variables.search).toBe("updated_at:>='2026-01-01T00:00:00Z' updated_at:<'2026-01-03T00:00:00Z'");
      }
      return Response.json({ data: query === HISTORY_ACCESS_QUERY
        ? { currentAppInstallation: { accessScopes: ["read_orders", "read_all_orders"].map(handle => ({ handle })) } }
        : { orders: connection([{ ...node(), createdAt: source.commerce.order.createdAt }]) } },
      { headers: { "X-Shopify-API-Version": "2026-07" } });
    });
    const commitPage = vi.fn().mockResolvedValue(true);
    expect(await runShopifyHistory({ ...config, fetcher, cursor: null, maxPages: 1, store: { commitPage } }))
      .toEqual({ cursor: null, written: 1, complete: true });
    expect(commitPage.mock.calls[0][1].rows[0].source).toEqual(source);
  });
  it("requires all-order access even for a recent update window", async () => {
    const config = { ...options(), scanBasis: "updated_at" as const,
      fromTime: "2026-09-21T00:00:00Z", untilTime: "2026-09-22T00:00:00Z" };
    const fetcher = network([], ["read_orders"]), commitPage = vi.fn();
    await expect(runShopifyHistory({ ...config, fetcher, cursor: null, maxPages: 1, store: { commitPage } }))
      .rejects.toThrow("full_history_access");
    expect(fetcher).toHaveBeenCalledTimes(1); expect(commitPage).not.toHaveBeenCalled();
  });
  it("rejects an invalid scan basis before any source call", async () => {
    await expect(runShopifyHistory({ ...options(), scanBasis: "arbitrary" as "updated_at",
      cursor: null, maxPages: 1, store: { commitPage: vi.fn() } })).rejects.toThrow("invalid_scope");
  });
  it("retains all sources and advances the checkpoint only after page completion", async () => {
    const fetcher = network([connection([node()])]), commitPage = vi.fn().mockResolvedValue(true);
    const result = await runShopifyHistory({ ...options(), fetcher, cursor: null, maxPages: 1, store: { commitPage } });
    expect(result).toEqual({ cursor: null, written: 1, complete: true });
    expect(commitPage).toHaveBeenCalledWith(null, { rows: [{ source: fixture() }], complete: true, nextCursor: null });
  });
  it("does not advance a cursor if hydration fails", async () => {
    vi.mocked(readPilotSource).mockRejectedValue(new Error("fixture:incomplete_refunds"));
    const commitPage = vi.fn();
    await expect(runShopifyHistory({ ...options(), fetcher: network([connection([node()])]),
      cursor: null, maxPages: 1, store: { commitPage } })).rejects.toThrow("incomplete_refunds");
    expect(commitPage).not.toHaveBeenCalled();
  });
  it("rejects older history without actual read_all_orders access", async () => {
    const fetcher = network([], ["read_orders"]), commitPage = vi.fn();
    await expect(runShopifyHistory({ ...options(), fetcher, cursor: null, maxPages: 1,
      store: { commitPage } })).rejects.toThrow("full_history_access");
    expect(fetcher).toHaveBeenCalledTimes(1); expect(commitPage).not.toHaveBeenCalled();
  });
  it("supports a verified empty page without pretending to certify revenue", async () => {
    const result = await runShopifyHistory({ ...options(), fetcher: network([connection([])]),
      cursor: null, maxPages: 1, store: { commitPage: vi.fn().mockResolvedValue(true) } });
    expect(result).toEqual({ cursor: null, written: 0, complete: true });
    expect(result).not.toHaveProperty("certified");
  });
  it("returns partial progress at the configured page bound", async () => {
    const page = { nodes: [node()], pageInfo: { hasNextPage: true, endCursor: "next" } };
    const result = await runShopifyHistory({ ...options(), fetcher: network([page]), cursor: null,
      maxPages: 1, store: { commitPage: vi.fn().mockResolvedValue(true) } });
    expect(result.complete).toBe(false); expect(result.cursor).toBe("next");
  });
  it("rejects a repeated cursor and a checkpoint conflict", async () => {
    const commitPage = vi.fn().mockResolvedValue(false);
    await expect(runShopifyHistory({ ...options(), cursor: "same", maxPages: 1, store: { commitPage },
      fetcher: network([{ nodes: [node()], pageInfo: { hasNextPage: true, endCursor: "same" } }]),
    })).rejects.toThrow("invalid_page");
    expect(commitPage).not.toHaveBeenCalled();
    await expect(runShopifyHistory({ ...options(), cursor: null, maxPages: 1, store: { commitPage },
      fetcher: network([connection([node()])]) })).rejects.toThrow("checkpoint_conflict");
  });
  it("rejects source revisions that changed between listing and hydration", async () => {
    const changed = fixture(); changed.commerce.order.updatedAt = "2026-01-03T15:00:00Z";
    vi.mocked(readPilotSource).mockResolvedValue(changed);
    const commitPage = vi.fn();
    await expect(runShopifyHistory({ ...options(), cursor: null, maxPages: 1, store: { commitPage },
      fetcher: network([connection([node()])]) })).rejects.toThrow("changed_during_read");
    expect(commitPage).not.toHaveBeenCalled();
  });
  it("rejects duplicate and out-of-window source orders", async () => {
    for (const nodes of [[node(), node()], [{ ...node(), createdAt: options().untilTime }]]) {
      await expect(runShopifyHistory({ ...options(), cursor: null, maxPages: 1,
        store: { commitPage: vi.fn() }, fetcher: network([connection(nodes)]) })).rejects.toThrow("source_scope_mismatch");
    }
  });
  it("rejects unapproved windows before making any request", async () => {
    await expect(runShopifyHistory({ ...options(), approvalRef: "", cursor: null,
      maxPages: 1, store: { commitPage: vi.fn() } })).rejects.toThrow("invalid_scope");
  });
});
describe("combined commerce candidate reports", () => {
  it("aggregates orders and product units without summing per-order AOV", () => {
    const result = buildCommerceCandidate([record(), record(fixture("2"))], scope);
    expect(result.reports.store_daily[0]).toMatchObject({
      eligible_orders: 2, aov_usd: "20.000000", net_merchandise_sales_usd: "40.000000",
      collected_cash_usd: null, new_customers: null, spend_usd: null, is_stale: true,
    });
    expect(result.reports.product_daily[0]).toMatchObject({ sku_bucket: "SKU", units: "4.000000" });
    expect(result.reports.store_daily).toHaveLength(3);
    expect(result.certification).toBe("unverified");
    expect(result.reports.store_daily[1].readiness).toMatchObject({ eligible_orders: "observed_unverified" });
  });
  it("deduplicates overlapping imports and chooses the latest source revision", () => {
    const later = fixture(); later.commerce.order.updatedAt = later.financial.updatedAt = "2026-01-03T15:00:00Z";
    const result = buildCommerceCandidate([record(later), record(), record(later)], scope);
    expect(result.selectedOrders).toBe(1);
    expect(result.facts.orders[0].source_updated_at).toBe("2026-01-03T15:00:00Z");
  });
  it("blocks conflicting same-revision payloads and policy drift", () => {
    const changed = record(); changed.source.commerce.order.shippingAddress = { countryCodeV2: "CA", provinceCode: "ON" };
    expect(() => buildCommerceCandidate([record(), changed], scope)).toThrow("revision_conflict");
    const differentPolicy = record(); differentPolicy.policy.financialApprovalRef = "fixture:changed";
    expect(() => buildCommerceCandidate([record(), differentPolicy], scope)).toThrow("policy_conflict");
  });
  it("does not silently omit unsupported orders", () => {
    const bad = record(); bad.source.commerce.order.edited = true;
    expect(() => buildCommerceCandidate([record(), bad], scope)).toThrow();
    expect(() => buildCommerceCandidate([bad], scope)).toThrow("original_purchase_snapshot");
  });
  it("rejects mixed shops and missing retained-source evidence", () => {
    const mixed = record(); mixed.source.commerce.shop = "different.myshopify.com";
    expect(() => buildCommerceCandidate([mixed], scope)).toThrow("source_mismatch");
    expect(() => buildCommerceCandidate([{ ...record(), evidenceRef: "" }], scope)).toThrow("source_mismatch");
  });
  it("keeps an empty sample explicitly unverified with bounded valid date spines", () => {
    const result = buildCommerceCandidate([], scope);
    expect(result.reports.store_daily[0].readiness).toMatchObject({ total_sales_usd: "observed_unverified" });
    expect(result.reports.product_daily).toEqual([]);
    for (const dates of [["2026-02-30", "2026-03-01"], ["2026-01-03", "2026-01-01"], ["2020-01-01", "2026-01-01"]])
      expect(() => reportDates(dates[0], dates[1])).toThrow();
  });
});
