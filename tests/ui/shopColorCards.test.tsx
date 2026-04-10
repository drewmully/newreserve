import type { AnchorHTMLAttributes, ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/app/context/MembershipContext", () => ({
  useMembership: () => {
    throw new Error("No membership provider");
  },
}));

const product = {
  slug: "reserve-polo",
  name: "Reserve Polo",
  brand: "Greyson",
  collection: "Apparel",
  price: 120,
  reservePrice: 88,
  images: [
    "https://cdn.shopify.com/s/files/products/polo-front.jpg",
    "https://cdn.shopify.com/s/files/products/polo-navy-front.jpg",
    "https://cdn.shopify.com/s/files/products/polo-sand-front.jpg",
  ],
  imageDetails: [
    {
      url: "https://cdn.shopify.com/s/files/products/polo-front.jpg",
      altText: "Reserve polo front",
    },
    {
      url: "https://cdn.shopify.com/s/files/products/polo-navy-front.jpg",
      altText: "Reserve polo navy front",
    },
    {
      url: "https://cdn.shopify.com/s/files/products/polo-sand-front.jpg",
      altText: "Reserve polo sand front",
    },
  ],
  description: "Performance polo.",
  material: "",
  aboutBrand: "",
  whyWeLikeIt: "",
  sizing: "",
  variantId: "gid://shopify/ProductVariant/1",
  options: [
    { name: "Color", values: ["Navy", "Sand"] },
    { name: "Size", values: ["M", "L"] },
  ],
  variants: [
    {
      id: "gid://shopify/ProductVariant/1",
      title: "Navy / M",
      price: 120,
      reservePrice: 88,
      availableForSale: true,
      selectedOptions: [
        { name: "Color", value: "Navy" },
        { name: "Size", value: "M" },
      ],
    },
    {
      id: "gid://shopify/ProductVariant/2",
      title: "Navy / L",
      price: 120,
      reservePrice: 88,
      availableForSale: true,
      selectedOptions: [
        { name: "Color", value: "Navy" },
        { name: "Size", value: "L" },
      ],
    },
    {
      id: "gid://shopify/ProductVariant/3",
      title: "Sand / M",
      price: 118,
      reservePrice: 84,
      availableForSale: true,
      selectedOptions: [
        { name: "Color", value: "Sand" },
        { name: "Size", value: "M" },
      ],
    },
    {
      id: "gid://shopify/ProductVariant/4",
      title: "Sand / L",
      price: 118,
      reservePrice: 84,
      availableForSale: true,
      selectedOptions: [
        { name: "Color", value: "Sand" },
        { name: "Size", value: "L" },
      ],
    },
  ],
};

describe("shop color cards", () => {
  it("renders one product link per color and keeps the PDP shared", async () => {
    const { ShopGrid } = await import("@/app/shop/components/ShopClient");

    render(
      <ShopGrid
        products={[product]}
        brands={["Greyson"]}
        collections={["Apparel"]}
      />
    );

    const productLinks = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href")?.includes("/shop/reserve-polo"));

    expect(productLinks).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: "Reserve Polo, Navy" })
    ).toHaveAttribute(
      "href",
      "/shop/reserve-polo?variant=gid%3A%2F%2Fshopify%2FProductVariant%2F1"
    );
    expect(
      screen.getByRole("link", { name: "Reserve Polo, Sand" })
    ).toHaveAttribute(
      "href",
      "/shop/reserve-polo?variant=gid%3A%2F%2Fshopify%2FProductVariant%2F3"
    );

    expect(screen.getAllByText("Reserve Polo")).toHaveLength(2);
    expect(screen.getAllByText("Navy").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sand").length).toBeGreaterThan(0);
  });
});
