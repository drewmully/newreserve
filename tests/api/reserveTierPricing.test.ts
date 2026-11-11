import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/app/api/_lib/shopifyAdmin", () => ({ shopifyGraphQL: vi.fn() }));
vi.mock("@/lib/takeAShot/discountToken", () => ({ discountGraphQL: vi.fn() }));

import { computeReserveTierValues, RESERVE_TIER_CODES } from "@/lib/reserveTierPricing";
import { getLiveReserveTierValues, parseTierDiscount } from "@/lib/reserveTierPricing.server";
import { shopifyGraphQL } from "@/app/api/_lib/shopifyAdmin";
import { discountGraphQL } from "@/lib/takeAShot/discountToken";

const amountNode = (amount: string, status = "ACTIVE") => ({
  codeDiscountNodeByCode: {
    codeDiscount: {
      __typename: "DiscountCodeBasic",
      status,
      customerGets: { value: { __typename: "DiscountAmount", amount: { amount } } },
    },
  },
});

describe("reserve tier pricing", () => {
  it("matches today's live Shopify setup: $250 RES-MEM, $200 and $125 off", () => {
    expect(
      computeReserveTierValues(250, {
        MULLY_DISCOVER: { kind: "amount", amount: 200 },
        MULLY_SIGNATURE: { kind: "amount", amount: 125 },
      })
    ).toEqual({ discovery: 50, signature: 125, reserve: 250 });
  });

  it("follows a price or discount change", () => {
    expect(
      computeReserveTierValues(275, {
        MULLY_DISCOVER: { kind: "percent", percentage: 0.5 },
        MULLY_SIGNATURE: { kind: "amount", amount: 125 },
      })
    ).toEqual({ discovery: 137.5, signature: 150, reserve: 275 });
  });

  it("returns null instead of guessing when a read is missing", () => {
    expect(computeReserveTierValues(null, {})).toBeNull();
    expect(
      computeReserveTierValues(250, { MULLY_DISCOVER: { kind: "amount", amount: 200 } })
    ).toBeNull();
  });

  it("parses Admin discount responses; inactive or unknown is null", () => {
    expect(parseTierDiscount(amountNode("200.0"))).toEqual({ kind: "amount", amount: 200 });
    expect(parseTierDiscount(amountNode("200.0", "EXPIRED"))).toBeNull();
    expect(parseTierDiscount({ codeDiscountNodeByCode: null })).toBeNull();
    expect(Object.values(RESERVE_TIER_CODES)).toEqual(["MULLY_DISCOVER", "MULLY_SIGNATURE", ""]);
  });

  it("reads live Shopify prices, and falls back to null on failure", async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValueOnce({ productVariant: { price: "250.00" } });
    vi.mocked(discountGraphQL).mockImplementation(async (_q, v) =>
      amountNode((v as { code: string }).code === "MULLY_DISCOVER" ? "200.0" : "125.0")
    );
    await expect(getLiveReserveTierValues()).resolves.toEqual({
      discovery: 50,
      signature: 125,
      reserve: 250,
    });
    vi.mocked(shopifyGraphQL).mockRejectedValueOnce(new Error("down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(getLiveReserveTierValues()).resolves.toBeNull();
    warn.mockRestore();
  });

  it("falls back when Shopify is slower than the timeout", async () => {
    vi.mocked(shopifyGraphQL).mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ productVariant: { price: "250.00" } }), 200))
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(getLiveReserveTierValues(20)).resolves.toBeNull();
    warn.mockRestore();
  });
});
