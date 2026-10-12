import { describe, expect, it } from "vitest";
import { isJoinOrder, quoteJoinRefund } from "@/lib/mullyAccess/joinRefund";

const ACCESS = 50477797081280;
const line = (variantId: number, price: number, discount = 0, quantity = 1) =>
  ({ variantId, price, quantity, discount, requiresShipping: variantId !== ACCESS });

describe("Mully Access join refund", () => {
  it("refunds the full 10% when nothing else is discounted", () => {
    const q = quoteJoinRefund([line(ACCESS, 15), line(1, 185)], ACCESS, 0.1);
    expect(q).toMatchObject({ merchandiseSubtotal: 185, memberDiscount: 18.5, productRefund: 18.5 });
  });

  it("refunds only the gap when BOGO15 already applied", () => {
    // Two pieces, BOGO15 took 15% off the $127.50 piece ($19.13).
    const q = quoteJoinRefund([line(ACCESS, 15), line(1, 185), line(2, 127.5, 19.13)], ACCESS, 0.1);
    expect(q.memberDiscount).toBe(31.25);
    expect(q.productRefund).toBe(12.12);
  });

  it("never refunds product value when the existing discount is better", () => {
    const q = quoteJoinRefund([line(ACCESS, 15), line(1, 100, 30)], ACCESS, 0.1);
    expect(q.productRefund).toBe(0);
  });

  it("ignores the membership line itself", () => {
    expect(quoteJoinRefund([line(ACCESS, 15)], ACCESS, 0.1).merchandiseSubtotal).toBe(0);
  });

  it("treats renewal orders (Access line only) as non-join", () => {
    expect(isJoinOrder([line(ACCESS, 15)], ACCESS)).toBe(false);
    expect(isJoinOrder([line(ACCESS, 15), line(1, 50)], ACCESS)).toBe(true);
    expect(isJoinOrder([line(1, 50)], ACCESS)).toBe(false);
  });
});
