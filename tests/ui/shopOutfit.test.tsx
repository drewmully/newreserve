import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OUTFIT_SLOTS,
  OUTFIT_STORAGE_KEY,
  outfitEstimate,
  outfitLineAttributes,
  readOutfitGuide,
} from "@/lib/shopOutfit";
import type { ShopifyProduct } from "@/lib/shopify";
import { ShopOutfitBuilder } from "@/app/shop/components/ShopOutfitBuilder";

const mocks = vi.hoisted(() => ({ add: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/app/context/MembershipContext", () => ({
  useMembership: () => ({ addItemsToCart: mocks.add }),
}));
vi.mock("@/lib/tracking", () => ({ trackEvent: vi.fn() }));
const products = OUTFIT_SLOTS.flatMap((slot, i) =>
  slot.slugs.map(
    (slug, j) =>
      ({
        slug,
        name: `${slot.label} ${j + 1}`,
        brand: "Test",
        images: ["/piece.jpg"],
        price: [114, 138, 128][i],
        variants: ["M", "L"].map((size, k) => ({
          id: `gid://shopify/ProductVariant/${i + 1}${j + 1}${k + 1}`,
          title: size,
          price: [114, 138, 128][i],
          selectedOptions: [{ name: "Size", value: size }],
          availableForSale: true,
        })),
      }) as ShopifyProduct,
  ),
);
const byCategory = Object.fromEntries(
  OUTFIT_SLOTS.map((slot) => [
    slot.category,
    products.filter((p) => (slot.slugs as readonly string[]).includes(p.slug)),
  ]),
);

beforeEach(() => {
  sessionStorage.clear();
  mocks.add.mockClear();
});
describe("shop outfit offer and handoff", () => {
  it("discounts exactly one lowest-priced item, with cent rounding", () => {
    expect(outfitEstimate([114, 138, 128])).toEqual({
      subtotal: 380,
      savings: 17.1,
      total: 362.9,
    });
    expect(outfitEstimate([19.99, 20])).toEqual({
      subtotal: 39.99,
      savings: 3,
      total: 36.99,
    });
    expect(outfitEstimate([100]).total).toBe(100);
    expect(outfitEstimate([]).total).toBe(0);
    expect(outfitEstimate([100, 100, 100, 100]).savings).toBe(15);
  });
  it("rejects stale, malformed and non-variant style guides", () => {
    for (const value of [
      "bad",
      JSON.stringify({ createdAt: 0, items: [] }),
      JSON.stringify({
        createdAt: Date.now(),
        items: [{ variantId: "javascript:bad" }],
      }),
    ]) {
      sessionStorage.setItem(OUTFIT_STORAGE_KEY, value);
      expect(readOutfitGuide()).toBeNull();
    }
  });
  it("retains all three exact sizes and IDs in checkout attributes", () => {
    const guide = {
      createdAt: Date.now(),
      items: [products[0], products[2], products[4]].map((p) => ({
        slug: p.slug,
        name: p.name,
        brand: p.brand,
        image: p.images[0],
        variantId: p.variants[0].id,
        size: "M",
      })),
    };
    sessionStorage.setItem(OUTFIT_STORAGE_KEY, JSON.stringify(guide));
    expect(readOutfitGuide()).toEqual(guide);
    expect(outfitLineAttributes(guide)).toHaveLength(6);
    expect(outfitLineAttributes(guide)[0]).toEqual({
      key: "Outfit Top",
      value: "Top 1 / M",
    });
  });
  it("requires each size and sends three real variants in one batch", async () => {
    render(<ShopOutfitBuilder products={products} byCategory={byCategory} />);
    expect(screen.getByRole("radio", { name: /Just this time/ })).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Choose remaining sizes →" }),
    ).toBeVisible();
    for (let i = 0; i < 3; i++) {
      fireEvent.click(
        screen.getByRole("tab", { name: new RegExp(OUTFIT_SLOTS[i].label) }),
      );
      fireEvent.click(
        within(
          screen.getByRole("group", { name: `${OUTFIT_SLOTS[i].label} size` }),
        ).getByRole("button", { name: i === 1 ? "L" : "M" }),
      );
    }
    fireEvent.click(screen.getByRole("button", { name: "Add outfit to bag" }));
    expect(mocks.add).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          variantId: products[0].variants[0].id,
          variantTitle: "M",
        }),
        expect.objectContaining({
          variantId: products[2].variants[1].id,
          variantTitle: "L",
        }),
        expect.objectContaining({
          variantId: products[4].variants[0].id,
          variantTitle: "M",
        }),
      ],
      "BOGO15",
    );
  });
  it("does not reuse sizes between products and disables Reserve after removing a piece", () => {
    render(<ShopOutfitBuilder products={products} byCategory={byCategory} />);
    fireEvent.click(
      within(screen.getByRole("group", { name: "Top size" })).getByRole(
        "button",
        { name: "M" },
      ),
    );
    const choices = screen.getByRole("tabpanel");
    fireEvent.click(within(choices).getByRole("button", { name: /Top 2/ }));
    expect(
      within(screen.getByRole("group", { name: "Top size" })).getByRole(
        "button",
        { name: "M" },
      ),
    ).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(within(choices).getByRole("button", { name: /Top 1/ }));
    expect(
      within(screen.getByRole("group", { name: "Top size" })).getByRole(
        "button",
        { name: "M" },
      ),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("radio", { name: /Mully Reserve/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Layer" }));
    expect(screen.getByRole("radio", { name: /Mully Reserve/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Just this time/ })).toBeChecked();
  });
});
