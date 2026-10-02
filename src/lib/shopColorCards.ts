import type { ShopifyProduct } from "@/lib/shopify";
import { buildShopDisplayProducts, type ShopCatalogProduct } from "@/lib/shopDisplay";
import { shopProductPhoto } from "@/lib/shopProductPhotos";

export type ShopSwatch = { color: string; image: string; variantId?: string };

export type ShopColorCard = ShopifyProduct & {
  displayKey: string;
  cardColor?: string;
  cardImage?: string;
  preferredVariantId?: string;
  /** Number of photographed colors this product has (for "+N more colors"). */
  colorCount?: number;
  /** Present on Shop all swatch cards: every photographed color, lead first. */
  swatches?: ShopSwatch[];
};

/**
 * Per-color cards for one product. Colors without their own photo are folded
 * into the main card so we never show look-alike duplicates.
 */
function colorCardsFor(product: ShopifyProduct): ShopColorCard[] {
  const display = buildShopDisplayProducts([product as unknown as ShopCatalogProduct]);
  const seen = new Set<string>();
  const cards: ShopColorCard[] = [];
  for (const d of display) {
    const img = d.cardImage ?? d.images[0];
    if (!img || seen.has(img)) continue;
    seen.add(img);
    cards.push({
      ...product,
      displayKey: d.displayKey,
      cardColor: display.length > 1 ? d.cardColor : undefined,
      // Keep the prepared, normalized webp when the card shows the catalog primary.
      cardImage: img === product.images[0] ? shopProductPhoto(product) : img,
      preferredVariantId: display.length > 1 ? d.preferredVariantId : undefined,
    });
  }
  if (cards.length === 0) return [{ ...product, displayKey: product.slug, cardImage: shopProductPhoto(product), colorCount: 1 }];
  if (cards.length === 1) return [{ ...cards[0], cardColor: undefined, preferredVariantId: undefined, colorCount: 1 }];
  return cards.map((c) => ({ ...c, colorCount: cards.length }));
}

/**
 * Category pages: one card per color. Ordering keeps the curated collection
 * order — every product's lead color first, then second colors in the same
 * order — so the top rows stay merchandised and alternates fill in below.
 */
export function buildColorCards(products: ShopifyProduct[]): ShopColorCard[] {
  const perProduct = products.map(colorCardsFor);
  const out: ShopColorCard[] = [];
  const depth = Math.max(0, ...perProduct.map((c) => c.length));
  for (let i = 0; i < depth; i++) for (const cards of perProduct) if (cards[i]) out.push(cards[i]);
  return out;
}

/** Shop all: one card per product, lead color shown, other colors as swatches. */
export function buildSwatchCards(products: ShopifyProduct[]): ShopColorCard[] {
  return products.map((product) => {
    const cards = colorCardsFor(product);
    const lead = cards[0];
    // Empty swatches keep single-color cards aligned with swatch cards in the grid.
    if (cards.length < 2) return { ...lead, swatches: [] };
    return {
      ...lead,
      displayKey: product.slug,
      swatches: cards.map((c) => ({ color: c.cardColor ?? "", image: c.cardImage ?? "", variantId: c.preferredVariantId })),
    };
  });
}
