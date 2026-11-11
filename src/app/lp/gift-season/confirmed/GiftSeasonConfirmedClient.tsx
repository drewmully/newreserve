"use client";

/**
 * Gift a Season confirmation (post-checkout). Copy rules: no em dashes,
 * "Reserve" never "box", concise.
 */

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { ShopSeasonalHeader } from "@/app/shop/components/ShopSeasonalHeader";
import { trackEvent } from "@/lib/tracking";
import type { GiftSeasonCount, GiftShipMode } from "@/lib/gifts/giftSeason";
import { GIFT_SEASON_SHIP_WINDOW } from "@/lib/gifts/giftSeasonConfig";
import { firePurchaseConversion } from "@/lib/analytics/googleAdsPurchaseClient";

interface Stored {
  name?: string;
  mode?: GiftShipMode;
  seasons?: number;
  email?: boolean;
}

function readStored(): string {
  try {
    return window.localStorage.getItem("mully_gift_season_last") ?? "";
  } catch {
    return "";
  }
}

export function giftConfirmedSteps(input: {
  shipMode: GiftShipMode;
  seasons: number;
  hasRecipientEmail: boolean;
}): string[] {
  const multi = input.seasons > 1;
  if (input.shipMode === "to_purchaser") {
    return [
      `Season 1 ships to you in ${GIFT_SEASON_SHIP_WINDOW}, ready to hand over. Tracking comes by email.`,
      ...(multi
        ? [
            input.hasRecipientEmail
              ? "After they open it, we'll email them to collect their address for the next seasons."
              : "After they open it, we'll email you to collect their address for the next seasons.",
            "The next seasons ship every 3 months to that address.",
          ]
        : ["That's the whole gift. Nothing renews."]),
    ];
  }
  return [
    `Season 1 ships to them in ${GIFT_SEASON_SHIP_WINDOW}. Tracking comes to you by email.`,
    ...(multi
      ? [
          "The next seasons ship to the same address every 3 months.",
          input.hasRecipientEmail
            ? "Before each season, we email them a link to update sizes or address."
            : "Before each season, we email you a link to update sizes or address.",
        ]
      : ["That's the whole gift. Nothing renews."]),
  ];
}

export default function GiftSeasonConfirmedClient({
  shipMode,
  seasons,
  fallbackName,
  giftToken = null,
}: {
  shipMode: GiftShipMode;
  seasons: GiftSeasonCount;
  fallbackName: string | null;
  giftToken?: string | null;
}) {
  const raw = useSyncExternalStore(
    () => () => {},
    readStored,
    () => ""
  );
  let stored: Stored = {};
  try {
    stored = raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    stored = {};
  }
  const name = (stored.name || fallbackName || "").trim();
  const hasRecipientEmail = !!stored.email;

  useEffect(() => {
    trackEvent("gift_season_confirmation_viewed", {
      properties: { ship_mode: shipMode, seasons, lp_source: "lp_gift_season" },
    }).catch(() => {});
  }, [shipMode, seasons]);

  // Gift checkouts return here, not /auth/callback, so fire the browser
  // Google Ads purchase conversion here. Deduped by transaction id.
  useEffect(() => {
    firePurchaseConversion({ fallbackTxnId: giftToken ? `mully-gift-${giftToken}` : null }).catch(() => {});
  }, [giftToken]);

  const steps = giftConfirmedSteps({ shipMode, seasons, hasRecipientEmail });
  const seasonsLabel = seasons === 1 ? "a season" : `${seasons} seasons`;

  return (
    <div className="min-h-screen bg-bone text-charcoal">
      <ShopSeasonalHeader accent="#4A3528" returnsLabel="Easy Returns" />
      <main className="pt-32 lg:pt-28 pb-16">
        <div className="max-w-xl mx-auto px-5" data-testid={`gift-confirmed-${shipMode}`}>
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-forest text-bone">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M5 12l5 5 9-11" />
            </svg>
          </div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-[#5b613f] mt-5">Order confirmed</div>
          <h1 className="font-serif font-normal text-[30px] sm:text-[38px] leading-[1.1] tracking-[-0.025em] text-[#111] mt-2">
            Your gift is on its way.
          </h1>
          <p className="text-sm text-charcoal/75 mt-3 leading-relaxed">
            {name ? `${name} gets` : "They get"} {seasonsLabel} of Mully Reserve, hand-picked by a Mully stylist.
          </p>

          <section className="mt-7 rounded-lg border border-forest/15 bg-white/60 p-5" aria-label="What happens next">
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#5b613f]">What happens next</div>
            <ol className="mt-3 space-y-3">
              {steps.map((s, i) => (
                <li key={s} className="flex gap-3 text-sm text-[#111] leading-relaxed">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-forest/10 text-[11px] text-forest">
                    {i + 1}
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            {seasons > 1 ? (
              <div className="mt-4 pt-4 border-t border-forest/10 text-[12px] text-[#625e55]" data-testid="gift-confirmed-schedule">
                Season 1 now, then every 3 months.
              </div>
            ) : null}
          </section>

          <p className="text-[12px] text-charcoal/60 mt-4 leading-relaxed">
            Your receipt comes from Shopify. Paid once, never renews. Questions? Reply to any Mully email.
          </p>
          <Link
            href="/shop"
            className="mt-6 inline-flex items-center justify-center min-h-12 w-full sm:w-auto bg-ember hover:bg-ember/90 text-bone px-7 rounded-md text-sm font-medium tracking-wide transition"
          >
            Back to the shop
          </Link>
        </div>
      </main>
    </div>
  );
}
