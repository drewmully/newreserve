/** Independent negative check: synthetic response drift must not broaden retention. */
import { afterEach, expect, it, vi } from "vitest";
import {
  readShopifyAnalyticsOrder, SHOPIFY_FINANCIAL_ORDER_SIZE_QUERY, sourceObject,
} from "@/lib/analytics/shopifySource";

afterEach(() => vi.unstubAllGlobals());

it("keeps only the financial selection and canonical size evidence across unexpected response fields", async () => {
  const network = vi.fn(() => { throw new Error("external_network_forbidden"); });
  vi.stubGlobal("fetch", network);
  const money = () => ({ shopMoney: {
    amount: "20.00", currencyCode: "USD", customer_note: "PRIVATE-NESTED-MONEY",
  }, receipt_email: "PRIVATE-MONEY-BAG" });
  const order = {
    id: "gid://shopify/Order/1", createdAt: "2026-01-01T12:00:00Z", updatedAt: "2026-01-02T12:00:00Z",
    currencyCode: "USD", edited: false, taxesIncluded: false, test: false, cancelledAt: null,
    email: "PRIVATE-EMAIL", phone: "PRIVATE-PHONE", note: "PRIVATE-NOTE",
    customAttributes: [{ key: "unrequested", value: "PRIVATE-ORDER-ATTRIBUTE" }],
    originalTotalPriceSet: money(), subtotalPriceSet: money(),
    transactionsCount: { count: 1, precision: "EXACT", contact: "PRIVATE-COUNT" },
    transactions: [{
      id: "gid://shopify/OrderTransaction/4", kind: "SALE", status: "SUCCESS", gateway: "synthetic",
      test: false, createdAt: "2026-01-01T12:00:00Z", processedAt: "2026-01-01T12:01:00Z",
      amountSet: money(), customer: "PRIVATE-TRANSACTION",
      parentTransaction: { id: "gid://shopify/OrderTransaction/3", gateway: "synthetic", customer: "PRIVATE-PARENT" },
    }],
    lineItems: {
      nodes: [{
        id: "gid://shopify/LineItem/2", sku: "SYNTHETIC", quantity: 1, isGiftCard: false,
        product: { id: "gid://shopify/Product/3", note: "PRIVATE-PRODUCT" },
        originalUnitPriceSet: money(), originalTotalSet: money(),
        discountAllocations: [{ allocatedAmountSet: money(), discountApplication: { code: "PRIVATE-DISCOUNT" } }],
        variantTitle: "M", customAttributes: [
          { key: "Top size", value: " m " }, { key: "Gift note", value: "PRIVATE-GIFT" },
        ],
      }],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
  const fetcher = vi.fn<typeof fetch>(async (_, init) => {
    expect(JSON.parse(String(init?.body)).query).toBe(SHOPIFY_FINANCIAL_ORDER_SIZE_QUERY);
    return Response.json({ data: { order } }, { headers: { "X-Shopify-API-Version": "2026-07" } });
  });
  const retained = await readShopifyAnalyticsOrder({
    shop: "privacy-fixture.myshopify.com", accessToken: "synthetic", fetcher,
    projection: "financial_no_geo_order_size",
  }, order.id);
  expect(network).not.toHaveBeenCalled();
  expect(JSON.stringify(retained)).not.toContain("PRIVATE");
  expect(retained.order.originalTotalPriceSet).toEqual({ shopMoney: { amount: "20.00", currencyCode: "USD" } });
  expect((sourceObject(retained.order.lineItems).nodes as Record<string, unknown>[])[0]).toMatchObject({
    id: "gid://shopify/LineItem/2", sku: "SYNTHETIC",
    product: { id: "gid://shopify/Product/3" },
    orderSize: { topSize: { status: "known", value: "M" }, variantTitle: { status: "known", value: "M" } },
  });
});
