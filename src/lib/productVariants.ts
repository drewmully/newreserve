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

export function getVariantById(
  product: VariantBearingProduct,
  variantId: string
): ShopifyProductVariant | null {
  return (
    getProductVariants(product).find((variant) => variant.id === variantId) ??
    null
  );
}

export function getProductOptionGroups(
  product: VariantBearingProduct
): ShopifyProductOption[] {
  if (product.options?.length) {
    return product.options
      .filter((option) => option.values.length > 0)
      .map((option) => ({ ...option, values: sortOptionValues(option.name, option.values) }));
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
    values: sortOptionValues(name, values),
  }));
}

const APPAREL_SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "2XL", "3XL"];

/**
 * Shopify derives option-value order from variant positions, so deleting a
 * size from one color (e.g. Dark Slate S) can push that size to the end for
 * every color. Keep apparel sizes in canonical order regardless.
 */
function sortOptionValues(optionName: string, values: string[]): string[] {
  if (!/^size$/i.test(optionName)) return values;
  const rank = (v: string) => APPAREL_SIZE_ORDER.indexOf(v.trim().toUpperCase());
  if (!values.every((v) => rank(v) !== -1)) return values;
  return [...values].sort((a, b) => rank(a) - rank(b));
}

/** True when some variant (sold out or not) has this value with the selected color. */
export function variantValueExistsForColor(
  product: VariantBearingProduct,
  selection: ProductVariantSelection,
  optionName: string,
  optionValue: string
): boolean {
  const colorName = Object.keys(selection).find((k) => /^colou?r$/i.test(k));
  if (!colorName || colorName === optionName) return true;
  const variants = getProductVariants(product);
  const hasColorOption = variants.some((v) => v.selectedOptions.some((o) => o.name === colorName));
  if (!hasColorOption) return true;
  return variants.some(
    (variant) =>
      variant.selectedOptions.some((o) => o.name === optionName && o.value === optionValue) &&
      variant.selectedOptions.some((o) => o.name === colorName && o.value === selection[colorName])
  );
}

/**
 * Apply one option change. If the resulting combination doesn't exist (e.g.
 * switching to a color that has no size S), move the other options to the
 * closest existing variant for the newly chosen value.
 */
export function applyVariantSelection(
  product: VariantBearingProduct,
  current: ProductVariantSelection,
  optionName: string,
  optionValue: string
): ProductVariantSelection {
  const next = { ...current, [optionName]: optionValue };
  const variants = getProductVariants(product);
  if (variants.length === 0) return next;
  const matches = (variant: ShopifyProductVariant, sel: ProductVariantSelection) =>
    variant.selectedOptions.every((o) => !sel[o.name] || sel[o.name] === o.value);
  if (variants.some((v) => matches(v, next))) return next;
  const withValue = variants.filter((v) =>
    v.selectedOptions.some((o) => o.name === optionName && o.value === optionValue)
  );
  const fallback = withValue.find((v) => v.availableForSale) ?? withValue[0];
  return fallback ? { ...next, ...getVariantSelection(fallback) } : next;
}

export function hasVariantChoices(product: VariantBearingProduct): boolean {
  return getProductOptionGroups(product).some((option) => option.values.length > 1);
}

export function getVariantSelection(
  variant: ShopifyProductVariant | null
): ProductVariantSelection {
  const selection: ProductVariantSelection = {};

  for (const option of variant?.selectedOptions ?? []) {
    selection[option.name] = option.value;
  }

  return selection;
}

export function getInitialVariantSelection(
  product: VariantBearingProduct,
  preferredSelection: ProductVariantSelection = {}
): ProductVariantSelection {
  const selection: ProductVariantSelection = {};
  const variants = getProductVariants(product);

  const preferredVariant =
    Object.keys(preferredSelection).length === 0
      ? null
      : variants.find(
          (variant) =>
            variant.availableForSale &&
            variant.selectedOptions.every((option) => {
              const preferredValue = preferredSelection[option.name];
              return !preferredValue || preferredValue === option.value;
            })
        ) ??
        variants.find((variant) =>
          variant.selectedOptions.every((option) => {
            const preferredValue = preferredSelection[option.name];
            return !preferredValue || preferredValue === option.value;
          })
        );

  const defaultVariant = preferredVariant ?? getDefaultProductVariant(product);

  Object.assign(selection, getVariantSelection(defaultVariant));

  for (const option of getProductOptionGroups(product)) {
    const preferredValue = preferredSelection[option.name];
    if (preferredValue && option.values.includes(preferredValue)) {
      selection[option.name] = preferredValue;
      continue;
    }

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
