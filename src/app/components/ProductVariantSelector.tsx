"use client";

import type { VariantBearingProduct } from "@/lib/productVariants";
import {
  getProductOptionGroups,
  hasVariantChoices,
  isVariantValueAvailable,
  type ProductVariantSelection,
} from "@/lib/productVariants";

interface ProductVariantSelectorProps {
  product: VariantBearingProduct;
  selection: ProductVariantSelection;
  onChange: (optionName: string, optionValue: string) => void;
  compact?: boolean;
}

export function ProductVariantSelector({
  product,
  selection,
  onChange,
  compact = false,
}: ProductVariantSelectorProps) {
  if (!hasVariantChoices(product)) {
    return null;
  }

  const optionGroups = getProductOptionGroups(product);

  return (
    <div className={compact ? "space-y-2.5" : "space-y-4"}>
      {optionGroups.map((group) => (
        <div key={group.name}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-[10px] tracking-[0.18em] uppercase text-charcoal/45">
              {group.name}
            </p>
            <p className="text-xs text-charcoal/45">
              {selection[group.name] ?? group.values[0]}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {group.values.map((value) => {
              const selected = selection[group.name] === value;
              const available = isVariantValueAvailable(
                product,
                selection,
                group.name,
                value
              );

              return (
                <button
                  key={`${group.name}-${value}`}
                  type="button"
                  disabled={!available}
                  onClick={() => onChange(group.name, value)}
                  aria-pressed={selected}
                  className={`rounded-full border px-3 py-2 text-xs font-medium transition-colors ${
                    selected
                      ? "border-forest bg-forest text-bone"
                      : available
                        ? "border-taupe/25 bg-cream text-charcoal/70 hover:border-forest/40 hover:text-forest"
                        : "border-taupe/15 bg-bone text-charcoal/25 cursor-not-allowed"
                  } ${compact ? "min-w-[3.25rem]" : "min-w-[3.75rem]"}`}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
