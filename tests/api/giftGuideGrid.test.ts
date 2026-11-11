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
    expect(heroRail(tiers).map((p) => p.tier)).toEqual(["150-to-250", "150-to-250", "100-to-150", "under-100"]);
  });
  it("skips products already in the first grid row", () => {
    const tiers: GiftTierData[] = GIFT_GUIDE_TIERS.map((tier) => ({ tier, picks: many(4, true, `${tier.slug}-`) }));
    const rail = heroRail(tiers, 4, new Set(["150-to-250-0", "150-to-250-1"]));
    expect(rail.map((p) => p.product.slug)).toEqual(["150-to-250-2", "150-to-250-3", "100-to-150-0", "under-100-0"]);
  });
});

describe("excluded handles", () => {
  it("never lists the CM26 sock in a tier or outfit", async () => {
    const { GIFT_EXCLUDED_HANDLES, GIFT_OUTFITS } = await import("@/lib/giftGuide");
    const listed = [...GIFT_GUIDE_TIERS.flatMap((t) => t.picks), ...GIFT_OUTFITS.flatMap((o) => o.looks.flatMap((l) => [l.anchor, ...l.with]))];
    expect(GIFT_EXCLUDED_HANDLES.has("rhone-c-o-r-crew-sock")).toBe(true);
    expect(listed.filter((h) => GIFT_EXCLUDED_HANDLES.has(h))).toEqual([]);
  });

  it("drops an excluded handle from the live guide even if it is curated", async () => {
    const shopify = await import("@/lib/shopify");
    const { loadGiftGuide, GIFT_EXCLUDED_HANDLES } = await import("@/lib/giftGuide");
    const seen: string[] = [];
    vi.mocked(shopify.getProductByHandle).mockImplementation(async (h: string) => {
      seen.push(h);
      return { slug: h, price: 20, variants: [{ id: "v", availableForSale: true, selectedOptions: [] }] } as never;
    });
    const { tiers } = await loadGiftGuide();
    const shown = tiers.flatMap((t) => t.picks.map((p) => p.product.slug));
    for (const h of GIFT_EXCLUDED_HANDLES) {
      expect(seen).not.toContain(h);
      expect(shown).not.toContain(h);
    }
  });
});
