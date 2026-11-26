"use client";

import { GIFT_ORDER_BY, isPastGiftOrderBy } from "@/lib/giftGuideDates";
import { getShopPresentation } from "../seasonalTheme";

/** Single customer-facing name for the automatic Shopify offer. */
export const SHOP_OFFER_LABEL = "Buy 2, take 15% off one";

/** "Dec 14" from the gift guide's single order-by date. */
function orderByShort(): string {
  return new Date(`${GIFT_ORDER_BY}T12:00:00-05:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}

/**
 * The seasonal strip above the header on every shop page. Three key
 * shopping proofs separated by faint dividers, matching the pattern
 * Huckberry (and every serious editorial commerce site) runs.
 *
 * Fixed to the top of the viewport. The header sits directly beneath it.
 */
export function ShopAnnouncementBar({
  returnsLabel = "Easy Returns",
  now,
}: {
  /** Optional override for the returns promise. Defaults to the sitewide copy. */
  returnsLabel?: string;
  /** Clock override for tests. */
  now?: Date;
} = {}) {
  const presentation = getShopPresentation(now);
  // Until the Christmas order-by date, the shipping slot carries the cutoff.
  const holidayCutoff = presentation.editName === "holiday" && !isPastGiftOrderBy(now);
  const items = [
    holidayCutoff
      ? { icon: TruckIcon, text: `Order by ${orderByShort()} for Christmas`, short: `Order by ${orderByShort()}` }
      : { icon: TruckIcon, text: "Ships from Mully Fulfillment", short: "Mully Fulfillment" },
    { icon: TagIcon, text: SHOP_OFFER_LABEL, short: "Buy 2, 15% off one" },
    { icon: ReturnIcon, text: returnsLabel, short: returnsLabel },
  ];

  return (
    <div data-testid="shop-announcement" className="fixed left-0 right-0 top-0 z-50 text-[#FAF9F6]" style={{ backgroundColor: presentation.barColor }} data-season={presentation.editName}>
      <div className="mx-auto flex h-8 max-w-7xl items-center justify-center gap-3 whitespace-nowrap px-3 font-sans text-[10px] font-medium tracking-[0.01em] sm:gap-6 sm:text-[11px] md:gap-10">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-1.5 sm:gap-2">
            <item.icon />
            <span className="hidden sm:inline" suppressHydrationWarning>{item.text}</span>
            <span className="sm:hidden" suppressHydrationWarning>{item.short}</span>
            {i < items.length - 1 && (
              <span className="ml-3 hidden text-white/25 sm:inline sm:ml-6 md:ml-10">
                |
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TruckIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9-1.5V4.875c0-.621.504-1.125 1.125-1.125h9.75c.621 0 1.125.504 1.125 1.125v11.25M15.75 18.75a1.5 1.5 0 003 0m-3 0a1.5 1.5 0 013 0m0 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12"
      />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 6h.008v.008H6V6z"
      />
    </svg>
  );
}

function ReturnIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
      />
    </svg>
  );
}
