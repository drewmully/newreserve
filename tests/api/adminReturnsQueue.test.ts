import { describe, expect, it, vi } from "vitest";
import {
  assessRisk,
  buildExchangeInput,
  fetchReturnOrders,
  normalizeOrders,
  sortQueue,
  type RawOrder,
} from "@/lib/returnsAdmin";

const NOW = new Date("2026-10-13T16:00:00Z");

function order(over: Partial<RawOrder> & { note?: string | null; status?: "REQUESTED" | "OPEN"; requested?: string; approved?: string | null; total?: string; tags?: string[] }): RawOrder {
  return {
    id: over.id ?? "gid://shopify/Order/1",
    name: over.name ?? "#1001",
    createdAt: "2026-09-01T00:00:00Z",
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "FULFILLED",
    tags: over.tags ?? [],
    totalPriceSet: { shopMoney: { amount: over.total ?? "52.25" } },
    customer: { id: "gid://shopify/Customer/1", displayName: "Test Customer", email: "t@example.com", numberOfOrders: "2" },
    returns: {
      nodes: [
        {
          id: `gid://shopify/Return/${over.name ?? "1"}`,
          name: `${over.name ?? "#1001"}-R1`,
          status: over.status ?? "REQUESTED",
          createdAt: over.requested ?? "2026-10-12T14:00:00Z",
          requestApprovedAt: over.approved ?? null,
          totalQuantity: 1,
          returnLineItems: {
            nodes: [
              {
                id: "gid://shopify/ReturnLineItem/9",
                quantity: 1,
                returnReason: "SIZE_TOO_SMALL",
                customerNote: over.note ?? "Wrong size",
                fulfillmentLineItem: {
                  id: "gid://shopify/FulfillmentLineItem/7",
                  lineItem: {
                    id: "gid://shopify/LineItem/5",
                    title: "Mystery Bundle - Closeout",
                    variantTitle: "2XL",
                    sku: null,
                    product: { id: "gid://shopify/Product/3" },
                    originalUnitPriceSet: { shopMoney: { amount: "50.0" } },
                  },
                },
              },
              {}, // non-ReturnLineItem union member (e.g. unverified line) is skipped
            ],
          },
          exchangeLineItems: { nodes: [] },
        },
      ],
    },
  } as RawOrder;
}

describe("assessRisk", () => {
  it("flags never-received and scam notes as chargeback risk", () => {
    const r = assessRisk({ status: "REQUESTED", ageDays: 1, notes: ["You never sent box this is a scam"], isSubscription: true, orderTotal: 39 });
    expect(r.level).toBe("high");
    expect(r.flags).toEqual(expect.arrayContaining(["Says item never arrived", "Mentions scam, fraud, or bank"]));
  });

  it("flags unknown-membership renewals as subscription disputes", () => {
    const r = assessRisk({ status: "REQUESTED", ageDays: 0, notes: ["I didn't know I had this membership"], isSubscription: true, orderTotal: 39 });
    expect(r.level).toBe("high");
    expect(r.flags).toContain("Subscription renewal dispute");
  });

  it("keeps a fresh size swap routine", () => {
    expect(assessRisk({ status: "REQUESTED", ageDays: 1, notes: ["Wrong size"], isSubscription: false, orderTotal: 52 })).toEqual({ level: "low", flags: [] });
  });

  it("escalates requests that have waited past the SLA", () => {
    expect(assessRisk({ status: "REQUESTED", ageDays: 4, notes: ["Other"], isSubscription: false, orderTotal: 50 }).level).toBe("medium");
    expect(assessRisk({ status: "REQUESTED", ageDays: 20, notes: ["Other"], isSubscription: false, orderTotal: 50 }).level).toBe("high");
  });

  it("flags approved returns that were never closed", () => {
    const r = assessRisk({ status: "OPEN", ageDays: 30, notes: [], isSubscription: false, orderTotal: 50 });
    expect(r.flags).toContain("Approved 30 days ago, not closed");
    expect(r.level).toBe("medium");
  });
});

describe("normalizeOrders + sortQueue", () => {
  it("maps Shopify returns into queue items and drops non-matching statuses", () => {
    const items = normalizeOrders(
      [order({ name: "#1" }), order({ name: "#2", status: "OPEN", approved: "2026-09-01T00:00:00Z" })],
      ["REQUESTED"],
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      orderName: "#1",
      ageDays: 1,
      customerEmail: "t@example.com",
      lines: [{ fulfillmentLineItemId: "gid://shopify/FulfillmentLineItem/7", productId: "gid://shopify/Product/3", unitPrice: 50, variantTitle: "2XL" }],
    });
  });

  it("ages open returns from approval, not request", () => {
    const [item] = normalizeOrders([order({ status: "OPEN", requested: "2026-08-01T00:00:00Z", approved: "2026-10-10T00:00:00Z" })], ["OPEN"], NOW);
    expect(item.ageDays).toBe(3);
  });

  it("puts high-risk first, then oldest", () => {
    const items = normalizeOrders(
      [
        order({ name: "#fresh", requested: "2026-10-13T10:00:00Z" }),
        order({ name: "#old", requested: "2026-10-09T10:00:00Z" }),
        order({ name: "#scam", requested: "2026-10-13T10:00:00Z", note: "never received this package" }),
      ],
      ["REQUESTED"],
      NOW,
    );
    expect(sortQueue(items).map((i) => i.orderName)).toEqual(["#scam", "#old", "#fresh"]);
  });

  it("marks subscription orders from Shopify tags", () => {
    const [item] = normalizeOrders([order({ tags: ["Subscription Recurring Order"] })], ["REQUESTED"], NOW);
    expect(item.isSubscription).toBe(true);
  });
});

describe("buildExchangeInput", () => {
  it("pairs each returned line with its replacement variant", () => {
    expect(
      buildExchangeInput("gid://shopify/Order/1", [
        { fulfillmentLineItemId: "gid://shopify/FulfillmentLineItem/7", quantity: 1, returnReason: "SIZE_TOO_SMALL", customerNote: "Wrong size", replacementVariantId: "gid://shopify/ProductVariant/8", replacementQuantity: 1 },
      ]),
    ).toEqual({
      orderId: "gid://shopify/Order/1",
      returnLineItems: [{ fulfillmentLineItemId: "gid://shopify/FulfillmentLineItem/7", quantity: 1, returnReason: "SIZE_TOO_SMALL", customerNote: "Wrong size" }],
      exchangeLineItems: [{ variantId: "gid://shopify/ProductVariant/8", quantity: 1 }],
    });
  });

  it("refuses an empty exchange", () => {
    expect(() => buildExchangeInput("gid://shopify/Order/1", [])).toThrow();
  });
});

describe("fetchReturnOrders", () => {
  it("pages through Shopify and reports truncation", async () => {
    process.env.SHOPIFY_STORE_DOMAIN = "mullybox.myshopify.com";
    process.env.SHOPIFY_ADMIN_TOKEN = "shpat_test";
    const page = (hasNextPage: boolean) =>
      new Response(JSON.stringify({ data: { orders: { pageInfo: { hasNextPage, endCursor: "c" }, nodes: [order({})] } } }), { status: 200 });
    const fetcher = vi.fn().mockResolvedValueOnce(page(true)).mockResolvedValueOnce(page(false));
    const res = await fetchReturnOrders("return_status:return_requested", 6, fetcher as unknown as typeof fetch);
    expect(res).toMatchObject({ truncated: false });
    expect(res.orders).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0][0])).toBe("https://mullybox.myshopify.com/admin/api/2026-07/graphql.json");
    const body = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(body.variables).toEqual({ q: "return_status:return_requested", after: "c" });
  });
});
