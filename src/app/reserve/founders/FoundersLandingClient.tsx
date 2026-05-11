"use client";

/**
 * Founders LP — client island. Owns:
 *   - live spots-remaining counter (polled every 30s)
 *   - dual-CTA: pay-now (Shopify checkout w/ FOUNDERS50) vs reserve-by-reply
 *   - email capture form for the reply path (we don't have an inbox here,
 *     so the LP form posts to /api/reserve/reserve-by-reply on the server
 *     and surfaces a confirmation. Replying to the actual email also works
 *     via the analyzer trigger.)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createMembershipCheckout } from "@/lib/shopifyCheckout";
import type { FoundersTokenPayload } from "@/lib/foundersCampaign";

type Meta = {
  campaignId: string;
  totalSpots: number;
  deadline: string;
  discountCode: string;
};

type SpotsResponse = {
  campaign_id: string;
  total_spots: number;
  paid: number;
  pending: number;
  remaining: number;
  deadline: string;
  degraded?: boolean;
};

const POLL_MS = 30_000;

export default function FoundersLandingClient({
  tokenRaw,
  invite,
  meta,
}: {
  tokenRaw: string | null;
  invite: FoundersTokenPayload | null;
  meta: Meta;
}) {
  const [spots, setSpots] = useState<SpotsResponse | null>(null);
  const [spotsLoading, setSpotsLoading] = useState(true);
  const [payLoading, setPayLoading] = useState(false);
  const [reserveSubmitting, setReserveSubmitting] = useState(false);
  const [reserveResult, setReserveResult] = useState<
    | { kind: "idle" }
    | { kind: "ok"; email: string; expiresAt: string }
    | { kind: "err"; message: string }
  >({ kind: "idle" });
  const [emailDraft, setEmailDraft] = useState<string>(invite?.email ?? "");
  const pollRef = useRef<number | null>(null);

  // ---- counter polling -------------------------------------------------
  const fetchSpots = useCallback(async () => {
    try {
      const r = await fetch("/api/reserve/spots-remaining", { cache: "no-store" });
      if (r.ok) {
        const j = (await r.json()) as SpotsResponse;
        setSpots(j);
      }
    } catch {
      // swallow — keep last good value
    } finally {
      setSpotsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSpots();
    pollRef.current = window.setInterval(fetchSpots, POLL_MS);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [fetchSpots]);

  // ---- copy variants ---------------------------------------------------
  const isInvited = !!invite;
  const tier = invite?.tier ?? null;
  const firstName = invite?.firstName?.trim();
  const greetingName = firstName ? firstName.split(" ")[0] : null;

  const headline = useMemo(() => {
    if (tier === "A" || tier === "B")
      return greetingName
        ? `${greetingName}, your Reserve spot is held.`
        : "Your Reserve spot is held.";
    if (isInvited)
      return greetingName
        ? `${greetingName}, your Founders invite is live.`
        : "Your Founders invite is live.";
    return "Reserve Box — First Batch, May 27.";
  }, [tier, isInvited, greetingName]);

  const subhead = useMemo(() => {
    if (tier === "A" || tier === "B")
      return "We picked 300 founders to ship the first batch. You're one of them — claim your spot below.";
    if (isInvited)
      return "300 spots in the first batch. Founders pricing locks in your $50 off and your place in the May 27 shipment.";
    return "A curated quarterly box from Mully. Reserve Members get our best fits, picked for them.";
  }, [tier, isInvited]);

  const showDiscount = isInvited;
  const priceLabel = "$249/quarter";
  const founderPriceLabel = "$199 first quarter, then $249";

  // ---- CTAs -------------------------------------------------------------
  const handlePayNow = useCallback(async () => {
    setPayLoading(true);
    try {
      await createMembershipCheckout("member", {
        discountCodes: showDiscount ? [meta.discountCode] : [],
        email: invite?.email,
        attributes: [
          { key: "campaign_id", value: meta.campaignId },
          ...(invite?.email
            ? [{ key: "invited_email", value: invite.email }]
            : []),
          ...(invite?.tier
            ? [{ key: "invited_tier", value: invite.tier }]
            : []),
          ...(tokenRaw ? [{ key: "founders_token", value: tokenRaw }] : []),
        ],
        returnPath: "/auth/callback",
      });
    } finally {
      // createMembershipCheckout navigates away on success; if we get here
      // either the call failed silently or env vars are missing.
      setPayLoading(false);
    }
  }, [showDiscount, meta.discountCode, meta.campaignId, invite, tokenRaw]);

  const handleReserveByForm = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const email = emailDraft.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setReserveResult({ kind: "err", message: "Enter a valid email." });
        return;
      }
      setReserveSubmitting(true);
      setReserveResult({ kind: "idle" });
      try {
        // Public form goes through a server action proxy that adds the
        // CRON_SECRET — we'll add /api/reserve/reserve-by-reply/public next.
        const res = await fetch("/api/reserve/hold-by-form", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            token: tokenRaw,
            source: "lp_form",
          }),
        });
        const j = await res.json();
        if (!res.ok) {
          if (j?.error === "no_spots_remaining") {
            setReserveResult({
              kind: "err",
              message:
                "All 300 spots are claimed. We'll email you when the next batch opens.",
            });
          } else if (j?.error === "customer_not_found") {
            setReserveResult({
              kind: "err",
              message:
                "We can't find that email in our shortlist. Try a different one or pay below.",
            });
          } else {
            setReserveResult({
              kind: "err",
              message: "Hold failed. Try again or reply to the email.",
            });
          }
          return;
        }
        setReserveResult({
          kind: "ok",
          email,
          expiresAt: j.expires_at,
        });
        fetchSpots();
      } catch {
        setReserveResult({
          kind: "err",
          message: "Network error. Try again.",
        });
      } finally {
        setReserveSubmitting(false);
      }
    },
    [emailDraft, tokenRaw, fetchSpots],
  );

  // ---- derived counter UI ----------------------------------------------
  const remaining = spots?.remaining ?? meta.totalSpots;
  const claimed = (spots?.paid ?? 0) + (spots?.pending ?? 0);
  const pctClaimed = Math.min(
    100,
    Math.round((claimed / meta.totalSpots) * 100),
  );
  const isSoldOut = remaining <= 0;
  const isLow = remaining <= 50;

  // ---- render -----------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#111111]">
      {/* HERO */}
      <section className="relative overflow-hidden bg-[#1F3D2B] text-[#F5F1E8]">
        <div className="absolute inset-0 opacity-20 pointer-events-none [background:radial-gradient(circle_at_30%_20%,rgba(212,119,44,0.3),transparent_60%)]" />
        <div className="relative max-w-6xl mx-auto px-6 md:px-12 py-16 md:py-24 grid md:grid-cols-2 gap-10 md:gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#D4772C]/20 border border-[#D4772C]/40 text-[#D4772C] text-xs font-medium tracking-widest uppercase mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D4772C] animate-pulse" />
              First Batch · Ships {formatShipDate(meta.deadline)}
            </div>
            <h1
              className="text-4xl md:text-6xl leading-[1.05] tracking-tight mb-5"
              style={{ fontFamily: "Playfair Display, Georgia, serif" }}
            >
              {headline}
            </h1>
            <p className="text-lg md:text-xl text-[#F5F1E8]/85 mb-8 max-w-xl">
              {subhead}
            </p>

            {/* Live counter */}
            <div className="mb-8 max-w-md">
              <div className="flex items-end justify-between mb-2">
                <div>
                  <div className="text-5xl md:text-6xl font-semibold tabular-nums leading-none">
                    {spotsLoading ? "—" : remaining}
                  </div>
                  <div className="text-sm text-[#F5F1E8]/70 mt-1">
                    of {meta.totalSpots} founders spots left
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-[#D4772C] font-medium">
                    {pctClaimed}% claimed
                  </div>
                  {isLow && !isSoldOut && (
                    <div className="text-xs text-[#D4772C]/80 mt-1 uppercase tracking-wider">
                      Almost gone
                    </div>
                  )}
                </div>
              </div>
              <div className="h-2 w-full rounded-full bg-[#F5F1E8]/15 overflow-hidden">
                <div
                  className="h-full bg-[#D4772C] transition-all duration-700"
                  style={{ width: `${pctClaimed}%` }}
                />
              </div>
            </div>

            {/* Dual CTA */}
            {isSoldOut ? (
              <SoldOutBanner />
            ) : (
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handlePayNow}
                  disabled={payLoading}
                  className="px-6 py-4 rounded-xl bg-[#D4772C] text-[#F5F1E8] font-semibold hover:bg-[#bb6824] transition disabled:opacity-60"
                >
                  {payLoading ? "Loading…" : showDiscount ? "Claim my spot — $50 off" : "Become a Reserve Member"}
                </button>
                {isInvited && (
                  <a
                    href="#reserve-by-reply"
                    className="px-6 py-4 rounded-xl border border-[#F5F1E8]/40 text-[#F5F1E8] font-medium hover:bg-[#F5F1E8]/10 transition text-center"
                  >
                    Hold my spot for 48h
                  </a>
                )}
              </div>
            )}

            <p className="text-xs text-[#F5F1E8]/55 mt-4">
              {showDiscount
                ? `Founders pricing: ${founderPriceLabel}. Cancel anytime.`
                : `${priceLabel}. Cancel anytime.`}
            </p>
          </div>

          {/* Hero image placeholder — stock-style per Drew */}
          <div className="relative aspect-[4/5] rounded-2xl overflow-hidden bg-[#2a5239] border border-[#F5F1E8]/10">
            <div className="absolute inset-0 flex items-center justify-center text-[#F5F1E8]/30 text-sm">
              Box hero photo
            </div>
            <div className="absolute bottom-4 left-4 right-4 px-4 py-3 rounded-xl bg-[#111111]/40 backdrop-blur text-[#F5F1E8]">
              <div className="text-xs uppercase tracking-widest text-[#F5F1E8]/60 mb-1">
                First Batch
              </div>
              <div className="text-sm">
                Quarterly Reserve Box · 4–6 curated pieces
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* WHY YOU, WHY NOW */}
      <section className="max-w-5xl mx-auto px-6 md:px-12 py-16 md:py-20">
        <h2
          className="text-3xl md:text-4xl mb-10 tracking-tight"
          style={{ fontFamily: "Playfair Display, Georgia, serif" }}
        >
          {isInvited ? "Why you got this email" : "Why Reserve, why now"}
        </h2>
        <div className="grid md:grid-cols-3 gap-6 md:gap-8">
          {(isInvited
            ? [
                {
                  k: "Hand-picked",
                  v: "You're on the founders shortlist — based on your taste, history, and how you shop with us.",
                },
                {
                  k: "First batch",
                  v: `Only 300 boxes ship in the first wave on ${formatShipDate(meta.deadline)}. After that, the wait begins.`,
                },
                {
                  k: "Founders pricing",
                  v: "$50 off your first quarter, locked in for as long as you stay a Reserve Member.",
                },
              ]
            : [
                {
                  k: "Curated quarterly",
                  v: "Four shipments a year, each one built around your fit, your style, and the season.",
                },
                {
                  k: "Pro-grade picks",
                  v: "Pieces our stylists are excited about — not whatever a feed served up.",
                },
                {
                  k: "Cancel anytime",
                  v: "No contracts, no quarter you didn't want. Skip or pause whenever.",
                },
              ]
          ).map((b) => (
            <div
              key={b.k}
              className="p-6 rounded-2xl bg-white border border-[#C8BFAF]/40"
            >
              <div className="text-sm uppercase tracking-widest text-[#1F3D2B] mb-2 font-semibold">
                {b.k}
              </div>
              <p className="text-[#2A2A2A] leading-relaxed">{b.v}</p>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="bg-[#EDE8DC] py-16 md:py-20">
        <div className="max-w-5xl mx-auto px-6 md:px-12">
          <h2
            className="text-3xl md:text-4xl mb-10 tracking-tight text-center"
            style={{ fontFamily: "Playfair Display, Georgia, serif" }}
          >
            How the first batch works
          </h2>
          <ol className="grid md:grid-cols-4 gap-6">
            {[
              ["1", "Claim your spot", "Pay now or reply to hold for 48 hours."],
              ["2", "Tell us your fit", "Quick onboarding — sizes, style, what to avoid."],
              ["3", "We curate", "Our stylists pick 4–6 pieces. You preview before we ship."],
              ["4", "Box ships May 27", "Wear what you love. Send back what you don't."],
            ].map(([n, t, d]) => (
              <li
                key={n}
                className="p-6 rounded-2xl bg-[#FAF9F6] border border-[#C8BFAF]/40"
              >
                <div
                  className="text-3xl mb-3 text-[#1F3D2B]"
                  style={{ fontFamily: "Playfair Display, Georgia, serif" }}
                >
                  {n}
                </div>
                <div className="text-sm uppercase tracking-widest text-[#1F3D2B] font-semibold mb-2">
                  {t}
                </div>
                <p className="text-sm text-[#2A2A2A]/85">{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* RESERVE-BY-REPLY FORM (invited only) */}
      {isInvited && !isSoldOut && (
        <section
          id="reserve-by-reply"
          className="max-w-3xl mx-auto px-6 md:px-12 py-16 md:py-20"
        >
          <div className="p-8 md:p-10 rounded-3xl bg-[#1F3D2B] text-[#F5F1E8]">
            <h2
              className="text-2xl md:text-3xl mb-3 tracking-tight"
              style={{ fontFamily: "Playfair Display, Georgia, serif" }}
            >
              Not ready to pay yet?
            </h2>
            <p className="text-[#F5F1E8]/80 mb-6">
              We&apos;ll hold a spot in your name for 48 hours. Confirm with payment
              before the window closes and your founders price is locked in.
            </p>
            {reserveResult.kind === "ok" ? (
              <div className="p-4 rounded-xl bg-[#D4772C]/20 border border-[#D4772C]/40">
                <div className="text-sm font-semibold mb-1 text-[#F5F1E8]">
                  Spot held for {reserveResult.email}
                </div>
                <p className="text-sm text-[#F5F1E8]/80">
                  We&apos;ve reserved your place until{" "}
                  {formatExpiresAt(reserveResult.expiresAt)}. We&apos;ll email a
                  one-click payment link shortly.
                </p>
              </div>
            ) : (
              <form
                onSubmit={handleReserveByForm}
                className="flex flex-col sm:flex-row gap-3"
              >
                <input
                  type="email"
                  required
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  placeholder="you@example.com"
                  className="flex-1 h-12 px-4 rounded-xl bg-[#F5F1E8] text-[#111111] placeholder:text-[#2A2A2A]/40 focus:outline-none focus:ring-2 focus:ring-[#D4772C]/50"
                />
                <button
                  type="submit"
                  disabled={reserveSubmitting}
                  className="h-12 px-6 rounded-xl bg-[#D4772C] text-[#F5F1E8] font-semibold hover:bg-[#bb6824] transition disabled:opacity-60"
                >
                  {reserveSubmitting ? "Holding…" : "Hold my spot"}
                </button>
              </form>
            )}
            {reserveResult.kind === "err" && (
              <p className="text-sm text-[#D4772C] mt-3">
                {reserveResult.message}
              </p>
            )}
            <p className="text-xs text-[#F5F1E8]/55 mt-4">
              Or just reply to our email with the word RESERVE — same result.
            </p>
          </div>
        </section>
      )}

      {/* COMPARISON TABLE */}
      <section className="bg-[#FAF9F6] py-16 md:py-20">
        <div className="max-w-5xl mx-auto px-6 md:px-12">
          <h2
            className="text-3xl md:text-4xl mb-10 tracking-tight text-center"
            style={{ fontFamily: "Playfair Display, Georgia, serif" }}
          >
            Founders vs. waiting
          </h2>
          <div className="rounded-2xl border border-[#C8BFAF]/50 overflow-hidden">
            <div className="grid grid-cols-3 bg-[#1F3D2B] text-[#F5F1E8] text-sm font-semibold">
              <div className="p-4">&nbsp;</div>
              <div className="p-4 border-l border-[#F5F1E8]/15 text-center">
                Founders Batch
              </div>
              <div className="p-4 border-l border-[#F5F1E8]/15 text-center">
                Waitlist
              </div>
            </div>
            {[
              ["Ships", "May 27, 2026", "TBD — next batch only"],
              ["Price", showDiscount ? "$199 first quarter" : "$249/quarter", "$249/quarter"],
              ["$50 founders discount", "Yes — locked in", "No"],
              ["Spot in line", "Reserved", "First-come on next batch"],
              ["Cancel anytime", "Yes", "Yes"],
            ].map(([label, a, b]) => (
              <div
                key={label}
                className="grid grid-cols-3 border-t border-[#C8BFAF]/40 text-sm"
              >
                <div className="p-4 bg-white font-medium text-[#2A2A2A]">
                  {label}
                </div>
                <div className="p-4 bg-white border-l border-[#C8BFAF]/40 text-center text-[#1F3D2B] font-semibold">
                  {a}
                </div>
                <div className="p-4 bg-white border-l border-[#C8BFAF]/40 text-center text-[#2A2A2A]/60">
                  {b}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-6 md:px-12 py-16 md:py-20">
        <h2
          className="text-3xl md:text-4xl mb-8 tracking-tight"
          style={{ fontFamily: "Playfair Display, Georgia, serif" }}
        >
          Founders FAQ
        </h2>
        <div className="space-y-4">
          {[
            {
              q: "What's actually in the box?",
              a: "Four to six curated pieces for your season — shirts, layers, accessories — picked based on the fit and style profile you set during onboarding. You can preview before we ship and swap anything that doesn't feel right.",
            },
            {
              q: "Is the $50 discount one-time or ongoing?",
              a: "It's $50 off your first quarter. As long as you stay a Reserve Member, your founders status is locked in for future perks and early access.",
            },
            {
              q: "What if I miss the May 27 ship date?",
              a: "If all 300 spots fill before you claim, we'll add you to the waitlist for the next batch. Founders pricing only applies to this first batch.",
            },
            {
              q: "Can I cancel?",
              a: "Yes — anytime. No contracts, no penalties. Skip a quarter or stop entirely from your dashboard.",
            },
            {
              q: "How does the hold-by-reply work?",
              a: "Reply to our email with RESERVE (or use the form above) and we'll hold your spot for 48 hours. If you don't complete payment in that window, your spot returns to the pool.",
            },
          ].map((f) => (
            <details
              key={f.q}
              className="group rounded-2xl border border-[#C8BFAF]/40 bg-white p-5"
            >
              <summary className="cursor-pointer font-semibold text-[#111111] flex items-center justify-between">
                {f.q}
                <span className="ml-4 text-[#1F3D2B] group-open:rotate-45 transition-transform">
                  +
                </span>
              </summary>
              <p className="mt-3 text-[#2A2A2A]/85 leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* FOOTER CTA */}
      <section className="bg-[#1F3D2B] text-[#F5F1E8] py-16 md:py-20">
        <div className="max-w-3xl mx-auto px-6 md:px-12 text-center">
          <h2
            className="text-3xl md:text-5xl mb-4 tracking-tight"
            style={{ fontFamily: "Playfair Display, Georgia, serif" }}
          >
            {isSoldOut
              ? "First batch is full."
              : remaining < 100
                ? `Only ${remaining} spots left.`
                : "Lock in your founders spot."}
          </h2>
          <p className="text-[#F5F1E8]/80 mb-8">
            {isSoldOut
              ? "Join the waitlist to be first in line for the next batch."
              : `First batch ships ${formatShipDate(meta.deadline)}. Once 300 spots fill, that's it.`}
          </p>
          {!isSoldOut && (
            <button
              onClick={handlePayNow}
              disabled={payLoading}
              className="px-8 py-4 rounded-xl bg-[#D4772C] text-[#F5F1E8] font-semibold hover:bg-[#bb6824] transition disabled:opacity-60"
            >
              {payLoading
                ? "Loading…"
                : showDiscount
                  ? "Claim my spot — $50 off"
                  : "Become a Reserve Member"}
            </button>
          )}
          <p className="text-xs text-[#F5F1E8]/45 mt-8">
            555 Friendly St., Pontiac, MI 48341
          </p>
        </div>
      </section>
    </div>
  );
}

function SoldOutBanner() {
  return (
    <div className="px-5 py-4 rounded-xl bg-[#D4772C]/10 border border-[#D4772C]/30 text-[#F5F1E8]">
      <div className="font-semibold mb-1">Founders batch is full</div>
      <p className="text-sm text-[#F5F1E8]/80">
        All 300 spots are claimed. We&apos;re starting the waitlist for the next
        batch — drop your email and you&apos;ll be first in line.
      </p>
    </div>
  );
}

function formatShipDate(iso: string): string {
  try {
    const d = new Date(`${iso}T12:00:00Z`);
    return d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      timeZone: "America/Detroit",
    });
  } catch {
    return iso;
  }
}

function formatExpiresAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Detroit",
    });
  } catch {
    return iso;
  }
}
