import type { ProductVariantSelection, VariantBearingProduct } from "@/lib/productVariants";
import {
  getDefaultProductVariant,
  getInitialVariantSelection,
  getProductVariants,
  getVariantSelection,
  resolveVariantBySelection,
} from "@/lib/productVariants";
import type { ShopifyProductImage, ShopifyProductVariant } from "@/lib/shopify";

const COLOR_OPTION_PATTERN = /^colou?r$/i;

export interface ShopCatalogProduct extends VariantBearingProduct {
  slug: string;
  name: string;
  brand: string;
  collection: string;
  price: number;
  reservePrice: number;
  images: string[];
  imageDetails?: ShopifyProductImage[];
  description: string;
  material: string;
  aboutBrand: string;
  whyWeLikeIt: string;
  sizing: string;
  sourceCollections?: string[];
}

export interface ShopDisplayProduct extends ShopCatalogProduct {
  displayKey: string;
  cardColor?: string;
  cardImage?: string;
  cardSecondaryImage?: string;
  initialSelection?: ProductVariantSelection;
  preferredVariantId?: string;
}

function normalizeTokens(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

function firstUniqueUrl(
  candidates: Array<string | undefined | null>
): string | undefined {
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    return candidate;
  }

  return undefined;
}

function buildOrderedImages(
  product: ShopCatalogProduct,
  primary?: string,
  secondary?: string
): string[] {
  return Array.from(
    new Set(
      [primary, secondary, ...product.images].filter(
        (url): url is string => Boolean(url)
      )
    )
  );
}

function getImageAssets(product: ShopCatalogProduct): ShopifyProductImage[] {
  if (product.imageDetails?.length) {
    return product.imageDetails;
  }

  return product.images.map((url) => ({ url }));
}

function getColorOptionName(product: VariantBearingProduct): string | null {
  const optionName = product.options?.find((option) =>
    COLOR_OPTION_PATTERN.test(option.name)
  )?.name;

  if (optionName) return optionName;

  for (const variant of getProductVariants(product)) {
    const selectedColor = variant.selectedOptions.find((option) =>
      COLOR_OPTION_PATTERN.test(option.name)
    );
    if (selectedColor) return selectedColor.name;
  }

  return null;
}

function getVariantOptionValue(
  variant: ShopifyProductVariant,
  optionName: string
): string | null {
  return (
    variant.selectedOptions.find((option) => option.name === optionName)?.value ??
    null
  );
}

function getImageSearchText(image: ShopifyProductImage): string {
  try {
    return `${image.altText ?? ""} ${decodeURIComponent(image.url)}`;
  } catch {
    return `${image.altText ?? ""} ${image.url}`;
  }
}

function imageMatchesColor(image: ShopifyProductImage, colorValue: string): boolean {
  const colorTokens = normalizeTokens(colorValue).filter((token) => token.length > 1);
  if (colorTokens.length === 0) return false;

  const imageTokens = new Set(normalizeTokens(getImageSearchText(image)));
  return colorTokens.every((token) => imageTokens.has(token));
}

function getColorScopedMedia(
  product: ShopCatalogProduct,
  colorValue: string,
  preferredVariant: ShopifyProductVariant | null
) {
  const imageAssets = getImageAssets(product);
  const matchingImages = imageAssets.filter((image) =>
    imageMatchesColor(image, colorValue)
  );
  const variantImage =
    preferredVariant?.image != null
      ? {
          url: preferredVariant.image,
          altText: preferredVariant.imageAltText ?? null,
        }
      : null;

  const primary = firstUniqueUrl([
    variantImage && imageMatchesColor(variantImage, colorValue)
      ? variantImage.url
      : undefined,
    matchingImages[0]?.url,
    variantImage?.url,
    imageAssets[0]?.url,
  ]);

  const secondary = firstUniqueUrl([
    matchingImages.find((image) => image.url !== primary)?.url,
    variantImage?.url !== primary ? variantImage?.url : undefined,
    imageAssets.find((image) => image.url !== primary)?.url,
  ]);

  return { primary, secondary };
}

function buildSingleDisplayProduct(product: ShopCatalogProduct): ShopDisplayProduct {
  const imageAssets = getImageAssets(product);
  const defaultVariant = getDefaultProductVariant(product);
  const cardImage = firstUniqueUrl([defaultVariant?.image, imageAssets[0]?.url]);
  const cardSecondaryImage = firstUniqueUrl([
    imageAssets.find((image) => image.url !== defaultVariant?.image)?.url,
    imageAssets[1]?.url,
  ]);

  return {
    ...product,
    displayKey: product.slug,
    images: buildOrderedImages(product, cardImage, cardSecondaryImage),
    cardImage,
    cardSecondaryImage,
    preferredVariantId: defaultVariant?.id ?? product.variantId,
    initialSelection: getInitialVariantSelection(product),
  };
}

export function buildShopDisplayProducts(
  products: ShopCatalogProduct[]
): ShopDisplayProduct[] {
  return products.flatMap((product) => {
    const colorOptionName = getColorOptionName(product);

    if (!colorOptionName) {
      return [buildSingleDisplayProduct(product)];
    }

    const variantsByColor = new Map<string, ShopifyProductVariant[]>();

    for (const variant of getProductVariants(product)) {
      const colorValue = getVariantOptionValue(variant, colorOptionName);
      if (!colorValue) continue;

      const existing = variantsByColor.get(colorValue) ?? [];
      existing.push(variant);
      variantsByColor.set(colorValue, existing);
    }

    if (variantsByColor.size <= 1) {
      return [buildSingleDisplayProduct(product)];
    }

    return Array.from(variantsByColor.entries()).map(([colorValue, variants]) => {
      const representativeVariant =
        variants.find((variant) => variant.availableForSale) ?? variants[0] ?? null;
      const selection = representativeVariant
        ? getVariantSelection(representativeVariant)
        : { [colorOptionName]: colorValue };
      const media = getColorScopedMedia(
        product,
        colorValue,
        representativeVariant
      );

      return {
        ...product,
        displayKey: `${product.slug}:${colorValue.toLowerCase().replace(/\s+/g, "-")}`,
        images: buildOrderedImages(product, media.primary, media.secondary),
        price: representativeVariant?.price ?? product.price,
        reservePrice: representativeVariant?.reservePrice ?? product.reservePrice,
        variantId: representativeVariant?.id ?? product.variantId,
        cardColor: colorValue,
        cardImage: media.primary,
        cardSecondaryImage: media.secondary,
        preferredVariantId: representativeVariant?.id ?? product.variantId,
        initialSelection: getInitialVariantSelection(product, selection),
      };
    });
  });
}

export function orderProductImagesBySelection(
  product: ShopCatalogProduct,
  selection: ProductVariantSelection
): string[] {
  const colorOptionName = getColorOptionName(product);
  const colorValue = colorOptionName ? selection[colorOptionName] : undefined;
  const preferredVariant = resolveVariantBySelection(product, selection);

  if (!colorValue) {
    return product.images;
  }

  const imageAssets = getImageAssets(product);
  const matchingImages = imageAssets
    .filter((image) => imageMatchesColor(image, colorValue))
    .map((image) => image.url);

  return Array.from(
    new Set([
      ...matchingImages,
      preferredVariant?.image,
      ...product.images,
    ].filter((url): url is string => Boolean(url)))
  );
}
