import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/shopify", () => ({ getProductByHandle: vi.fn() }));
import { fitToRows, heroRail, type GiftPick, type GiftTierData, GIFT_GUIDE_TIERS } from "@/lib/giftGuide";

const pick = (slug: string, inStock: boolean) => ({ product: { slug }, inStock }) as unknown as GiftPick;
const many = (n: number, inStock: boolean, prefix: string) => Array.from({ length: n }, (_, i) => pick(`${prefix}${i}`, inStock));

describe("fitToRows", () => {
  it("keeps full rows and fills a grid one short", () => {
    expect(fitToRows(many(8, true, "a"))).toMatchObject({ fill: false });
    const seven = fitToRows([...many(5, true, "a"), ...many(2, false, "r")]);
    expect(seven.picks).toHaveLength(7);
    expect(seven.fill).toBe(true);
  });
  it("drops trailing Restocking picks, never in-stock ones", () => {
    const nine = fitToRows([...many(5, true, "a"), ...many(4, false, "r")]);
    expect(nine.picks).toHaveLength(8);
    expect(nine.fill).toBe(false);
    const five = fitToRows(many(5, true, "a"));
    expect(five.picks).toHaveLength(5);
  });
});

describe("heroRail", () => {
  it("takes four in-stock picks, two from the hero tier first", () => {
    const tiers: GiftTierData[] = GIFT_GUIDE_TIERS.map((tier) => ({
      tier,
      picks: [pick(`${tier.slug}-out`, false), ...many(3, true, `${tier.slug}-`)],
    }));
    expect(heroRail(tiers).map((p) => p.product.slug)).toEqual(["150-to-250-0", "150-to-250-1", "100-to-150-0", "under-100-0"]);
  });
});
