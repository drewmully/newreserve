import { describe, expect, it } from "vitest";
import { normalizeCommerce, selectLatestSnapshots, collectCommerceSnapshot, type ShopifySnapshot, type CommerceDecision } from "@/lib/analytics/commerce";
import { collectPages, decimal, micros, nyDate, key } from "@/lib/analytics/primitives";
export const fixtureOrder = (): ShopifySnapshot => ({
  shop: "fixture", id: "1", createdAt: "2026-03-08T06:00:00Z", updatedAt: "2026-03-09T12:00:00Z",
  currency: "USD", paidAt: "2026-03-08T06:01:00Z", paidEvidenceRef: "transaction-1",
  checkoutId: null, shippingCountry: "US", shippingRegion: "NY", linesComplete: true,
  lines: [{ id: "line-1", sku: "SKU", productId: "product", quantity: 2, itemClass: "merchandise",
    unitPrice: "10.123456", merchandiseDiscount: "1.00", purchaseEvidenceRef: "purchase-snapshot",
    offers: [{ id: "offer", evidenceRef: "e", mappingVersion: "v1" }] }],
});
const decision: CommerceDecision = { eligibility: "eligible", commerceSource: "storefront", acquisitionEligible: true, approvalRef: "fixture-policy" };
describe("commerce normalization", () => {
  it("keeps exact frozen purchase amounts and shape-complete rows", () => {
    const rows = normalizeCommerce(fixtureOrder(), decision, "p");
    expect(rows.orders[0].purchase_merchandise_net_usd).toBe("19.246912");
    expect(rows.orders[0].customer_id).toBeNull();
    expect(rows.order_items[0].quantity).toBe("2.000000");
  });
  it("keeps non-USD unknown rather than fabricated zero", () => {
    const rows = normalizeCommerce({ ...fixtureOrder(), currency: "CAD" }, decision, "p");
    expect(rows.orders[0].purchase_merchandise_net_usd).toBeNull();
    expect(rows.order_items[0].purchase_value_complete).toBe(false);
  });
  it("does not infer purchase values from missing original evidence", () => {
    const s = fixtureOrder(); s.lines[0].purchaseEvidenceRef = null;
    expect(normalizeCommerce(s, decision, "p").orders[0].purchase_merchandise_net_usd).toBeNull();
  });
  it("rejects missing lines, duplicate lines and unproven paid status", () => {
    expect(() => normalizeCommerce({ ...fixtureOrder(), linesComplete: false }, decision, "p")).toThrow();
    const s = fixtureOrder(); s.lines.push(s.lines[0]);
    expect(() => normalizeCommerce(s, decision, "p")).toThrow("duplicate_line");
    expect(() => normalizeCommerce({ ...fixtureOrder(), paidEvidenceRef: null }, decision, "p")).toThrow();
  });
  it("deduplicates offer membership without adding merchandise twice", () => {
    const s = fixtureOrder(); s.lines[0].offers.push(s.lines[0].offers[0]);
    const result = normalizeCommerce(s, decision, "p");
    expect(result.order_item_offers).toHaveLength(1);
    expect(result.order_items).toHaveLength(1);
  });
  it("rejects contradictory equal revisions; ignores old arrivals", () => {
    const old = { ...fixtureOrder(), updatedAt: "2026-03-08T12:00:00Z" };
    expect(selectLatestSnapshots([fixtureOrder(), old, fixtureOrder()])).toHaveLength(1);
    expect(() => selectLatestSnapshots([fixtureOrder(), { ...fixtureOrder(), currency: "CAD" }])).toThrow();
  });
  it("collects nested pages and rejects a repeated cursor or truncation", async () => {
    const order = fixtureOrder();
    const rows = await collectCommerceSnapshot(async () => ({ rows: [order], hasNextPage: false, endCursor: null }),
      async (_, cursor) => ({ rows: [{ ...order.lines[0], id: cursor ? "2" : "1" }], hasNextPage: !cursor, endCursor: "next" }), 2, 2);
    expect(rows[0].lines).toHaveLength(2);
    await expect(collectPages(async () => ({ rows: [], hasNextPage: true, endCursor: "same" }), 3)).rejects.toThrow("invalid_pagination");
    await expect(collectPages(async () => ({ rows: [], hasNextPage: true, endCursor: "next" }), 1)).rejects.toThrow("incomplete_pagination");
  });
  it("uses actual New York dates across DST and collision-safe tuple keys", () => {
    expect(nyDate("2026-03-08T04:30:00Z")).toBe("2026-03-07");
    expect(nyDate("2026-03-09T04:30:00Z")).toBe("2026-03-09");
    expect(key("a|b", "c")).not.toBe(key("a", "b|c"));
    expect(decimal(micros("99999999999999.999999"))).toBe("99999999999999.999999");
  });
});
