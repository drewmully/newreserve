"use client";

import { useEffect, useState } from "react";
import { GlassHeader } from "@/app/components/ClientComponents";
import { createMembershipCheckout } from "@/lib/shopifyCheckout";
import { captureAttributionFromUrl } from "@/lib/attribution";
import { trackEvent } from "@/lib/tracking";

interface Props {
  giftOrderId: string;
  recipientFirstName: string | null;
  recipientEmail: string;
  purchaserFirstName: string | null;
  seasonsTotal: number;
  /** Opening line, built on the server (giftContinueLead). */
  lead: string;
  alreadyMember: boolean;
}

export default function GiftContinueClient({
  giftOrderId,
  recipientFirstName,
  recipientEmail,
  seasonsTotal,
  lead,
  alreadyMember,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = recipientFirstName?.trim() || "there";

  useEffect(() => {
    captureAttributionFromUrl();
    trackEvent("gift_season_continue_view", {
      properties: { gift_order_id: giftOrderId, seasons_total: seasonsTotal },
    }).catch(() => {});
  }, [giftOrderId, seasonsTotal]);

  async function handleContinue() {
    setError(null);
    setLoading(true);
    trackEvent("gift_season_continue_clicked", {
      properties: { gift_order_id: giftOrderId, seasons_total: seasonsTotal, value: 250 },
    }).catch(() => {});
    try {
      await createMembershipCheckout("member", {
        email: recipientEmail,
        returnPath: "/auth/callback",
        attributes: [
          { key: "lp_source", value: "gift_season_continue" },
          { key: "gift_season_continue_from", value: giftOrderId },
        ],
      });
    } catch {
      setError("Could not start checkout. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bone text-charcoal">
      <GlassHeader />
      <main className="pt-24 sm:pt-28 pb-16">
        <div className="max-w-xl mx-auto px-4 sm:px-6 text-center">
          <div className="text-[11px] tracking-[0.25em] uppercase text-ember/80 mb-2">
            Mully Reserve
          </div>
          {alreadyMember ? (
            <>
              <h1 className="font-serif text-3xl text-forest leading-tight">
                You are already a member, {name}.
              </h1>
              <p className="text-sm text-charcoal/75 mt-4">
                Manage your membership at{" "}
                <a href="/account" className="text-forest underline">
                  mymully.com/account
                </a>
                .
              </p>
            </>
          ) : (
            <>
              <h1 className="font-serif text-3xl sm:text-4xl text-forest leading-tight">
                Keep Reserve going, {name}.
              </h1>
              <p className="text-sm text-charcoal/80 mt-4 leading-relaxed">
                {lead}{" "}
                Continue as a Reserve Member and keep getting a hand-picked
                Reserve every season. Same stylist, same sizing.
              </p>
              <div className="mt-6 bg-bone-dark/40 border border-forest/15 rounded-lg p-5">
                <div className="font-serif text-3xl text-forest">
                  $250
                  <span className="text-base text-charcoal/60 font-sans ml-1">per season</span>
                </div>
                <div className="text-[11px] text-charcoal/60 mt-1">
                  Billed every 3 months. Cancel anytime.
                </div>
                <button
                  type="button"
                  onClick={handleContinue}
                  disabled={loading}
                  className="w-full mt-4 bg-ember hover:bg-ember/90 disabled:opacity-60 text-bone py-3.5 rounded-md text-sm font-medium tracking-wide transition"
                >
                  {loading ? "Opening checkout..." : "Continue as a member"}
                </button>
                {error ? (
                  <div role="alert" className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                    {error}
                  </div>
                ) : null}
              </div>
              <p className="text-xs text-charcoal/55 mt-5">
                Not now? Nothing to do. Your gift never renews.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
