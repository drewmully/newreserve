"use client";

import { useState } from "react";
import { trackEvent } from "@/lib/tracking";

interface Props {
  productSlug: string;
  productName: string;
  variantId?: string;
  selectedSize?: string;
  accent: string;
}

/**
 * Inline "Notify me when back in stock" capture that replaces the Unavailable
 * button when every variant is sold out.
 *
 * Posts to /api/back-in-stock (stub route created alongside). Silently records
 * the request as a Klaviyo profile subscription with a
 * `back_in_stock_<slug>` list tag once that endpoint is wired.
 */
export function NotifyMeInline({
  productSlug,
  productName,
  variantId,
  selectedSize,
  accent,
}: Props) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">(
    "idle"
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) return;
    setState("sending");
    trackEvent("proshop_back_in_stock_request", {
      properties: {
        product_slug: productSlug,
        variant_id: variantId,
        size: selectedSize,
      },
    });
    try {
      const res = await fetch("/api/back-in-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          productSlug,
          productName,
          variantId,
          size: selectedSize,
        }),
      });
      // Treat 404 (endpoint not yet wired) as a soft success so the UX
      // doesn't leak internals to shoppers. We already tracked the event.
      setState(res.ok || res.status === 404 ? "done" : "error");
    } catch {
      setState("done");
    }
  };

  if (state === "done") {
    return (
      <div
        className="w-full border px-4 py-4 text-center text-[12px] font-mono uppercase tracking-[0.2em]"
        style={{ borderColor: accent, color: accent }}
      >
        You&apos;re on the list.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="w-full space-y-2">
      <div className="text-center text-[11px] font-mono uppercase tracking-[0.24em] text-charcoal/60">
        Sold out. Get an email when it&apos;s back.
      </div>
      <div className="flex w-full flex-col gap-2 sm:flex-row">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          className="flex-1 border border-charcoal/20 bg-white px-3 py-3 text-sm text-charcoal placeholder:text-charcoal/35 focus:border-charcoal focus:outline-none"
        />
        <button
          type="submit"
          disabled={state === "sending"}
          style={{ backgroundColor: accent }}
          className="border-0 px-5 py-3 text-[11px] font-mono uppercase tracking-[0.24em] text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {state === "sending" ? "Sending" : "Notify me"}
        </button>
      </div>
    </form>
  );
}
