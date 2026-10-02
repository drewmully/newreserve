import { describe, expect, it } from "vitest";
import { shopProductPhoto, shopProductLabel } from "../../src/lib/shopProductPhotos";
import prepared from "../../src/lib/shopProductPhotos.json";

describe("merchant-sourced outfit photos", () => {
  it("uses the prepared white photo only for the catalog image it was made from", () => {
    for (const photo of prepared) {
      expect(shopProductPhoto({ slug: photo.slug, images: [photo.catalogPrimary] })).toBe(photo.prepared);
      expect(shopProductPhoto({ slug: photo.slug, images: ["https://example.com/new-color.jpg"] })).toBe("https://example.com/new-color.jpg");
    }
  });
  it("preserves new product names and photos without hardcoded assumptions", () => {
    expect(shopProductPhoto({ slug: "new", images: [] })).toBe("");
    expect(shopProductLabel({ slug: "new", name: "New merchant product" })).toBe("New merchant product");
  });
  it("shows card names in title case without repeating the brand", () => {
    expect(shopProductLabel({ slug: "quiet-golf-remy-polo-active-pique", name: "Quiet Golf Remy Polo" })).toBe("Remy Polo");
    expect(shopProductLabel({ slug: "duckhead-classic-fit-gold-school-chino-khaki", name: "Duck Head Classic Fit Gold School Chino" })).toBe("Gold School Chino");
    expect(shopProductLabel({ slug: "stitch-birdie-bag", name: "Stitch Birdie Bag" })).toBe("Birdie Bag");
    expect(shopProductLabel({ slug: "jolly-golf-purist-organizer", name: "Jolly Golf The Purist Golf Bag Organizer" })).toBe("The Purist Golf Bag Organizer");
  });
});
