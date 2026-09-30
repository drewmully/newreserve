"use client";

import { useState } from "react";
import { NotifyMeInline } from "../NotifyMeInline";

interface Props {
  onAddToCart: () => void;
  added: boolean;
  /** True when the currently-selected variant (or the whole product) is unavailable. */
  isUnavailable: boolean;
  isPreorder?: boolean;
  busy?: boolean;
  /** Ship estimate in weeks used in the pre-order label. Defaults to 2. */
  preOrderEtaWeeks?: number;
  accent: string;
  // Fields passed through to NotifyMeInline when the shopper opens it.
  productSlug: string;
  productName: string;
  variantId?: string;
  selectedSize?: string;
}

/**
 * PDP primary CTA.
 *
 * Available → "Add to cart" (solid accent button).
 * Available with currentlyNotInStock → enabled preorder with shipping estimate.
 * Unavailable (DENY or invalid combination) → disabled, never a fake preorder.
 *
 * The "Add to cart" ↔ "Pre-order" swap runs client-side based on the current
 * variant selection. Pre-order orders flow through normal Shopify checkout —
 * fulfillment holds are managed separately through the merchant's Shopify Flow.
 */
export function BuyBoxAction({
  onAddToCart,
  added,
  isUnavailable,
  isPreorder = false,
  busy = false,
  preOrderEtaWeeks,
  accent,
  productSlug,
  productName,
  variantId,
  selectedSize,
}: Props) {
  const [notifyOpen, setNotifyOpen] = useState(false);
  const weeks = preOrderEtaWeeks && preOrderEtaWeeks > 0 ? preOrderEtaWeeks : 2;

  if (isUnavailable || isPreorder) {
    return (
      <div>
        <button
          onClick={onAddToCart}
          disabled={isUnavailable || busy}
          className="flex w-full flex-col items-center justify-center py-4 text-white transition-opacity duration-200 hover:opacity-90"
          style={{ backgroundColor: accent }}
        >
          <span className="text-[11px] font-mono uppercase tracking-[0.28em]">
            {busy ? "Adding…" : isUnavailable ? "Unavailable" : added ? "Preorder added" : "Preorder"}
          </span>
          <span className="mt-1 text-[10px] font-mono uppercase tracking-[0.2em] opacity-80">
            {isUnavailable ? "Choose another available option" : `Ships in about ${weeks} weeks`}
          </span>
        </button>
        {!notifyOpen ? (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={() => setNotifyOpen(true)}
              className="text-[10px] font-mono uppercase tracking-[0.22em] text-charcoal/50 underline underline-offset-4 transition-colors hover:text-charcoal"
            >
              or, notify me when back
            </button>
          </div>
        ) : (
          <div className="mt-3">
            <NotifyMeInline
              productSlug={productSlug}
              productName={productName}
              variantId={variantId}
              selectedSize={selectedSize}
              accent={accent}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={onAddToCart}
      disabled={busy}
      className="flex w-full items-center justify-center py-4 text-[11px] font-mono uppercase tracking-[0.28em] text-white transition-opacity duration-200 hover:opacity-90"
      style={{ backgroundColor: accent }}
    >
      {busy ? "Adding…" : added ? "Added to cart" : "Add to cart"}
    </button>
  );
}
