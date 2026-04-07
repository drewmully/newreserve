import type {
  ShopifyProductOption,
  ShopifyProductVariant,
} from "@/lib/shopify";

export interface VariantBearingProduct {
  name: string;
  price: number;
  reservePrice: number;
  variantId?: string;
  options?: ShopifyProductOption[];
  variants?: ShopifyProductVariant[];
}

export type ProductVariantSelection = Record<string, string>;

function buildFallbackVariant(
  product: VariantBearingProduct
): ShopifyProductVariant | null {
  if (!product.variantId) return null;

  return {
    id: product.variantId,
    title: "Default",
    price: product.price,
    reservePrice: product.reservePrice,
    availableForSale: true,
    selectedOptions: [],
  };
}

export function getProductVariants(
  product: VariantBearingProduct
): ShopifyProductVariant[] {
  if (product.variants?.length) {
    return product.variants;
  }

  const fallback = buildFallbackVariant(product);
  return fallback ? [fallback] : [];
}

export function getDefaultProductVariant(
  product: VariantBearingProduct
): ShopifyProductVariant | null {
  const variants = getProductVariants(product);
  if (variants.length === 0) return null;

  return (
    variants.find((variant) => variant.id === product.variantId) ??
    variants.find((variant) => variant.availableForSale) ??
    variants[0]
  );
}

export function getProductOptionGroups(
  product: VariantBearingProduct
): ShopifyProductOption[] {
  if (product.options?.length) {
    return product.options.filter((option) => option.values.length > 0);
  }

  const valuesByOption = new Map<string, string[]>();
  for (const variant of getProductVariants(product)) {
    for (const option of variant.selectedOptions) {
      const existing = valuesByOption.get(option.name) ?? [];
      if (!existing.includes(option.value)) {
        existing.push(option.value);
        valuesByOption.set(option.name, existing);
      }
    }
  }

  return Array.from(valuesByOption.entries()).map(([name, values]) => ({
    name,
    values,
  }));
}

export function hasVariantChoices(product: VariantBearingProduct): boolean {
  return getProductOptionGroups(product).some((option) => option.values.length > 1);
}

export function getInitialVariantSelection(
  product: VariantBearingProduct
): ProductVariantSelection {
  const selection: ProductVariantSelection = {};
  const defaultVariant = getDefaultProductVariant(product);

  for (const option of defaultVariant?.selectedOptions ?? []) {
    selection[option.name] = option.value;
  }

  for (const option of getProductOptionGroups(product)) {
    if (!selection[option.name] && option.values[0]) {
      selection[option.name] = option.values[0];
    }
  }

  return selection;
}

export function resolveVariantBySelection(
  product: VariantBearingProduct,
  selection: ProductVariantSelection
): ShopifyProductVariant | null {
  const variants = getProductVariants(product);
  if (variants.length === 0) return null;

  if (Object.keys(selection).length === 0) {
    return getDefaultProductVariant(product);
  }

  const exactMatch = variants.find((variant) =>
    variant.selectedOptions.every(
      (option) => selection[option.name] === option.value
    )
  );

  if (!exactMatch) {
    return getDefaultProductVariant(product);
  }

  return exactMatch;
}

export function isVariantValueAvailable(
  product: VariantBearingProduct,
  selection: ProductVariantSelection,
  optionName: string,
  optionValue: string
): boolean {
  const variants = getProductVariants(product);
  if (variants.length === 0) return false;

  return variants.some((variant) => {
    if (!variant.availableForSale) return false;

    return variant.selectedOptions.every((option) => {
      if (option.name === optionName) {
        return option.value === optionValue;
      }

      const selectedValue = selection[option.name];
      return !selectedValue || selectedValue === option.value;
    });
  });
}

export function formatVariantSummary(variant: ShopifyProductVariant | null): string {
  if (!variant) return "";
  if (variant.selectedOptions.length === 0) return variant.title;
  return variant.selectedOptions.map((option) => option.value).join(" / ");
}
