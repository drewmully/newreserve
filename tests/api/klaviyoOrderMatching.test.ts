import { describe, expect, it } from "vitest";
import { classifyPaidOrder, matchOrderDelivery, shopifyId } from "@/lib/klaviyo/orderMatching";
const line = { id: 101, variant_id: 12345, quantity: 2, requires_shipping: true, selling_plan_allocation: null, sku: "POLO" };
const order = { id: 10, test: false, financial_status: "paid", total_price: "80.00", refunds: [],
  cancelled_at: null, source_name: "channel:7831744", line_items: [line] };
const shipment = { id: 501, order_id: 10, status: "success", shipment_status: "delivered",
  updated_at: "2026-10-08T10:00:00Z", line_items: [{ id: 101, quantity: 2 }] };

describe("order-scoped lifecycle audit", () => {
  it("normalizes numeric/GID IDs without losing large ID precision", () => {
    expect(shopifyId("gid://shopify/Order/9007199254740993")).toBe("9007199254740993");
    expect(shopifyId(9007199254740993)).toBeNull();
    expect(shopifyId("10oops")).toBeNull();
  });
  it("classifies real headless shop sources without assuming all sources are shop", () => {
    expect(classifyPaidOrder(order)).toMatchObject({ kind: "shop", paidCandidate: true });
    expect(classifyPaidOrder({ ...order, source_name: "unverified-app" }).paidCandidate).toBe(false);
  });
  it.each(["RES-MEM", "RES-ACC", "BCK-9"])("recognizes legacy subscription SKU %s", sku => {
    expect(classifyPaidOrder({ ...order, line_items: [{ ...line, sku }] }).kind).toBe("subscription");
  });
  it("recognizes native outfit subscriptions, selling plans and renewal source", () => {
    for (const changes of [{ variant_id: 50408581267648 }, { selling_plan_id: 22 },
      { selling_plan_allocation: { selling_plan: { id: 22 } } }]) {
      expect(classifyPaidOrder({ ...order, line_items: [{ ...line, ...changes }] }).kind).toBe("subscription");
    }
    expect(classifyPaidOrder({ ...order, source_name: "subscription_contract_checkout_one" }).kind).toBe("subscription");
  });
  it("holds mixed shop/membership baskets", () => {
    expect(classifyPaidOrder({ ...order, line_items: [line, { ...line, id: 102, sku: "RES-MEM" }] }))
      .toMatchObject({ kind: "mixed", paidCandidate: false });
  });
  it.each([
    { cancelled_at: "2026-10-08" }, { financial_status: "partially_refunded" }, { refunds: [{}] },
    { total_price: "0" }, { test: true }, { test: undefined }, { refunds: undefined },
    { line_items: [] }, { line_items: [line, line] }, { line_items: [{ ...line, quantity: 0 }] },
  ])("holds unsafe or incomplete paid snapshots: %j", change => {
    expect(classifyPaidOrder({ ...order, ...change }).paidCandidate).toBe(false);
  });
  it("requires carrier delivered, not fulfilled/in-transit/created", () => {
    for (const shipment_status of [undefined, "in_transit", "confirmed"]) {
      expect(matchOrderDelivery(order, [{ ...shipment, shipment_status }]).complete).toBe(false);
    }
    expect(matchOrderDelivery(order, [shipment]).complete).toBe(true);
  });
  it("never substitutes another order, even with the same customer", () => {
    expect(matchOrderDelivery(order, [{ ...shipment, order_id: 11 }]).complete).toBe(false);
    expect(matchOrderDelivery({ ...order, id: 11 }, [shipment]).complete).toBe(false);
  });
  it("dedupes fulfillment IDs and requires every ordered quantity", () => {
    const partial = { ...shipment, line_items: [{ id: 101, quantity: 1 }] };
    expect(matchOrderDelivery(order, [partial, partial]).complete).toBe(false);
    expect(matchOrderDelivery(order, [partial, { ...partial, id: 502 }]).complete).toBe(true);
    expect(matchOrderDelivery(order, [shipment, shipment]).fulfillmentIds).toEqual(["501"]);
    expect(matchOrderDelivery(order, [shipment, { ...shipment, id: 502 }]).reason).toBe("overlapping_fulfillment_quantities");
  });
  it("uses newest fulfillment state regardless of arrival order", () => {
    const cancelled = { ...shipment, status: "cancelled", updated_at: "2026-10-08T11:00:00Z" };
    for (const events of [[shipment, cancelled], [cancelled, shipment]]) {
      expect(matchOrderDelivery(order, events).complete).toBe(false);
    }
  });
  it("rejects wrong line IDs and ambiguous same-time fulfillment states", () => {
    expect(matchOrderDelivery(order, [{ ...shipment, line_items: [{ id: 999, quantity: 2 }] }]).complete).toBe(false);
    expect(matchOrderDelivery(order, [shipment, { ...shipment, status: "cancelled" }]).complete).toBe(false);
  });
});
