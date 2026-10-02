import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCollectionProducts, landingProps } = vi.hoisted(() => ({
  getCollectionProducts: vi.fn(),
  landingProps: vi.fn(),
}));
vi.mock("@/lib/shopify", () => ({ getCollectionProducts }));
vi.mock("@/app/blog/posts", () => ({ getAllPublishedPosts: async () => [] }));
vi.mock("@/app/shop/components/ShopSeasonalHeader", () => ({ ShopSeasonalHeader: () => null }));
vi.mock("@/app/shop/components/ShopFooter", () => ({ ShopFooter: () => null }));
vi.mock("@/app/shop/components/ShopLanding", () => ({
  ShopLanding: (props: { editProducts: Array<{ slug: string }> }) => {
    landingProps(props);
    return <div data-testid="edit-order">{props.editProducts.map(p => p.slug).join(",")}</div>;
  },
}));
import ShopPage from "@/app/shop/page";

describe("Mully Edit collection source", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes Shop All order separately from category products", async () => {
    getCollectionProducts.mockImplementation(async (handle: string) =>
      handle === "shop-all"
        ? [{ slug: "second-category-first" }, { slug: "first-category-second" }]
        : [{ slug: "category-product" }]);
    render(await ShopPage());
    expect(getCollectionProducts).toHaveBeenCalledWith("shop-all");
    expect(screen.getByTestId("edit-order")).toHaveTextContent("second-category-first,first-category-second");
    expect(landingProps.mock.calls[0][0].products).toEqual([{ slug: "category-product" }]);
  });

  it("does not silently substitute category ordering when Shop All fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    getCollectionProducts.mockImplementation(async (handle: string) => {
      if (handle === "shop-all") throw new Error("Shopify unavailable");
      return [{ slug: "category-product" }];
    });
    try {
      render(await ShopPage());
      expect(screen.getByTestId("edit-order")).toBeEmptyDOMElement();
      expect(landingProps.mock.calls[0][0].products).toEqual([{ slug: "category-product" }]);
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
