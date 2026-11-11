import { describe, expect, it } from "vitest";
import {
  COMPLETE_LOOK_PAIRINGS,
  bogoSavedFromAllocations,
  cartBogoState,
  completeLookOverridesAllowed,
  defaultLookSize,
  hasBogoBlockingCode,
  isAvailableFor,
  itemsProperty,
  pdpBogoLineApplies,
  selectCompleteLook,
  sizeFromVariantTitle,
  toLookItem,
  type LookItem,
  type LookSourceProduct,
} from "@/lib/pdpCompleteLook";

type Stock = Record<string, boolean>; // size -> in stock

function apparel(slug: string, stock: Stock, opts: { tags?: string[]; price?: number; extraOption?: boolean } = {}): LookItem {
  const sizes = Object.keys(stock);
  const product: LookSourceProduct = {
    slug,
    name: slug,
    brand: "Brand",
    images: [`https://cdn.test/${slug}.jpg`],
    tags: opts.tags ?? ["shop"],
    options: [
      { name: "Color", values: ["Navy"] },
      { name: "Size", values: sizes },
      ...(opts.extraOption ? [{ name: "Fit", values: ["Slim"] }] : []),
    ],
    variants: sizes.map((size) => ({
      id: `gid://shopify/ProductVariant/${slug}-${size}`,
      price: opts.price ?? 100,
      reservePrice: (opts.price ?? 100) * 0.85,
      availableForSale: true, // apparel uses CONTINUE: always sellable
      currentlyNotInStock: !stock[size],
      selectedOptions: [
        { name: "Color", value: "Navy" },
        { name: "Size", value: size },
        ...(opts.extraOption ? [{ name: "Fit", value: "Slim" }] : []),
      ],
    })),
  };
  const item = toLookItem(product);
  if (!item) throw new Error("expected a look item");
  return item;
}

function oneSize(slug: string, inStock: boolean, tags: string[] = ["shop"]): LookItem {
  return toLookItem({
    slug,
    name: slug,
    brand: "Winston",
    images: [],
    tags,
    options: [{ name: "Title", values: ["Default Title"] }],
    variants: [{
      id: `gid://shopify/ProductVariant/${slug}`,
      price: 19.99,
      reservePrice: 16.99,
      availableForSale: inStock,
      currentlyNotInStock: false,
      selectedOptions: [{ name: "Title", value: "Default Title" }],
    }],
  })!;
}

const polo = (stock: Stock = { S: false, M: true, L: true, XL: true, XXL: true }) =>
  apparel("olydoe-pima-long-sleeve-polo", stock);
const sockItem = toLookItem({
  slug: "rhone-c-o-r-crew-sock",
  name: "Sock",
  brand: "Rhone",
  images: [],
  tags: ["gift-under-100"], // not in Shop — All
  options: [{ name: "Size", values: ["M", "L"] }],
  variants: ["M", "L"].map((s) => ({
    id: `sock-${s}`, price: 16, reservePrice: 13.6, availableForSale: true, currentlyNotInStock: false,
    selectedOptions: [{ name: "Size", value: s }],
  })),
})!;
const towel = (inStock = true) => oneSize("winston-golf-tour-towel", inStock);
const rise = (stock: Stock = { S: false, M: true, L: true, XL: false, XXL: false }) =>
  apparel("rhone-rise-quarter-zip", stock);
const jacket = apparel("rhone-long-game-jacket", { S: false, M: true, L: true, XL: true, XXL: false });
const organizer = oneSize("jolly-golf-purist-organizer", true);

describe("pdp_complete_look config", () => {
  it("pairs the three vests with two pieces each", () => {
    expect(COMPLETE_LOOK_PAIRINGS).toEqual({
      "olydoe-merino-ponte-vest": ["olydoe-pima-long-sleeve-polo", "winston-golf-tour-towel"],
      "duckhead-fremont-sport-performance-quilted-vest-brandy-brown": ["rhone-rise-quarter-zip", "winston-golf-tour-towel"],
      "rhone-voyage-down-vest": ["olydoe-pima-long-sleeve-polo", "winston-golf-tour-towel"],
    });
  });
});

describe("toLookItem", () => {
  it("reads BOGO eligibility from the shop tag and stock from currentlyNotInStock", () => {
    const p = polo();
    expect(p.bogoEligible).toBe(true);
    expect(p.sizeApplies).toBe(true);
    expect(p.variants.find((v) => v.size === "S")?.inStock).toBe(false);
    expect(sockItem.bogoEligible).toBe(false);
    expect(sockItem.sizeApplies).toBe(false); // sock sizing, not the vest's
    expect(towel().sizeOption).toBeUndefined();
  });

  it("skips products that need a fit or inseam choice", () => {
    expect(() => apparel("chino-multi-fit", { M: true }, { extraOption: true })).toThrow();
    expect(toLookItem({
      slug: "x", name: "x", brand: "x", images: [], tags: ["shop"],
      options: [{ name: "Size", values: ["M"] }, { name: "Inseam", values: ["30"] }],
      variants: [{ id: "1", price: 1, reservePrice: 1, availableForSale: true, selectedOptions: [{ name: "Size", value: "M" }, { name: "Inseam", value: "30" }] }],
    })).toBeNull();
  });
});

describe("size default", () => {
  it("defaults to the vest size where the size applies", () => {
    expect(defaultLookSize(polo(), "XL")).toBe("XL");
    expect(defaultLookSize(sockItem, "XL")).toBe("M"); // own sizing: first in stock
    expect(defaultLookSize(towel(), "XL")).toBeUndefined();
  });

  it("treats a letter-sized item as unavailable when the vest size is out of stock", () => {
    expect(isAvailableFor(polo(), "S")).toBe(false);
    expect(isAvailableFor(polo(), "M")).toBe(true);
    expect(isAvailableFor(sockItem, "S")).toBe(true); // size does not apply
  });
});

describe("selectCompleteLook pairing and fallback", () => {
  const fallbacks = [polo(), rise(), jacket, organizer, towel(), sockItem];

  it("shows the configured pairing when both pieces are in stock", () => {
    const picks = selectCompleteLook([polo(), towel()], fallbacks, { vestSize: "M", exclude: ["olydoe-merino-ponte-vest"] });
    expect(picks.map((p) => [p.item.slug, p.source, p.position, p.defaultSize])).toEqual([
      ["olydoe-pima-long-sleeve-polo", "pairing", 1, "M"],
      ["winston-golf-tour-towel", "pairing", 2, undefined],
    ]);
  });

  it("hides an item out of stock in the selected size and falls back to the next in-stock guide piece", () => {
    // Fremont in XL: Rise 1/4 Zip has no XL in stock -> next guide piece.
    const picks = selectCompleteLook([rise(), towel()], fallbacks, { vestSize: "XL" });
    expect(picks.map((p) => [p.item.slug, p.source])).toEqual([
      ["olydoe-pima-long-sleeve-polo", "fallback"], // first guide piece with XL in stock
      ["winston-golf-tour-towel", "pairing"],
    ]);
  });

  it("never repeats a piece already shown and skips fallbacks missing the size", () => {
    // Voyage in L with polo shown: the fallback for an OOS towel cannot be polo again.
    const picks = selectCompleteLook([polo(), towel(false)], fallbacks, { vestSize: "XXL" });
    expect(picks.map((p) => p.item.slug)).toEqual([
      "olydoe-pima-long-sleeve-polo",
      "jolly-golf-purist-organizer", // rise and jacket lack XXL stock
    ]);
  });

  it("handles a pairing product that Shopify no longer returns", () => {
    const picks = selectCompleteLook([null, towel()], fallbacks, { vestSize: "M" });
    expect(picks[0].item.slug).toBe("olydoe-pima-long-sleeve-polo");
    expect(picks[0].source).toBe("fallback");
  });

  it("returns fewer cards rather than an out-of-stock one", () => {
    const picks = selectCompleteLook([polo({ M: false }), towel(false)], [], { vestSize: "M" });
    expect(picks).toEqual([]);
  });

  it("cart mode only suggests BOGO15-eligible pieces not already in the bag", () => {
    const picks = selectCompleteLook([polo(), sockItem], fallbacks, {
      vestSize: "M",
      exclude: ["olydoe-merino-ponte-vest"],
      requireBogo: true,
    });
    expect(picks.map((p) => p.item.slug)).toEqual(["olydoe-pima-long-sleeve-polo", "rhone-rise-quarter-zip"]);
    expect(picks.every((p) => p.item.bogoEligible)).toBe(true);
  });

  it("joins handles for the analytics items property", () => {
    expect(itemsProperty(selectCompleteLook([polo(), towel()], [], { vestSize: "M" })))
      .toBe("olydoe-pima-long-sleeve-polo,winston-golf-tour-towel");
  });
});

describe("PDP BOGO line", () => {
  it("shows only when the vest and every shown piece are BOGO15 eligible", () => {
    const fremont = selectCompleteLook([rise(), towel()], [], { vestSize: "M" });
    const ponte = selectCompleteLook([polo(), towel()], [], { vestSize: "M" });
    const withSock = selectCompleteLook([polo(), sockItem], [], { vestSize: "M" });
    expect(pdpBogoLineApplies(true, fremont)).toBe(true);
    expect(pdpBogoLineApplies(true, ponte)).toBe(true); // Ponte now pairs the towel
    expect(pdpBogoLineApplies(true, withSock)).toBe(false); // a piece outside Shop — All
    expect(pdpBogoLineApplies(false, fremont)).toBe(false);
    expect(pdpBogoLineApplies(true, [])).toBe(false);
  });

  it("hides for members, rewards and other codes (BOGO15 does not combine)", () => {
    const fremont = selectCompleteLook([rise(), towel()], [], { vestSize: "M" });
    expect(pdpBogoLineApplies(true, fremont, true)).toBe(false);
  });
});

describe("cart BOGO line state", () => {
  const vest = { slug: "rhone-voyage-down-vest", quantity: 1, eligible: true };
  it("one eligible item -> one_item", () => {
    expect(cartBogoState({ lines: [vest], bogoSaved: 0 }).state).toBe("one_item");
  });
  it("ineligible items alone -> hidden", () => {
    expect(cartBogoState({ lines: [{ slug: "sock", quantity: 2, eligible: false }], bogoSaved: 0 }).state).toBe("hidden");
  });
  it("one eligible + one ineligible -> still one_item", () => {
    expect(cartBogoState({ lines: [vest, { slug: "sock", quantity: 1, eligible: false }], bogoSaved: 0 }).state).toBe("one_item");
  });
  it("two eligible units with a live allocation -> applied with the saved amount", () => {
    expect(cartBogoState({ lines: [vest, { slug: "polo", quantity: 1, eligible: true }], bogoSaved: 17.25 }))
      .toEqual({ state: "applied", eligibleUnits: 2, saved: 17.25 });
    expect(cartBogoState({ lines: [{ ...vest, quantity: 2 }], bogoSaved: 34.2 }).state).toBe("applied");
  });
  it("never claims applied without Shopify money", () => {
    expect(cartBogoState({ lines: [vest, { slug: "polo", quantity: 1, eligible: true }], bogoSaved: 0 }).state).toBe("hidden");
  });
  it("suppressed carts hide the line", () => {
    expect(cartBogoState({ lines: [vest], bogoSaved: 0, suppressed: true }).state).toBe("hidden");
  });
  it("reads BOGO15 savings from the cart discount allocations by title", () => {
    expect(bogoSavedFromAllocations({ "Mully BOGO15: 15% off one piece": 17.25, WELCOME10: 5 })).toBe(17.25);
    expect(bogoSavedFromAllocations({ BOGO15: 2.99 })).toBe(2.99);
    expect(bogoSavedFromAllocations({})).toBe(0);
  });
  it("parses the vest size from the cart variant title", () => {
    expect(sizeFromVariantTitle("Highland Green / M")).toBe("M");
    expect(sizeFromVariantTitle("Black / XXL")).toBe("XXL");
    expect(sizeFromVariantTitle("Default Title")).toBeUndefined();
  });
});

describe("BOGO15 blocking codes", () => {
  it("ignores BOGO15 itself and first-order free shipping, which combine with it", () => {
    expect(hasBogoBlockingCode([{ code: "FIRSTORDERSHIP", applicable: true }])).toBe(false);
    expect(hasBogoBlockingCode([{ code: "bogo15", applicable: true }])).toBe(false);
    expect(hasBogoBlockingCode([{ code: "WELCOME10", applicable: false }])).toBe(false);
    expect(hasBogoBlockingCode([{ code: "WELCOME10", applicable: true }])).toBe(true);
  });
});

describe("QA overrides", () => {
  it("are always allowed outside production", () => {
    expect(completeLookOverridesAllowed(null, "preview")).toBe(true);
    expect(completeLookOverridesAllowed(null, undefined)).toBe(true);
  });
  it("need the flag payload opt-in in production", () => {
    expect(completeLookOverridesAllowed(null, "production")).toBe(false);
    expect(completeLookOverridesAllowed({ allow_overrides: false }, "production")).toBe(false);
    expect(completeLookOverridesAllowed({ allow_overrides: true }, "production")).toBe(true);
  });
});
