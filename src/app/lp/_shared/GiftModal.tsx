"use client";

/**
 * Gift flow shared by /lp/subscription and /lp/consult.
 *
 * `GiftCard` is the always-visible entry point under the hero CTA. Opening it
 * (or the "Gift for a Golfer" persona CTA) mounts `GiftModal`, which collects a
 * recipient shirt size and an optional note, then hands off to the Reserve
 * Member gift permalink on checkout.mymully.com with the collected values as
 * Shopify line-item properties.
 */

import { useEffect, useState } from "react";
import { trackEvent } from "@/lib/tracking";

const GIFT_CHECKOUT_BASE =
  "https://checkout.mymully.com/products/reserve-member-gift?utm_source=copyToPasteBoard&utm_medium=product-links&utm_content=web";

const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"] as const;
const MESSAGE_MAX = 200;

export function GiftCard({
  onOpen,
  className,
}: {
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={[
        "block w-full text-left rounded-sm border border-charcoal/15 p-4 transition hover:border-forest cursor-pointer",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="text-[10px] tracking-[0.28em] uppercase text-charcoal/50">
        Prefer to gift?
      </div>
      <div className="mt-1.5 text-sm text-charcoal/70 leading-relaxed">
        Gift a quarter to a golfer in your life. Ships in 1 business day. →
      </div>
    </button>
  );
}

export function GiftModal({
  open,
  onClose,
  source,
}: {
  open: boolean;
  onClose: () => void;
  source: string;
}) {
  const [size, setSize] = useState<(typeof SHIRT_SIZES)[number]>("L");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    trackEvent(
      "gift_modal_opened",
      { properties: { source } },
      { includeAuth: false }
    ).catch(() => {});
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, source]);

  if (!open) return null;

  function handleCheckout() {
    trackEvent(
      "gift_checkout_initiated",
      { properties: { source, shirt_size: size, has_message: message.length > 0 } },
      { includeAuth: false }
    ).catch(() => {});

    const url =
      `${GIFT_CHECKOUT_BASE}` +
      `&properties[Shirt Size]=${encodeURIComponent(size)}` +
      (message.trim()
        ? `&properties[Gift Message]=${encodeURIComponent(message.trim())}`
        : "");
    window.location.href = url;
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-charcoal/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Gift a quarter"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-lg sm:rounded-lg p-6 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60">
              Gift a quarter
            </div>
            <h3 className="font-serif text-2xl text-forest mt-2 leading-tight">
              A golfer&rsquo;s edit, on you.
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-charcoal/50 hover:text-charcoal text-2xl leading-none cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-charcoal/65 mt-3 leading-relaxed">
          Pick their shirt size and add a note. We ship the first edit within 1
          business day.
        </p>

        <div className="mt-6">
          <label
            htmlFor="gift-shirt-size"
            className="block text-[11px] tracking-[0.22em] uppercase text-charcoal/70 mb-2"
          >
            Recipient shirt size
          </label>
          <select
            id="gift-shirt-size"
            value={size}
            onChange={(e) =>
              setSize(e.target.value as (typeof SHIRT_SIZES)[number])
            }
            className="w-full rounded-md border border-forest/25 bg-white px-4 py-3 text-base text-charcoal focus:outline-none focus:ring-2 focus:ring-forest/40 cursor-pointer"
          >
            {SHIRT_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-5">
          <label
            htmlFor="gift-message"
            className="block text-[11px] tracking-[0.22em] uppercase text-charcoal/70 mb-2"
          >
            Gift message <span className="text-charcoal/40">(optional)</span>
          </label>
          <textarea
            id="gift-message"
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
            rows={3}
            maxLength={MESSAGE_MAX}
            placeholder="Happy birthday — dialed in for the season."
            className="w-full rounded-md border border-forest/25 bg-white px-4 py-3 text-base text-charcoal placeholder:text-charcoal/40 focus:outline-none focus:ring-2 focus:ring-forest/40 resize-none"
          />
          <div className="mt-1 text-right text-[11px] text-charcoal/45">
            {message.length}/{MESSAGE_MAX}
          </div>
        </div>

        <button
          type="button"
          onClick={handleCheckout}
          className="mt-6 w-full bg-ember hover:bg-ember/90 text-bone py-3.5 rounded-md text-sm font-medium tracking-wide transition cursor-pointer"
        >
          Checkout as a gift →
        </button>
      </div>
    </div>
  );
}
