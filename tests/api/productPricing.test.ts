import { describe, expect, it } from "vitest";
import {
  resolveTieredPrice,
  resolveTieredPriceDisplay,
} from "@/lib/productPricing";

describe("productPricing helpers", () => {
  it("keeps free users on the retail price while still exposing the member price", () => {
    expect(
      resolveTieredPrice({ price: 38, reservePrice: 28 }, false)
    ).toBe(38);

    expect(
      resolveTieredPriceDisplay({ price: 38, reservePrice: 28 }, false)
    ).toEqual({
      activePrice: 38,
      compareAtPrice: null,
      memberPrice: 28,
      badgeLabel: "Member Price",
    });
  });

  it("shows reserve pricing only for paid members", () => {
    expect(
      resolveTieredPrice({ price: 38, reservePrice: 28 }, true)
    ).toBe(28);

    expect(
      resolveTieredPriceDisplay({ price: 38, reservePrice: 28 }, true)
    ).toEqual({
      activePrice: 28,
      compareAtPrice: 38,
      memberPrice: null,
      badgeLabel: "Member Price",
    });
  });
});
