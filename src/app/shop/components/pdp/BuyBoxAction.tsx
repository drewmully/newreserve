"use client";

import { useState } from "react";
import { NotifyMeInline } from "../NotifyMeInline";

interface Props {
  onAddToCart: () => void;
  added: boolean;
  /** True when the currently-selected variant (or the whole product) is unavailable. */
  isUnavailable: boolean;
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
 * Unavailable → "Pre-order · ships in ~N weeks" (still lets the shopper commit),
 *   with a small "or, notify me" chip underneath that reveals NotifyMeInline.
 *
 * The "Add to cart" ↔ "Pre-order" swap runs client-side based on the current
 * variant selection. Pre-order orders flow through normal Shopify checkout —
 * the fulfillment team currently handles ship-when-restocked as an out-of-band
 * process, so nothing else changes about the cart path.
 */
export function BuyBoxAction({
  onAddToCart,
  added,
  isUnavailable,
  preOrderEtaWeeks,
  accent,
  productSlug,
  productName,
  variantId,
  selectedSize,
}: Props) {
  const [notifyOpen, setNotifyOpen] = useState(false);
  const weeks = preOrderEtaWeeks && preOrderEtaWeeks > 0 ? preOrderEtaWeeks : 2;

  if (isUnavailable) {
    return (
      <div>
        <button
          onClick={onAddToCart}
          className="flex w-full flex-col items-center justify-center py-4 text-white transition-opacity duration-200 hover:opacity-90"
          style={{ backgroundColor: accent }}
        >
          <span className="text-[11px] font-mono uppercase tracking-[0.28em]">
            {added ? "Pre-order added" : "Pre-order"}
          </span>
          <span className="mt-1 text-[10px] font-mono uppercase tracking-[0.2em] opacity-80">
            Out of stock, ships in ~{weeks} weeks
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
      className="flex w-full items-center justify-center py-4 text-[11px] font-mono uppercase tracking-[0.28em] text-white transition-opacity duration-200 hover:opacity-90"
      style={{ backgroundColor: accent }}
    >
      {added ? "Added to cart" : "Add to cart"}
    </button>
  );
}
