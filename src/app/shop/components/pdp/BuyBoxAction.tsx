"use client";

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
  // Kept for caller compatibility; the back-in-stock capture was removed from the PDP.
  productSlug: string;
  productName: string;
  variantId?: string;
  selectedSize?: string;
}

/**
 * PDP primary CTA.
 *
 * Available → "Add to cart" (solid accent button).
 * Available with currentlyNotInStock → enabled "Order Now"; the restock ship date shows in the trust strip.
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
  accent,
}: Props) {
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
            {busy ? "Adding…" : isUnavailable ? "Unavailable" : added ? "Added to cart" : "Order Now"}
          </span>
          {isUnavailable && (
            <span className="mt-1 text-[10px] font-mono uppercase tracking-[0.2em] opacity-80">
              Choose another available option
            </span>
          )}
        </button>
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
