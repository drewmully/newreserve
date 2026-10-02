import type { ShopifyProduct } from "@/lib/shopify";
import { buildShopDisplayProducts, type ShopCatalogProduct } from "@/lib/shopDisplay";
import { shopProductPhoto } from "@/lib/shopProductPhotos";

export type ShopColorCard = ShopifyProduct & {
  displayKey: string;
  cardColor?: string;
  cardImage?: string;
  preferredVariantId?: string;
};

/**
 * One card per color for collection grids. Colors without their own photo are
 * folded into the product's main card so we never show look-alike duplicates.
 * Ordering keeps the curated collection order: every product's lead color
 * first, then second colors in the same order, and so on — so the top rows
 * stay merchandised and alternates fill in below instead of clustering.
 */
export function buildColorCards(products: ShopifyProduct[]): ShopColorCard[] {
  const perProduct = products.map((product) => {
    const display = buildShopDisplayProducts([product as unknown as ShopCatalogProduct]);
    const seen = new Set<string>();
    const cards: ShopColorCard[] = [];
    for (const d of display) {
      const img = d.cardImage ?? d.images[0];
      if (!img || seen.has(img)) continue;
      seen.add(img);
      cards.push({
        ...(product as ShopifyProduct),
        displayKey: d.displayKey,
        cardColor: display.length > 1 ? d.cardColor : undefined,
        // Keep the prepared, normalized webp when the card shows the catalog primary.
        cardImage: img === product.images[0] ? shopProductPhoto(product) : img,
        preferredVariantId: display.length > 1 ? d.preferredVariantId : undefined,
      });
    }
    if (cards.length === 1) {
      cards[0] = { ...cards[0], cardColor: undefined, preferredVariantId: undefined };
    }
    return cards.length ? cards : [{ ...product, displayKey: product.slug, cardImage: shopProductPhoto(product) }];
  });
  const out: ShopColorCard[] = [];
  const depth = Math.max(0, ...perProduct.map((c) => c.length));
  for (let i = 0; i < depth; i++) for (const cards of perProduct) if (cards[i]) out.push(cards[i]);
  return out;
}
