import { describe, expect, it } from "vitest";
import {
  buildShopDisplayProducts,
  orderProductImagesBySelection,
} from "@/lib/shopDisplay";

const colorProduct = {
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
    "https://cdn.shopify.com/s/files/products/polo-sand-detail.jpg",
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
    {
      url: "https://cdn.shopify.com/s/files/products/polo-sand-detail.jpg",
      altText: "Reserve polo sand detail",
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
      image: "https://cdn.shopify.com/s/files/products/polo-front.jpg",
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

describe("shop display products", () => {
  it("expands products into one card per color without multiplying by size", () => {
    const displayProducts = buildShopDisplayProducts([colorProduct]);

    expect(displayProducts).toHaveLength(2);
    expect(displayProducts.map((product) => product.cardColor)).toEqual([
      "Navy",
      "Sand",
    ]);

    const [navyCard, sandCard] = displayProducts;

    expect(navyCard.preferredVariantId).toBe("gid://shopify/ProductVariant/1");
    expect(navyCard.cardImage).toBe(
      "https://cdn.shopify.com/s/files/products/polo-navy-front.jpg"
    );

    expect(sandCard.preferredVariantId).toBe("gid://shopify/ProductVariant/3");
    expect(sandCard.cardImage).toBe(
      "https://cdn.shopify.com/s/files/products/polo-sand-front.jpg"
    );
    expect(sandCard.cardSecondaryImage).toBe(
      "https://cdn.shopify.com/s/files/products/polo-sand-detail.jpg"
    );
    expect(sandCard.initialSelection).toMatchObject({
      Color: "Sand",
      Size: "M",
    });
  });

  it("keeps single-color or size-only products as one card", () => {
    const displayProducts = buildShopDisplayProducts([
      {
        ...colorProduct,
        slug: "course-cap",
        name: "Course Cap",
        images: ["https://cdn.shopify.com/s/files/products/cap.jpg"],
        imageDetails: [
          {
            url: "https://cdn.shopify.com/s/files/products/cap.jpg",
            altText: "Course cap",
          },
        ],
        options: [{ name: "Size", values: ["S/M", "L/XL"] }],
        variants: [
          {
            id: "gid://shopify/ProductVariant/20",
            title: "S/M",
            price: 38,
            reservePrice: 28,
            availableForSale: true,
            selectedOptions: [{ name: "Size", value: "S/M" }],
          },
          {
            id: "gid://shopify/ProductVariant/21",
            title: "L/XL",
            price: 38,
            reservePrice: 28,
            availableForSale: true,
            selectedOptions: [{ name: "Size", value: "L/XL" }],
          },
        ],
      },
    ]);

    expect(displayProducts).toHaveLength(1);
    expect(displayProducts[0].cardColor).toBeUndefined();
  });

  it("reorders PDP images so the selected color starts the gallery", () => {
    expect(
      orderProductImagesBySelection(colorProduct, { Color: "Sand", Size: "L" })
    ).toEqual([
      "https://cdn.shopify.com/s/files/products/polo-sand-front.jpg",
      "https://cdn.shopify.com/s/files/products/polo-sand-detail.jpg",
      "https://cdn.shopify.com/s/files/products/polo-front.jpg",
      "https://cdn.shopify.com/s/files/products/polo-navy-front.jpg",
    ]);
  });
});
