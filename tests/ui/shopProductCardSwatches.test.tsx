import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../src/app/context/MembershipContext", () => ({ useMembership: () => ({ tier: "free" }) }));
vi.mock("next/image", () => ({ default: (p: { src: string; alt: string }) => <img src={p.src} alt={p.alt} /> }));

import { ShopProductCard } from "../../src/app/shop/components/ShopProductCard";

const product = {
  slug: "chino", name: "Chino", brand: "Duck Head", price: 118, reservePrice: 100, images: ["k.jpg", "n.jpg"],
  variants: [
    { id: "gid://shopify/ProductVariant/1", selectedOptions: [{ name: "Color", value: "Khaki" }] },
    { id: "gid://shopify/ProductVariant/2", selectedOptions: [{ name: "Color", value: "Navy" }], currentlyNotInStock: true },
  ],
  displayKey: "chino", cardColor: "Khaki", cardImage: "k.jpg",
  swatches: [
    { color: "Khaki", image: "k.jpg", variantId: "gid://shopify/ProductVariant/1" },
    { color: "Navy", image: "n.jpg", variantId: "gid://shopify/ProductVariant/2" },
  ],
} as never;

describe("ShopProductCard swatches", () => {
  it("swaps photo, color, link and preorder note when a swatch is chosen", () => {
    const { container } = render(<ShopProductCard product={product} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("k.jpg");
    expect(screen.queryByText(/Preorder/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Navy" }));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("n.jpg");
    expect(screen.getByText("Navy")).toBeTruthy();
    expect(screen.getByText(/Preorder/)).toBeTruthy();
    const links = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links.every((h) => h?.includes("ProductVariant%2F2"))).toBe(true);
    expect(screen.getByText("2 colors")).toBeTruthy();
  });
});
