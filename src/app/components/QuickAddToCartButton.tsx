"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ProductVariantSelector } from "./ProductVariantSelector";
import {
  formatVariantSummary,
  getDefaultProductVariant,
  getInitialVariantSelection,
  hasVariantChoices,
  resolveVariantBySelection,
  type ProductVariantSelection,
  type VariantBearingProduct,
} from "@/lib/productVariants";

interface QuickAddProduct extends VariantBearingProduct {
  slug: string;
  name: string;
  brand: string;
  images?: string[];
}

interface QuickAddToCartButtonProps {
  product: QuickAddProduct;
  isPaid: boolean;
  onAddToCart: (item: {
    slug: string;
    name: string;
    brand: string;
    price: number;
    variantId?: string;
    image?: string;
  }) => Promise<void> | void;
  idleClassName: string;
  addedClassName: string;
  idleContent: ReactNode;
  addedContent: ReactNode;
  buttonAriaLabel?: string;
  modalTitle?: string;
}

export function QuickAddToCartButton({
  product,
  isPaid,
  onAddToCart,
  idleClassName,
  addedClassName,
  idleContent,
  addedContent,
  buttonAriaLabel = "Add to cart",
  modalTitle = "Choose your variant",
}: QuickAddToCartButtonProps) {
  const [added, setAdded] = useState(false);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<ProductVariantSelection>(() =>
    getInitialVariantSelection(product)
  );

  useEffect(() => {
    setSelection(getInitialVariantSelection(product));
  }, [product]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const selectedVariant =
    resolveVariantBySelection(product, selection) ??
    getDefaultProductVariant(product);
  const hasChoices = hasVariantChoices(product);
  const buttonClassName = added ? addedClassName : idleClassName;

  const flashAdded = () => {
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1500);
  };

  const handleConfirm = async () => {
    const variant =
      resolveVariantBySelection(product, selection) ??
      getDefaultProductVariant(product);

    await onAddToCart({
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      price: isPaid
        ? variant?.reservePrice ?? product.reservePrice
        : variant?.price ?? product.price,
      variantId: variant?.id ?? product.variantId,
      image: product.images?.[0],
    });

    setOpen(false);
    flashAdded();
  };

  return (
    <>
      <button
        type="button"
        aria-label={buttonAriaLabel}
        className={buttonClassName}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();

          if (hasChoices) {
            setOpen(true);
            return;
          }

          void handleConfirm();
        }}
      >
        {added ? addedContent : idleContent}
      </button>

      {open && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-obsidian/55 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-taupe/20 bg-bone p-6 shadow-2xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-4 top-4 text-charcoal/35 hover:text-charcoal transition-colors"
              aria-label="Close quick add"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>

            <p className="text-[10px] tracking-[0.28em] uppercase text-sage font-medium mb-2">
              Quick Add
            </p>
            <h3 className="font-serif text-2xl text-obsidian mb-1">
              {modalTitle}
            </h3>
            <p className="text-sm text-charcoal/55 mb-5">{product.name}</p>

            <ProductVariantSelector
              product={product}
              selection={selection}
              onChange={(optionName, optionValue) =>
                setSelection((current) => ({
                  ...current,
                  [optionName]: optionValue,
                }))
              }
            />

            <div className="mt-5 rounded-xl bg-cream px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] tracking-[0.18em] uppercase text-charcoal/35">
                    Selected
                  </p>
                  <p className="text-sm font-medium text-obsidian mt-1">
                    {formatVariantSummary(selectedVariant)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] tracking-[0.18em] uppercase text-charcoal/35">
                    Price
                  </p>
                  <p className="text-lg font-semibold text-forest mt-1">
                    $
                    {isPaid
                      ? selectedVariant?.reservePrice ?? product.reservePrice
                      : selectedVariant?.price ?? product.price}
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={!selectedVariant || !selectedVariant.availableForSale}
              onClick={() => void handleConfirm()}
              className="mt-5 h-12 w-full rounded-xl bg-forest text-bone text-sm font-medium tracking-wide uppercase hover:bg-forest-dark transition-colors disabled:cursor-not-allowed disabled:opacity-55"
            >
              {selectedVariant?.availableForSale === false
                ? "Unavailable"
                : "Add to Cart"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
