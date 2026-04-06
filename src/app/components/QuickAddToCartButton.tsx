"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  const [selection, setSelection] = useState<ProductVariantSelection>(() =>
    getInitialVariantSelection(product)
  );
  const isVisible = open || closing;

  useEffect(() => {
    setSelection(getInitialVariantSelection(product));
  }, [product]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        beginClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isVisible]);

  const selectedVariant =
    resolveVariantBySelection(product, selection) ??
    getDefaultProductVariant(product);
  const hasChoices = hasVariantChoices(product);
  const buttonClassName = added ? addedClassName : idleClassName;
  const selectedPrice = useMemo(
    () =>
      isPaid
        ? selectedVariant?.reservePrice ?? product.reservePrice
        : selectedVariant?.price ?? product.price,
    [isPaid, product.price, product.reservePrice, selectedVariant]
  );

  const flashAdded = () => {
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1500);
  };

  const beginClose = () => {
    if (!isVisible || closing) return;
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      setOpen(false);
    }, 220);
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

    beginClose();
    flashAdded();
  };

  const modal = mounted && isVisible
    ? createPortal(
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 md:p-6"
          data-quick-add-root="true"
        >
          <div
            className={`absolute inset-0 bg-obsidian/58 backdrop-blur-md ${
              closing
                ? "animate-quick-add-backdrop-out"
                : "animate-quick-add-backdrop-in"
            }`}
            data-testid="quick-add-backdrop"
            onClick={beginClose}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`quick-add-title-${product.slug}`}
            data-testid="quick-add-dialog"
            className={`relative w-[min(92vw,34rem)] rounded-[1.75rem] border border-taupe/20 bg-bone shadow-[0_28px_90px_-20px_rgba(17,17,17,0.42)] overflow-hidden ${
              closing
                ? "animate-quick-add-panel-out"
                : "animate-quick-add-panel-in"
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top,rgba(110,139,116,0.18),transparent_68%)] pointer-events-none" />
            <div className="absolute inset-0 hero-grain opacity-[0.035] pointer-events-none" />

            <button
              type="button"
              onClick={beginClose}
              className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/72 text-charcoal/45 shadow-sm transition-all duration-200 hover:bg-white hover:text-charcoal hover:scale-105"
              aria-label="Close quick add"
            >
              <svg
                className="h-4.5 w-4.5"
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

            <div className="relative px-6 pb-6 pt-6 md:px-7 md:pb-7 md:pt-7">
              <div className="mb-5 border-b border-taupe/12 pb-4">
                <p className="text-[10px] tracking-[0.32em] uppercase text-sage font-medium mb-2">
                  Quick Add
                </p>
                <h3
                  id={`quick-add-title-${product.slug}`}
                  className="font-serif text-[1.9rem] leading-none text-obsidian mb-2"
                >
                  {modalTitle}
                </h3>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-charcoal/55">{product.name}</p>
                    <p className="mt-2 text-xs text-charcoal/38">
                      Pick your variant before adding it to the cart.
                    </p>
                  </div>
                  <div className="rounded-2xl bg-cream px-4 py-3 text-right shrink-0">
                    <p className="text-[10px] tracking-[0.18em] uppercase text-charcoal/35">
                      Price
                    </p>
                    <p className="mt-1 text-xl font-semibold text-forest">
                      ${selectedPrice}
                    </p>
                  </div>
                </div>
              </div>

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

              <div className="mt-5 rounded-2xl border border-taupe/12 bg-cream/80 px-4 py-3">
                <p className="text-[10px] tracking-[0.18em] uppercase text-charcoal/35">
                  Selected Variant
                </p>
                <div className="mt-1.5 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-obsidian">
                    {formatVariantSummary(selectedVariant)}
                  </p>
                  <span className="rounded-full bg-forest/8 px-2.5 py-1 text-[10px] tracking-[0.14em] uppercase text-forest">
                    {selectedVariant?.availableForSale === false
                      ? "Unavailable"
                      : "Ready"}
                  </span>
                </div>
              </div>

              <div className="mt-5 flex items-center gap-3">
                <button
                  type="button"
                  onClick={beginClose}
                  className="h-12 flex-1 rounded-xl border border-taupe/18 bg-bone text-charcoal/60 text-sm font-medium tracking-wide transition-colors hover:border-taupe/28 hover:text-charcoal"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!selectedVariant || !selectedVariant.availableForSale}
                  onClick={() => void handleConfirm()}
                  className="h-12 flex-[1.35] rounded-xl bg-forest text-bone text-sm font-medium tracking-wide uppercase shadow-[0_14px_28px_-14px_rgba(31,61,43,0.7)] transition-all duration-200 hover:bg-forest-dark hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0"
                >
                  {selectedVariant?.availableForSale === false
                    ? "Unavailable"
                    : "Add to Cart"}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

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
            setClosing(false);
            setOpen(true);
            return;
          }

          void handleConfirm();
        }}
      >
        {added ? addedContent : idleContent}
      </button>

      {modal}
    </>
  );
}
