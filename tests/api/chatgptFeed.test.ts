import { describe, expect, it } from "vitest";
import type { ShopifyProduct } from "@/lib/shopify";
import { FEED_COLUMNS, mergeShopProducts, productToRows, rowsToCsv } from "@/lib/chatgptFeed";

function product(overrides: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    id: "gid://shopify/Product/111",
    slug: "rhone-fairway-polo",
    name: "Rhone Fairway Polo",
    brand: "Rhone",
    collection: "Polo",
    price: 98,
    reservePrice: 83.3,
    images: ["https://cdn.shopify.com/a.jpg", "https://cdn.shopify.com/b.jpg"],
    description: "Three-button placket, side slits and all-way stretch.",
    material: "",
    aboutBrand: "",
    whyWeLikeIt: "",
    sizing: "",
    options: [],
    variants: [
      {
        id: "gid://shopify/ProductVariant/1",
        title: "Navy / M",
        price: 98,
        reservePrice: 83.3,
        availableForSale: true,
        currentlyNotInStock: false,
        image: "https://cdn.shopify.com/b.jpg",
        selectedOptions: [
          { name: "Color", value: "Navy" },
          { name: "Size", value: "M" },
        ],
      },
      {
        id: "gid://shopify/ProductVariant/2",
        title: "Navy / L",
        price: 98,
        reservePrice: 83.3,
        availableForSale: true,
        currentlyNotInStock: true,
        selectedOptions: [
          { name: "Color", value: "Navy" },
          { name: "Size", value: "L" },
        ],
      },
      {
        id: "gid://shopify/ProductVariant/3",
        title: "Navy / XL",
        price: 98,
        reservePrice: 83.3,
        availableForSale: false,
        selectedOptions: [
          { name: "Color", value: "Navy" },
          { name: "Size", value: "XL" },
        ],
      },
    ],
    variantId: "gid://shopify/ProductVariant/1",
    tags: [],
    ...overrides,
  };
}

describe("chatgpt product feed", () => {
  it("emits one row per variant with required fields and retail price", () => {
    const rows = productToRows({ ...product(), sourceCollections: ["shop-all", "shop-tops"] });
    expect(rows).toHaveLength(3);
    const [first] = rows;
    expect(first).toMatchObject({
      item_id: "mully-1",
      group_id: "mully-111",
      listing_has_variations: "true",
      variant_dict: JSON.stringify({ Color: "Navy", Size: "M" }),
      title: "Rhone Fairway Polo, Navy, M",
      url: "https://www.mymully.com/shop/rhone-fairway-polo?variant=1",
      brand: "Rhone",
      seller_name: "Mully",
      image_url: "https://cdn.shopify.com/b.jpg",
      additional_image_urls: "https://cdn.shopify.com/a.jpg",
      availability: "in_stock",
      price: "98.00 USD",
      product_category: "Golf > Tops > Polo",
      color: "Navy",
      size: "M",
      accepts_returns: "true",
      return_deadline_in_days: "30",
    });
    expect(rows.map((r) => r.availability)).toEqual(["in_stock", "backorder", "out_of_stock"]);
    expect(rows[1].image_url).toBe("https://cdn.shopify.com/a.jpg");
  });

  it("marks final-sale products as non-returnable", () => {
    const [row] = productToRows(product({ tags: ["final-sale"] }));
    expect(row.accepts_returns).toBe("false");
    expect(row.return_deadline_in_days).toBeUndefined();
  });

  it("omits extra images when the gallery mixes colorways", () => {
    const p = product();
    p.variants[2].selectedOptions = [
      { name: "Color", value: "White" },
      { name: "Size", value: "XL" },
    ];
    expect(productToRows(p).every((r) => r.additional_image_urls === "")).toBe(true);
  });

  it("skips products with no image or no priced variant", () => {
    expect(productToRows(product({ images: [] }))).toEqual([]);
  });

  it("de-duplicates products across shop collections", () => {
    const p = product();
    const merged = mergeShopProducts([
      { handle: "shop-all", products: [p] },
      { handle: "shop-tops", products: [p] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sourceCollections).toEqual(["shop-all", "shop-tops"]);
  });

  it("writes a quoted CSV with the header row", () => {
    const csv = rowsToCsv(productToRows(product()));
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(FEED_COLUMNS.join(","));
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('"{""Color"":""Navy"",""Size"":""M""}"');
    expect(lines[1]).toContain('"[""US""]"');
  });
});
