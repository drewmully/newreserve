"use client";

/**
 * /lp/gift-season: Gift a Season of Mully Reserve.
 *
 * Prepaid, one checkout, no auto-renewal. The gifter picks 1, 2 or 4
 * seasons ($250 each, no discount), enters the recipient, a note and a send
 * date, then pays once through Shopify checkout. Copy rules: no em dashes,
 * "Reserve" never "box".
 */

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { trackEvent } from "@/lib/tracking";
import { captureAttributionFromUrl } from "@/lib/attribution";
import { GlassHeader } from "@/app/components/ClientComponents";
import {
  GIFT_SEASON_OPTIONS,
  type GiftSeasonCount,
} from "@/lib/gifts/giftSeason";
import {
  createGiftSeasonCheckout,
  validateGiftSeasonInput,
} from "@/lib/giftSeasonCheckout";

const LP_SOURCE = "lp_gift_season";

const OPTION_COPY: Record<GiftSeasonCount, { title: string; detail: string; badge?: string }> = {
  1: { title: "1 season", detail: "One Reserve" },
  2: { title: "2 seasons", detail: "Two Reserves, 3 months apart" },
  4: { title: "4 seasons", detail: "A full year, one Reserve each season", badge: "Full year" },
};

const STEPS = [
  { title: "You check out once", body: "Pick a length, add a note and choose when we tell them." },
  { title: "They confirm sizing", body: "We send a private link on your date. Two minutes, no guessing." },
  { title: "Reserve arrives each season", body: "Hand-picked by a stylist. Free shipping and free exchanges." },
];

function todayIso(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export default function GiftSeasonLPClient() {
  const [seasons, setSeasons] = useState<GiftSeasonCount>(4);
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [deliverOn, setDeliverOn] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const option = useMemo(
    () => GIFT_SEASON_OPTIONS.find((o) => o.seasons === seasons)!,
    [seasons]
  );

  useEffect(() => {
    captureAttributionFromUrl();
    trackEvent("gift_season_view", { properties: { lp_source: LP_SOURCE } }).catch(() => {});
  }, []);

  function pick(n: GiftSeasonCount) {
    setSeasons(n);
    trackEvent("gift_season_length_selected", {
      properties: { seasons: n, value: n * 250, lp_source: LP_SOURCE },
    }).catch(() => {});
  }

  async function handleCheckout() {
    setError(null);
    const input = {
      seasons,
      recipientName,
      recipientEmail,
      message,
      deliverOn,
      lpSource: LP_SOURCE,
    };
    const invalid = validateGiftSeasonInput(input, todayIso());
    if (invalid) {
      setError(invalid);
      trackEvent("gift_season_form_error", {
        properties: { seasons, reason: invalid },
      }).catch(() => {});
      return;
    }
    setLoading(true);
    trackEvent("gift_season_checkout_clicked", {
      properties: {
        seasons,
        value: option.price,
        currency: "USD",
        has_message: message.trim().length > 0,
        scheduled: !!deliverOn,
        lp_source: LP_SOURCE,
      },
    }).catch(() => {});
    try {
      const url = await createGiftSeasonCheckout(input);
      window.location.href = url;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start checkout.";
      trackEvent("gift_season_checkout_error", {
        properties: { seasons, error: msg.slice(0, 200) },
      }).catch(() => {});
      setError("Could not start checkout. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bone text-charcoal">
      <GlassHeader />
      <main className="pt-20 sm:pt-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10">
            <div className="lg:col-span-6">
              <div className="relative w-full aspect-[4/5] sm:aspect-square rounded-lg overflow-hidden bg-forest-dark">
                <Image
                  src="/reserve-founders-hero.jpg"
                  alt="A Mully Reserve laid out: folded golf apparel, a Reserve card, a braided belt and a striped polo."
                  fill
                  priority
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  className="object-cover"
                />
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="text-[11px] tracking-[0.25em] uppercase text-ember/80">
                Gift a season
              </div>
              <h1 className="font-serif text-3xl sm:text-4xl text-forest leading-[1.1] mt-2">
                Give a season of Mully Reserve.
              </h1>
              <p className="text-sm text-charcoal/80 mt-4 leading-relaxed">
                Hand-picked golf apparel and accessories, $300+ retail value
                each season. They confirm their own sizing. You pay once and
                it never renews.
              </p>

              <div className="mt-5 bg-bone-dark/40 rounded-lg border border-forest/15 p-5">
                <div className="text-[11px] uppercase tracking-[0.15em] text-charcoal/65 mb-2">
                  Gift length
                </div>
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Gift length">
                  {GIFT_SEASON_OPTIONS.map((o) => {
                    const active = o.seasons === seasons;
                    const copy = OPTION_COPY[o.seasons];
                    return (
                      <button
                        key={o.seasons}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        data-testid={`season-${o.seasons}`}
                        onClick={() => pick(o.seasons)}
                        className={`relative text-left rounded-md border px-3 py-3 transition ${
                          active
                            ? "border-forest bg-forest text-bone"
                            : "border-forest/20 bg-bone hover:border-forest/40"
                        }`}
                      >
                        {copy.badge ? (
                          <span
                            className={`absolute -top-2 right-2 text-[9px] uppercase tracking-[0.15em] px-1.5 py-0.5 rounded ${
                              active ? "bg-ember text-bone" : "bg-ember/90 text-bone"
                            }`}
                          >
                            {copy.badge}
                          </span>
                        ) : null}
                        <div className="text-sm font-medium">{copy.title}</div>
                        <div className={`font-serif text-xl mt-0.5 ${active ? "text-bone" : "text-forest"}`}>
                          ${o.price.toLocaleString("en-US")}
                        </div>
                        <div className={`text-[11px] mt-1 leading-snug ${active ? "text-bone/80" : "text-charcoal/60"}`}>
                          {copy.detail}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-3 mt-5">
                  <Field label="Recipient first name">
                    <input
                      type="text"
                      name="recipientName"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder="Their first name"
                      className="w-full bg-bone border border-forest/20 rounded px-3 py-2.5 text-sm focus:outline-none focus:border-forest"
                    />
                  </Field>
                  <Field label="Recipient email" hint="We send their private sizing link here.">
                    <input
                      type="email"
                      name="recipientEmail"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="their@email.com"
                      className="w-full bg-bone border border-forest/20 rounded px-3 py-2.5 text-sm focus:outline-none focus:border-forest"
                    />
                  </Field>
                  <Field label="Send the gift on" optional="leave blank to send today">
                    <input
                      type="date"
                      name="deliverOn"
                      min={todayIso()}
                      value={deliverOn}
                      onChange={(e) => setDeliverOn(e.target.value)}
                      className="w-full bg-bone border border-forest/20 rounded px-3 py-2.5 text-sm focus:outline-none focus:border-forest"
                    />
                  </Field>
                  <Field label="Your note" optional="optional">
                    <textarea
                      name="message"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="A few words they will see with the gift"
                      rows={3}
                      maxLength={500}
                      className="w-full bg-bone border border-forest/20 rounded px-3 py-2.5 text-sm focus:outline-none focus:border-forest resize-none"
                    />
                  </Field>
                </div>

                <div className="mt-4 pt-4 border-t border-forest/15 flex items-baseline justify-between">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.2em] text-charcoal/60">
                      Reserve gift, {option.label}
                    </div>
                    <div className="font-serif text-3xl text-forest mt-1" data-testid="season-total">
                      ${option.price.toLocaleString("en-US")}
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-charcoal/60">
                    $250 per season
                    <br />
                    Paid once, never renews
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCheckout}
                  disabled={loading}
                  data-testid="gift-season-checkout"
                  className="w-full mt-4 bg-ember hover:bg-ember/90 disabled:opacity-60 text-bone py-3.5 rounded-md text-sm font-medium tracking-wide transition"
                >
                  {loading ? "Opening checkout..." : `Give ${option.label} · $${option.price.toLocaleString("en-US")}`}
                </button>
                <div className="mt-3 text-center text-[11px] text-charcoal/60">
                  Secure checkout via Shopify
                </div>

                {error ? (
                  <div
                    role="alert"
                    className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2"
                  >
                    {error}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <section className="py-12 mt-10 bg-bone-dark/30 border-y border-forest/10">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            <h2 className="font-serif text-2xl text-forest mb-6">How the gift works</h2>
            <ol className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              {STEPS.map((s, i) => (
                <li key={s.title} className="bg-bone rounded-lg border border-forest/10 p-5">
                  <div className="text-[11px] tracking-[0.2em] uppercase text-ember/80">
                    Step {i + 1}
                  </div>
                  <div className="font-serif text-lg text-forest mt-1">{s.title}</div>
                  <p className="text-sm text-charcoal/75 mt-2 leading-relaxed">{s.body}</p>
                </li>
              ))}
            </ol>
            <p className="text-xs text-charcoal/60 mt-6 leading-relaxed max-w-3xl">
              Multi-season gifts ship one Reserve every 3 months. Before the
              last one, we invite them to continue as a member. They are never
              charged unless they choose to join.
            </p>
          </div>
        </section>

        <footer className="bg-forest-dark text-bone/55 text-xs py-8 text-center">
          © {new Date().getFullYear()} Mully. All rights reserved.
        </footer>
      </main>
    </div>
  );
}

function Field({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  optional?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.15em] text-charcoal/65 mb-1.5">
        {label}
        {optional ? (
          <span className="text-charcoal/45 ml-1 normal-case tracking-normal">({optional})</span>
        ) : null}
      </span>
      {children}
      {hint ? <span className="block text-[10px] text-charcoal/55 mt-1">{hint}</span> : null}
    </label>
  );
}
