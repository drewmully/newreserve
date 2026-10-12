import { describe, expect, it } from "vitest";
import { cartLinesDiscountsGenerateRun, cartDeliveryOptionsDiscountsGenerateRun, ACCESS_VARIANT_ID } from "../../shopify-extensions/mully-reassurance/extensions/mully-access-cart-discount/src/rules.js";

const line = (id: string, variant: string) => ({ id, merchandise: { __typename: "ProductVariant", id: variant } });
const both = { discountClasses: ["ORDER", "SHIPPING"] };

describe("Mully Access cart rule", () => {
  it("takes 10% off everything except the membership", () => {
    const out = cartLinesDiscountsGenerateRun({ cart: { lines: [line("a", ACCESS_VARIANT_ID), line("b", "gid://shopify/ProductVariant/1")] }, discount: both });
    const c = out.operations[0].orderDiscountsAdd.candidates[0];
    expect(c.value.percentage.value).toBe(10);
    expect(c.targets[0].orderSubtotal.excludedCartLineIds).toEqual(["a"]);
  });
  it("does nothing without Access in the cart", () => {
    expect(cartLinesDiscountsGenerateRun({ cart: { lines: [line("b", "gid://shopify/ProductVariant/1")] }, discount: both }).operations).toEqual([]);
    expect(cartDeliveryOptionsDiscountsGenerateRun({ cart: { lines: [line("b", "x")], deliveryGroups: [{ id: "g" }] }, discount: both }).operations).toEqual([]);
  });
  it("frees every delivery group when Access is in the cart", () => {
    const out = cartDeliveryOptionsDiscountsGenerateRun({ cart: { lines: [line("a", ACCESS_VARIANT_ID)], deliveryGroups: [{ id: "g1" }, { id: "g2" }] }, discount: both });
    expect(out.operations[0].deliveryDiscountsAdd.candidates[0].targets).toHaveLength(2);
    expect(out.operations[0].deliveryDiscountsAdd.candidates[0].value.percentage.value).toBe(100);
  });
  it("respects the discount classes it was created with", () => {
    expect(cartLinesDiscountsGenerateRun({ cart: { lines: [line("a", ACCESS_VARIANT_ID), line("b", "x")] }, discount: { discountClasses: ["SHIPPING"] } }).operations).toEqual([]);
  });
});
