"use client";

/**
 * /lp/gift-season: Gift a Season of Mully Reserve.
 *
 * Prepaid, one checkout, no auto-renewal. The gifter picks 1, 2 or 4
 * seasons (prices come from the Shopify variants), enters the recipient, a note and a send
 * date, then pays once through Shopify checkout. Copy rules: no em dashes,
 * "Reserve" never "box".
 */

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { trackEvent } from "@/lib/tracking";
import { captureAttributionFromUrl } from "@/lib/attribution";
import { GlassHeader } from "@/app/components/ClientComponents";
import {
  GIFT_SEASON_OPTIONS,
  formatUsd,
  perSeasonPrice,
  seasonSavings,
  withLivePrices,
  type GiftSeasonCount,
} from "@/lib/gifts/giftSeason";
import {
  createGiftSeasonCheckout,
  validateGiftSeasonInput,
} from "@/lib/giftSeasonCheckout";
import {
  GIFT_SEASON_SHOW_FREE_SHIPPING_EXCHANGES,
  giftSeasonTimingLine,
} from "@/lib/gifts/giftSeasonConfig";

const LP_SOURCE = "lp_gift_season";

const OPTION_COPY: Record<GiftSeasonCount, { title: string; detail: string; badge?: string }> = {
  1: { title: "1 season", detail: "One Reserve" },
  2: { title: "2 seasons", detail: "Two Reserves, 3 months apart" },
  4: { title: "4 seasons", detail: "One Reserve each season", badge: "Full year, best value" },
};

const TIMING_LINE = giftSeasonTimingLine();

const STEPS = [
  { title: "You check out once", body: "Pick a length, add a note and choose when we tell them." },
  { title: "They confirm sizing", body: "We send a private link on your date. Two minutes, no guessing." },
  {
    title: "Reserve arrives each season",
    body: GIFT_SEASON_SHOW_FREE_SHIPPING_EXCHANGES
      ? `Hand-picked by a Mully stylist. Free shipping and free exchanges. ${TIMING_LINE}`
      : `Hand-picked by a Mully stylist. ${TIMING_LINE}`,
  },
];

/**
 * Real pieces from the June 2026 Reserve plan (mully_box_plan_by_order v4),
 * images from their Shopify products. Shown as examples only: contents vary
 * by recipient and season, so no item counts.
 */
const EXAMPLE_PIECES = [
  {
    category: "Polo",
    name: "Quiet Golf Vintage Polo",
    src: "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/VintagePoloFOREST_1.jpg?v=1775579860",
  },
  {
    category: "Outer layer",
    name: "Rhone Heritage Quarter Zip",
    src: "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/rhone-layering-s-heather-gray-rhone-men-s-heritage-midweight-1-4-zip-1196079589.png?v=1775579881",
  },
  {
    category: "Accessory",
    name: "Greyson Dad Hat",
    src: "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/MG23A25_100_1_4858.webp?v=1781539302",
  },
  {
    category: "Accessory",
    name: "Will Leather Braided Belt",
    src: "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/60397_BRAIDED_STRETCH_LEATHER_BELT_BLACK_01.jpg?v=1775486933",
  },
];

const FAQ = [
  {
    q: "What if their size is wrong?",
    a: GIFT_SEASON_SHOW_FREE_SHIPPING_EXCHANGES
      ? "They confirm their own sizing before anything ships, so nobody guesses. If a size changes or something misses, exchanges are free."
      : "They confirm their own sizing before anything ships, so nobody guesses. If a size changes or something misses, they reply to any Mully email and our team sorts it out.",
  },
  {
    q: "What if they're already a member?",
    a: "The gift Reserves arrive on top of their membership and never touch their billing. Prefer to handle it another way? Reply to your order confirmation and we will help.",
  },
  {
    q: "Who enters the shipping address?",
    a: "You do, at checkout. Every Reserve in the gift ships there. If they move, they reply to any Mully email and we update it.",
  },
  {
    q: "Can they change the timing?",
    a: "You pick the reveal date at checkout. To move it, reply to your order confirmation before it sends. Each Reserve then ships on the normal quarterly cycle once they confirm sizing.",
  },
  {
    q: "Does it really never renew?",
    a: "Yes. It's one payment with no subscription attached. Before their last Reserve we invite them to continue as a member, and they're only charged if they choose to join.",
  },
];

function todayIso(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export default function GiftSeasonLPClient({
  livePrices = null,
}: {
  /** Live Storefront variant prices keyed by numeric variant id. */
  livePrices?: Record<string, number> | null;
}) {
  const options = useMemo(() => withLivePrices(GIFT_SEASON_OPTIONS, livePrices), [livePrices]);
  const [seasons, setSeasons] = useState<GiftSeasonCount>(4);
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [deliverOn, setDeliverOn] = useState("");
  const [message, setMessage] = useState("");
  const [selfDeliver, setSelfDeliver] = useState(false);
  const formStarted = useRef(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  // Mobile: the Alhena chat launcher (#helix-chat-container) floats over the
  // season cards. Hide it while the picker is on screen; it returns once the
  // visitor scrolls past (or back above) the picker. CSS limits this to <sm.
  useEffect(() => {
    const el = pickerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const cls = "gs-hide-chat";
    const io = new IntersectionObserver(
      ([entry]) => document.body.classList.toggle(cls, entry.isIntersecting),
      { threshold: 0 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      document.body.classList.remove(cls);
    };
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const option = useMemo(
    () => options.find((o) => o.seasons === seasons)!,
    [options, seasons]
  );

  const singlePrice = useMemo(
    () => options.find((o) => o.seasons === 1)?.price ?? 0,
    [options]
  );

  function handleFirstFocus(e: React.FocusEvent<HTMLElement>) {
    if (formStarted.current) return;
    const field = (e.target as HTMLInputElement).name;
    if (!field) return;
    formStarted.current = true;
    trackEvent("gift_season_form_started", {
      properties: { seasons, field, lp_source: LP_SOURCE },
    }).catch(() => {});
  }

  function toggleSelfDeliver() {
    const next = !selfDeliver;
    setSelfDeliver(next);
    trackEvent("gift_season_self_deliver_toggled", {
      properties: { seasons, self_deliver: next, lp_source: LP_SOURCE },
    }).catch(() => {});
  }

  useEffect(() => {
    captureAttributionFromUrl();
    trackEvent("gift_season_view", { properties: { lp_source: LP_SOURCE } }).catch(() => {});
  }, []);

  function pick(n: GiftSeasonCount) {
    setSeasons(n);
    trackEvent("gift_season_length_selected", {
      properties: {
        seasons: n,
        value: options.find((o) => o.seasons === n)?.price ?? null,
        lp_source: LP_SOURCE,
      },
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
      selfDeliver,
    };
    const invalid = validateGiftSeasonInput(input, todayIso());
    if (invalid) {
      setError(invalid);
      trackEvent("gift_season_form_error", {
        properties: { seasons, reason: invalid, self_deliver: selfDeliver, lp_source: LP_SOURCE },
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
        self_deliver: selfDeliver,
        lp_source: LP_SOURCE,
      },
    }).catch(() => {});
    try {
      const url = await createGiftSeasonCheckout(input);
      window.location.href = url;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start checkout.";
      trackEvent("gift_season_checkout_error", {
        properties: { seasons, error: msg.slice(0, 200), lp_source: LP_SOURCE },
      }).catch(() => {});
      setError("Could not start checkout. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bone text-charcoal">
      <style>{`@media (max-width: 639px) { body.gs-hide-chat #helix-chat-container { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; transition: opacity 150ms; } }`}</style>
      <GlassHeader />
      <main className="pt-20 sm:pt-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          {/* Below lg: header, image, form. lg: image left (2 rows), header + form right. */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-x-10 lg:gap-y-0">
            <div className="order-1 lg:col-span-6 lg:col-start-7 lg:row-start-1">
              <div className="text-[11px] tracking-[0.25em] uppercase text-ember/80">
                Gift a season
              </div>
              <h1 className="font-serif text-3xl sm:text-4xl text-forest leading-[1.1] mt-2">
                Give a season of Mully Reserve.
              </h1>
              <p className="text-sm text-charcoal/80 mt-4 leading-relaxed">
                Hand-picked by a Mully stylist each season. They confirm their
                own sizing. You pay once and it never renews.
              </p>
            </div>

            <div className="order-2 lg:col-span-6 lg:col-start-1 lg:row-start-1 lg:row-span-2 lg:self-start">
              <div className="relative w-full aspect-[16/10] sm:aspect-square rounded-lg overflow-hidden bg-forest-dark">
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

            <div className="order-3 lg:col-span-6 lg:col-start-7 lg:row-start-2" onFocusCapture={handleFirstFocus}>
              <div className="lg:mt-5 bg-bone-dark/40 rounded-lg border border-forest/15 p-5">
                <div className="text-[11px] uppercase tracking-[0.15em] text-charcoal/65 mb-2">
                  Gift length
                </div>
                <div
                  ref={pickerRef}
                  className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-2 pt-1"
                  role="radiogroup"
                  aria-label="Gift length"
                >
                  {options.map((o) => {
                    const active = o.seasons === seasons;
                    const copy = OPTION_COPY[o.seasons];
                    const each = perSeasonPrice(o.price, o.seasons);
                    const save = seasonSavings(o.price, o.seasons, singlePrice);
                    return (
                      <button
                        key={o.seasons}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        data-testid={`season-${o.seasons}`}
                        onClick={() => pick(o.seasons)}
                        className={`relative text-left rounded-md border px-3 py-3 transition flex sm:block items-center justify-between gap-3 ${
                          active
                            ? "border-forest bg-forest text-bone"
                            : "border-forest/20 bg-bone hover:border-forest/40"
                        }`}
                      >
                        {copy.badge ? (
                          <span
                            className={`absolute -top-2 right-2 sm:left-2 sm:right-auto whitespace-nowrap text-[9px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded ${
                              active ? "bg-ember text-bone" : "bg-ember/90 text-bone"
                            }`}
                          >
                            {copy.badge}
                          </span>
                        ) : null}
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{copy.title}</div>
                          <div className={`text-[11px] mt-0.5 sm:mt-1 leading-snug ${active ? "text-bone/80" : "text-charcoal/60"}`}>
                            {copy.detail}
                          </div>
                        </div>
                        <div className="text-right sm:text-left sm:mt-2 shrink-0">
                          <div className={`font-serif text-xl ${active ? "text-bone" : "text-forest"}`}>
                            {formatUsd(o.price)}
                          </div>
                          <div
                            className={`text-[11px] leading-snug ${active ? "text-bone/85" : "text-charcoal/70"}`}
                            data-testid={`season-${o.seasons}-each`}
                          >
                            {formatUsd(each)} per season
                          </div>
                          {save > 0 ? (
                            <div
                              className={`text-[11px] font-medium leading-snug ${active ? "text-bone" : "text-ember"}`}
                              data-testid={`season-${o.seasons}-save`}
                            >
                              Save {formatUsd(save)}
                            </div>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-charcoal/70 mt-3 leading-relaxed" data-testid="gift-season-timing">
                  {TIMING_LINE}
                </p>

                <button
                  type="button"
                  role="switch"
                  aria-checked={selfDeliver}
                  onClick={toggleSelfDeliver}
                  data-testid="gift-season-self-deliver"
                  className="mt-4 w-full flex items-center justify-between gap-3 text-left"
                >
                  <span>
                    <span className="block text-sm text-charcoal">I&apos;ll give it myself</span>
                    <span className="block text-[11px] text-charcoal/60 leading-snug">
                      We email the reveal and a printable gift card to you instead.
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition ${
                      selfDeliver ? "bg-forest" : "bg-charcoal/25"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-bone transition-all ${
                        selfDeliver ? "left-[18px]" : "left-0.5"
                      }`}
                    />
                  </span>
                </button>

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
                  <Field
                    label="Recipient email"
                    optional={selfDeliver ? "optional" : undefined}
                    hint={
                      selfDeliver
                        ? "Only used to invite them to continue later."
                        : "We send their private sizing link here."
                    }
                  >
                    <input
                      type="email"
                      name="recipientEmail"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="their@email.com"
                      className="w-full bg-bone border border-forest/20 rounded px-3 py-2.5 text-sm focus:outline-none focus:border-forest"
                    />
                  </Field>
                  <Field
                    label={selfDeliver ? "Email me the gift card on" : "Send the gift on"}
                    optional="leave blank to send today"
                  >
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
                      {formatUsd(option.price)}
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-charcoal/60">
                    {formatUsd(perSeasonPrice(option.price, option.seasons))} per season
                    <br />
                    Paid once, never renews.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCheckout}
                  disabled={loading}
                  data-testid="gift-season-checkout"
                  className="w-full mt-4 bg-ember hover:bg-ember/90 disabled:opacity-60 text-bone py-3.5 rounded-md text-sm font-medium tracking-wide transition"
                >
                  {loading ? "Opening checkout..." : `Give ${option.label} · ${formatUsd(option.price)}`}
                </button>
                <div className="mt-3 text-center text-[11px] text-charcoal/60" data-testid="gift-season-microline">
                  Paid once. Never renews. Secure Shopify checkout.
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

        <section className="max-w-5xl mx-auto px-4 sm:px-6 mt-12" data-testid="gift-season-examples">
          <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 sm:gap-3 mb-4">
            <h2 className="font-serif text-2xl text-forest">In a typical Reserve</h2>
            <span className="text-[11px] uppercase tracking-[0.15em] text-charcoal/55">
              Examples from past seasons
            </span>
          </div>
          <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {EXAMPLE_PIECES.map((p) => (
              <li key={p.name} className="bg-bone rounded-lg border border-forest/10 overflow-hidden">
                <div className="relative w-full aspect-square bg-white">
                  <Image src={p.src} alt={`Example: ${p.name}`} fill sizes="(max-width: 640px) 50vw, 25vw" className="object-contain p-2" />
                </div>
                <div className="px-3 py-2 border-t border-forest/10">
                  <div className="text-[10px] uppercase tracking-[0.15em] text-ember/80">{p.category}</div>
                  <div className="text-xs text-charcoal/80 mt-0.5 leading-snug">{p.name}</div>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-charcoal/55 mt-3">
            Examples only. Every Reserve is styled to the recipient, so pieces vary.
          </p>
        </section>

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

        <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12" data-testid="gift-season-faq">
          <h2 className="font-serif text-2xl text-forest mb-4">Questions</h2>
          <div className="divide-y divide-forest/15 border-y border-forest/15">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-3">
                <summary className="flex items-center justify-between gap-3 cursor-pointer list-none text-sm text-charcoal">
                  {f.q}
                  <span aria-hidden="true" className="text-forest/70 transition group-open:rotate-45 text-lg leading-none">+</span>
                </summary>
                <p className="text-sm text-charcoal/75 mt-2 leading-relaxed">{f.a}</p>
              </details>
            ))}
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
