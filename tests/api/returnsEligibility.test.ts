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
    expect(e.rules.resolution).toBe("refund_original_payment");
    expect(e.email).toBe("member@example.com");
    expect(e.lines[0]).toMatchObject({ lineItemId: "91", returnableQty: 2, image: "https://cdn.shopify.com/cap.jpg", unitPrice: 40, ineligibleReason: null });
    expect(e.lines[1].image).toBe("https://cdn.shopify.com/p.jpg");
  });

  it("subscription orders get store credit rules", () => {
    const e = computeEligibility(
      order({ tags: ["Subscription Recurring Order"], lineItems: [line({ id: 91 })], fulfillments: [fulfillment(1, [{ fli: 501, lineItem: 91 }])] }),
      NOW
    );
    expect(e.orderType).toBe("subscription");
    expect(e.rules.resolution).toBe("store_credit");
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
      { fulfillmentLineItemId: "gid://shopify/FulfillmentLineItem/11", quantity: 1 },
      { fulfillmentLineItemId: "gid://shopify/FulfillmentLineItem/12", quantity: 1 },
    ]);
    expect(allocateReturnQuantity(e.lines[0], 4)).toEqual([]);
  });
});
