"use client";

/**
 * Gift flow shared by /lp/subscription and /lp/consult.
 *
 * The subtle "Send it as a gift" link under the hero CTA (or the "A gift"
 * persona CTA) mounts `GiftModal`, which collects a recipient shirt size and an
 * optional note, then starts checkout through the shared
 * `createMembershipCheckout` Storefront flow (same builder the standard
 * "Get Started" and /lp/gift funnels use). That flow returns a Shopify
 * `checkoutUrl` from a cartCreate mutation, so it never triggers the customer
 * login prompt the raw checkout.mymully.com/products permalink did. The order
 * is tagged `gift=true` so the orders-paid webhook routes it through the gift
 * pipeline; the shirt size rides on the subscription line item.
 */

import { useEffect, useState } from "react";
import { trackEvent } from "@/lib/tracking";
import { createMembershipCheckout } from "@/lib/shopifyCheckout";

const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"] as const;
const MESSAGE_MAX = 200;

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function handleCheckout() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    trackEvent(
      "gift_checkout_initiated",
      { properties: { source, shirt_size: size, has_message: message.length > 0 } },
      { includeAuth: false }
    ).catch(() => {});

    const trimmedMessage = message.trim();
    try {
      await createMembershipCheckout("member", {
        returnPath: "/auth/callback",
        attributes: [
          { key: "lp_source", value: source },
          { key: "gift", value: "true" },
          ...(trimmedMessage
            ? [{ key: "gift_message", value: trimmedMessage }]
            : []),
        ],
        subscriptionLineAttributes: [{ key: "Top size", value: size }],
      });
    } catch {
      setSubmitting(false);
      setError("Could not start checkout. Please try again.");
    }
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

        {error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <button
          type="button"
          onClick={handleCheckout}
          disabled={submitting}
          className="mt-6 w-full bg-ember hover:bg-ember/90 text-bone py-3.5 rounded-md text-sm font-medium tracking-wide transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "One moment…" : "Checkout as a gift →"}
        </button>
      </div>
    </div>
  );
}
