"use client";

/**
 * Site-wide "Buy 2, Save 15%" pill shown on every PDP.
 *
 * The matching Shopify discount rule (`buy-2-save-15` — automatic discount, any
 * 2+ items from Mully shop collections) is configured in Shopify Admin. If the
 * rule is disabled the pill still shows; keep the two in sync.
 */
export function PromoPill() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-forest/25 bg-forest/[0.06] px-3 py-1 text-[11px] font-mono uppercase tracking-[0.2em] text-forest">
      <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-forest" />
      Buy 2, Save 15%
    </span>
  );
}
