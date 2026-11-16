import { describe, expect, it } from "vitest";
import { allocateReturnQuantity, computeEligibility } from "@/lib/returns/eligibility";
import { NOW, daysAgo, fulfillment, line, order, ret } from "../fixtures/returnsOrder";

describe("computeEligibility", () => {
  it("returns images, prices and returnable quantity for a delivered Pro Shop order", () => {
    const e = computeEligibility(
      order({
        lineItems: [line({ id: 91, quantity: 2, image: "https://cdn.shopify.com/cap.jpg" }), line({ id: 92, image: null, productImage: "https://cdn.shopify.com/p.jpg" })],
        fulfillments: [fulfillment(1, [{ fli: 501, lineItem: 91, quantity: 2 }, { fli: 502, lineItem: 92 }])],
      }),
      NOW
    );
    expect(e.orderType).toBe("pro_shop");
    expect(e.lines[0].resolution).toBe("refund_original_payment");
    expect(e.email).toBe("member@example.com");
    expect(e.lines[0]).toMatchObject({ lineItemId: "91", returnableQty: 2, image: "https://cdn.shopify.com/cap.jpg", unitPrice: 40, ineligibleReason: null });
    expect(e.lines[1].image).toBe("https://cdn.shopify.com/p.jpg");
  });

  it("subscription orders use the 14-day refund / day 15-30 store credit schedule", () => {
    const e = computeEligibility(
      order({ tags: ["Subscription Recurring Order"], lineItems: [line({ id: 91 })], fulfillments: [fulfillment(1, [{ fli: 501, lineItem: 91 }])] }),
      NOW
    );
    expect(e.orderType).toBe("subscription");
    expect(e.rules.resolutionSchedule.map((s) => [s.throughDay, s.resolution])).toEqual([
      [14, "refund_original_payment"],
      [30, "store_credit"],
    ]);
    // Fixture delivery is 10 days ago: refund.
    expect(e.lines[0].resolution).toBe("refund_original_payment");
  });

  it("marks final sale, unfulfilled and already-returned items", () => {
    const e = computeEligibility(
      order({
        lineItems: [
          line({ id: 1, attrs: [{ key: "_final_sale", value: "true" }] }),
          line({ id: 2 }),
          line({ id: 3, quantity: 2 }),
          line({ id: 4, quantity: 2, refundableQuantity: 1 }),
        ],
        fulfillments: [fulfillment(1, [{ fli: 11, lineItem: 1 }, { fli: 13, lineItem: 3, quantity: 2 }, { fli: 14, lineItem: 4, quantity: 2 }])],
        returns: [ret("REQUESTED", [{ fli: 13, lineItem: 3, quantity: 2 }])],
      }),
      NOW
    );
    expect(e.lines.map((l) => [l.lineItemId, l.ineligibleReason, l.returnableQty])).toEqual([
      ["1", "final_sale", 0],
      ["2", "not_fulfilled", 0],
      ["3", "already_returned", 0],
      ["4", null, 1],
    ]);
  });

  it("ignores declined/canceled returns and doesn't double count refund + closed return", () => {
    const e = computeEligibility(
      order({
        lineItems: [line({ id: 1, quantity: 2 }), line({ id: 2, quantity: 2, refundableQuantity: 1 })],
        fulfillments: [fulfillment(1, [{ fli: 11, lineItem: 1, quantity: 2 }, { fli: 12, lineItem: 2, quantity: 2 }])],
        returns: [ret("DECLINED", [{ fli: 11, lineItem: 1, quantity: 2 }]), ret("CLOSED", [{ fli: 12, lineItem: 2, quantity: 1 }])],
      }),
      NOW
    );
    expect(e.lines[0].returnableQty).toBe(2);
    expect(e.lines[1].returnableQty).toBe(1);
  });

  it("refunds of unshipped units don't block returning shipped units", () => {
    const e = computeEligibility(
      order({ lineItems: [line({ id: 1, quantity: 2, refundableQuantity: 1 })], fulfillments: [fulfillment(1, [{ fli: 11, lineItem: 1, quantity: 1 }])] }),
      NOW
    );
    expect(e.lines[0].returnableQty).toBe(1);
  });

  it("applies the window per fulfillment (delivered day 31 closed, other shipment open)", () => {
    const e = computeEligibility(
      order({
        createdAt: daysAgo(60),
        lineItems: [line({ id: 1 }), line({ id: 2 })],
        fulfillments: [
          fulfillment(1, [{ fli: 11, lineItem: 1 }], { createdAt: daysAgo(33), deliveredAt: daysAgo(31) }),
          fulfillment(2, [{ fli: 12, lineItem: 2 }], { createdAt: daysAgo(32), deliveredAt: daysAgo(30) }),
        ],
      }),
      NOW
    );
    expect(e.lines[0].ineligibleReason).toBe("outside_window");
    expect(e.lines[1].returnableQty).toBe(1);
    expect(e.allFulfillmentsOutsideWindow).toBe(false);
  });

  it("an order placed 60 days ago but delivered 10 days ago is returnable (old 45-day order-date rule would reject)", () => {
    const e = computeEligibility(
      order({ createdAt: daysAgo(60), lineItems: [line({ id: 1 })], fulfillments: [fulfillment(1, [{ fli: 11, lineItem: 1 }], { createdAt: daysAgo(15), deliveredAt: daysAgo(10) })] }),
      NOW
    );
    expect(e.lines[0].returnableQty).toBe(1);
  });

  it("flags whole order outside window; ignores cancelled fulfillments", () => {
    const e = computeEligibility(
      order({
        lineItems: [line({ id: 1 })],
        fulfillments: [
          fulfillment(1, [{ fli: 11, lineItem: 1 }], { createdAt: daysAgo(40), deliveredAt: null }),
          fulfillment(2, [{ fli: 12, lineItem: 1 }], { status: "CANCELLED" }),
        ],
      }),
      NOW
    );
    expect(e.allFulfillmentsOutsideWindow).toBe(true);
    expect(e.lines[0].ineligibleReason).toBe("outside_window");
  });

  it("allocates a quantity across in-window fulfillment line items", () => {
    const e = computeEligibility(
      order({
        lineItems: [line({ id: 1, quantity: 3 })],
        fulfillments: [fulfillment(1, [{ fli: 11, lineItem: 1, quantity: 1 }]), fulfillment(2, [{ fli: 12, lineItem: 1, quantity: 2 }])],
      }),
      NOW
    );
    expect(e.lines[0].returnableQty).toBe(3);
    expect(allocateReturnQuantity(e.lines[0], 2)).toEqual([
      { fulfillmentLineItemId: "gid://shopify/FulfillmentLineItem/11", quantity: 1, resolution: "refund_original_payment" },
      { fulfillmentLineItemId: "gid://shopify/FulfillmentLineItem/12", quantity: 1, resolution: "refund_original_payment" },
    ]);
    expect(allocateReturnQuantity(e.lines[0], 4)).toEqual([]);
  });
});

describe("computeEligibility: subscription refund vs store credit by delivery day", () => {
  const sub = (deliveredDaysAgo: number, extraMs = 0) =>
    computeEligibility(
      order({
        tags: ["Subscription First Order"],
        lineItems: [line({ id: 1 })],
        fulfillments: [
          fulfillment(1, [{ fli: 11, lineItem: 1 }], {
            createdAt: daysAgo(deliveredDaysAgo + 3),
            deliveredAt: new Date(new Date(daysAgo(deliveredDaysAgo)).getTime() - extraMs).toISOString(),
          }),
        ],
      }),
      NOW
    ).lines[0];

  it("day 14 = refund to original payment", () => {
    const l = sub(14);
    expect(l.resolution).toBe("refund_original_payment");
    expect(l.returnableQty).toBe(1);
    expect(l.resolutionUntil).toBe(NOW.toISOString());
  });
  it("day 15 = store credit (just past 14 x 24h)", () => {
    expect(sub(14, 60_000).resolution).toBe("store_credit");
    expect(sub(15).resolution).toBe("store_credit");
  });
  it("day 30 = store credit, still returnable", () => {
    const l = sub(30);
    expect(l.resolution).toBe("store_credit");
    expect(l.returnableQty).toBe(1);
    expect(l.ineligibleReason).toBeNull();
  });
  it("day 31 = closed", () => {
    const l = sub(31);
    expect(l.returnableQty).toBe(0);
    expect(l.ineligibleReason).toBe("outside_window");
    expect(l.resolution).toBeNull();
    expect(l.allocations).toEqual([]);
  });
  it("Pro Shop stays refund through day 30", () => {
    const e = computeEligibility(
      order({
        lineItems: [line({ id: 1 })],
        fulfillments: [fulfillment(1, [{ fli: 11, lineItem: 1 }], { createdAt: daysAgo(33), deliveredAt: daysAgo(30) })],
      }),
      NOW
    );
    expect(e.orderType).toBe("pro_shop");
    expect(e.lines[0].resolution).toBe("refund_original_payment");
  });
  it("unknown delivery uses fulfillment createdAt + 7 days for the schedule", () => {
    const mk = (createdDaysAgo: number) =>
      computeEligibility(
        order({
          tags: ["Subscription Recurring Order"],
          lineItems: [line({ id: 1 })],
          fulfillments: [fulfillment(1, [{ fli: 11, lineItem: 1 }], { createdAt: daysAgo(createdDaysAgo), deliveredAt: null })],
        }),
        NOW
      ).lines[0];
    expect(mk(21).resolution).toBe("refund_original_payment"); // est. delivered 14 days ago
    expect(mk(22).resolution).toBe("store_credit"); // est. 15 days ago
    expect(mk(37).resolution).toBe("store_credit"); // est. 30 days ago
    expect(mk(38).ineligibleReason).toBe("outside_window"); // est. 31 days ago
  });
});

describe("computeEligibility: mixed shipments", () => {
  it("each shipment gets its own resolution; lines differ within one order", () => {
    const e = computeEligibility(
      order({
        tags: ["Subscription Recurring Order"],
        lineItems: [line({ id: 1 }), line({ id: 2 })],
        fulfillments: [
          fulfillment(1, [{ fli: 11, lineItem: 1 }], { createdAt: daysAgo(23), deliveredAt: daysAgo(20) }),
          fulfillment(2, [{ fli: 21, lineItem: 2 }], { createdAt: daysAgo(8), deliveredAt: daysAgo(5) }),
        ],
      }),
      NOW
    );
    expect(e.lines.map((l) => [l.lineItemId, l.resolution])).toEqual([
      ["1", "store_credit"],
      ["2", "refund_original_payment"],
    ]);
  });

  it("a line split across shipments uses refund-eligible units first", () => {
    const e = computeEligibility(
      order({
        tags: ["Subscription Recurring Order"],
        lineItems: [line({ id: 1, quantity: 3 })],
        fulfillments: [
          fulfillment(1, [{ fli: 11, lineItem: 1, quantity: 2 }], { createdAt: daysAgo(23), deliveredAt: daysAgo(20) }),
          fulfillment(2, [{ fli: 12, lineItem: 1, quantity: 1 }], { createdAt: daysAgo(8), deliveredAt: daysAgo(5) }),
        ],
      }),
      NOW
    );
    const l = e.lines[0];
    expect(l.returnableQty).toBe(3);
    expect(l.resolution).toBe("refund_original_payment");
    expect(l.allocations.map((a) => [a.fulfillmentLineItemId.split("/").pop(), a.available, a.resolution])).toEqual([
      ["12", 1, "refund_original_payment"],
      ["11", 2, "store_credit"],
    ]);
    expect(allocateReturnQuantity(l, 1)).toEqual([
      { fulfillmentLineItemId: "gid://shopify/FulfillmentLineItem/12", quantity: 1, resolution: "refund_original_payment" },
    ]);
    expect(allocateReturnQuantity(l, 3)).toEqual([
      { fulfillmentLineItemId: "gid://shopify/FulfillmentLineItem/12", quantity: 1, resolution: "refund_original_payment" },
      { fulfillmentLineItemId: "gid://shopify/FulfillmentLineItem/11", quantity: 2, resolution: "store_credit" },
    ]);
  });
});
