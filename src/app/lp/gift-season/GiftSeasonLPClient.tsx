"use client";

/**
 * /lp/gift-season: Gift a Season of Mully Reserve.
 *
 * Prepaid, one checkout, no auto-renewal. The gifter picks 1, 2 or 4
 * seasons (prices come from the Shopify variants), enters the recipient, a note and a send
 * date, then pays once through Shopify checkout. Copy rules: no em dashes,
 * "Reserve" never "box".
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { trackEvent } from "@/lib/tracking";
import { captureAttributionFromUrl } from "@/lib/attribution";
import { ShopSeasonalHeader } from "@/app/shop/components/ShopSeasonalHeader";
import {
  HERO_EYEBROW,
  HERO_HEADLINE,
  HERO_LINE,
  HeroMedia,
  HeroTrustRow,
  type GiftHeroVariant,
} from "./GiftSeasonHero";
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

/** Real Reserve unboxing photo (approved by Drew for the gift moment). */
const GIFT_MOMENT_IMAGE = "/lp/discover/Unboxing-7.jpg";

const OPTION_COPY: Record<GiftSeasonCount, { title: string; detail: string; badge?: string }> = {
  1: { title: "1 season", detail: "One Reserve" },
  2: { title: "2 seasons", detail: "Two Reserves, 3 months apart" },
  4: { title: "4 seasons", detail: "One Reserve each season", badge: "Full year, best value" },
};

function giftSteps(timingLine: string) {
  return [
  { title: "You check out once", body: "Pick a length, add a note and choose when we tell them." },
  { title: "They confirm sizing", body: "We send a private link on your date. Two minutes, no guessing." },
  {
    title: "Reserve arrives each season",
    body: GIFT_SEASON_SHOW_FREE_SHIPPING_EXCHANGES
      ? `Hand-picked by a Mully stylist. Free shipping and free exchanges. ${timingLine}`
      : `Hand-picked by a Mully stylist. ${timingLine}`,
  },
  ];
}

const FAQ = [
  {
    q: "What if their size is wrong?",
    a: GIFT_SEASON_SHOW_FREE_SHIPPING_EXCHANGES
      ? "They confirm their own sizing before anything ships, so nobody guesses. If a size changes or something misses, exchanges are free."
      : "They confirm their own sizing before anything ships, so nobody guesses. If a size changes or something misses, they reply to any Mully email and our team sorts it out.",
  },
  {
    q: "What if they're already a member?",
    // Pending ops confirmation of how gift + membership stacking works.
    a: "We coordinate it with their membership so pieces don't repeat. Reply to your order confirmation with any questions.",
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
  heroVariant = "a",
}: {
  /** Hero option for Drew's comparison (?hero=a|b). Defaults to A. */
  heroVariant?: GiftHeroVariant;
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

  const pickerSectionRef = useRef<HTMLElement | null>(null);
  const detailsSectionRef = useRef<HTMLElement | null>(null);

  // Mobile: the Alhena chat launcher (#helix-chat-container) floats over the
  // hero CTA and the season cards. Hide it while either is on screen; it
  // returns once the visitor scrolls past. CSS limits this to <sm.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const targets = [
      document.querySelector<HTMLElement>("[data-testid=gift-hero-cta]"),
      pickerRef.current,
    ].filter((el): el is HTMLElement => !!el);
    if (targets.length === 0) return;
    const cls = "gs-hide-chat";
    const visible = new Set<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target);
          else visible.delete(e.target);
        }
        document.body.classList.toggle(cls, visible.size > 0);
      },
      { threshold: 0 }
    );
    targets.forEach((t) => io.observe(t));
    return () => {
      io.disconnect();
      document.body.classList.remove(cls);
    };
  }, [heroVariant]);

  function changeLength() {
    trackEvent("gift_season_summary_change_clicked", {
      properties: { seasons, hero: heroVariant, lp_source: LP_SOURCE },
    }).catch(() => {});
    pickerSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function scrollToPicker(target: "picker" | "details" | "moment") {
    trackEvent("gift_season_hero_cta_clicked", {
      properties: { hero: heroVariant, target, seasons, lp_source: LP_SOURCE },
    }).catch(() => {});
    const el = target === "details" ? detailsSectionRef.current : pickerSectionRef.current;
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // Cutoff copy is evaluated at view time, so the page flips after the
  // order-by date without a redeploy.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(t);
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const option = useMemo(
    () => options.find((o) => o.seasons === seasons)!,
    [options, seasons]
  );

  const fromPrice = useMemo(() => Math.min(...options.map((o) => o.price)), [options]);
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
    trackEvent("gift_season_view", { properties: { lp_source: LP_SOURCE, hero: heroVariant } }).catch(() => {});
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
      <ShopSeasonalHeader accent="#4A3528" returnsLabel="Easy Returns" />
      <main className="pt-24">
        <section
          className="lg:grid lg:grid-cols-2 lg:min-h-[calc(100svh-96px)]"
          data-testid={`gift-hero-${heroVariant}`}
        >
          {/* Desktop: full-bleed image fills the left half, matched to the picker column height. */}
          <div className="relative hidden lg:block">
            <HeroMedia variant={heroVariant} priority />
          </div>

          <div className="px-5 pt-5 sm:px-8 lg:px-14 xl:px-20 lg:py-10 flex flex-col justify-center">
            <div className="w-full max-w-[560px] lg:mx-auto">
              <div className="text-[11px] uppercase tracking-[0.12em] text-[#5b613f]">{HERO_EYEBROW}</div>
              <h1 className="font-serif font-normal text-[30px] sm:text-[40px] lg:text-[clamp(40px,3.6vw,52px)] leading-[1.1] tracking-[-0.025em] text-[#111] mt-2 lg:mt-3">
                {HERO_HEADLINE}
              </h1>
              <p className="text-[14px] lg:text-[15px] leading-[1.55] text-[#625e55] mt-2.5 lg:mt-3">{HERO_LINE}</p>

              {/* Mobile: compact full-bleed image, CTA and trust row above the fold. */}
              <div className="lg:hidden">
                <div className="relative -mx-5 sm:-mx-8 mt-4 h-[360px] sm:h-[460px]">
                  <HeroMedia variant={heroVariant} priority />
                </div>
                <div className="mt-4 flex items-center gap-4">
                  <a
                    href="#gift-picker"
                    onClick={(e) => {
                      e.preventDefault();
                      scrollToPicker("picker");
                    }}
                    data-testid="gift-hero-cta"
                    className="inline-flex flex-1 items-center justify-center min-h-12 bg-ember hover:bg-ember/90 text-bone px-6 rounded-md text-sm font-medium tracking-wide transition"
                  >
                    Choose a gift length
                  </a>
                  <div className="shrink-0 text-right">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-[#625e55]">From</div>
                    <div className="font-serif text-[22px] leading-none text-[#111]" data-testid="gift-hero-from">
                      {formatUsd(fromPrice)}
                    </div>
                  </div>
                </div>
                <HeroTrustRow className="mt-3" />
              </div>

              <section
                id="gift-picker"
                ref={pickerSectionRef}
                className="mt-10 lg:mt-7 scroll-mt-28"
                aria-label="Choose a gift length"
              >
                  <h2 className="text-[11px] uppercase tracking-[0.12em] text-[#5b613f] mb-2 font-normal" data-testid="gift-step-1-label">
                    Step 1 of 2 · Choose a gift length
                  </h2>
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
                    {giftSeasonTimingLine({ now, selfDeliver })}
                  </p>

                {/* Desktop: one CTA to step 2, trust row directly under it. */}
                <div className="hidden lg:block mt-5">
                  <a
                    href="#gift-details"
                    onClick={(e) => {
                      e.preventDefault();
                      scrollToPicker("details");
                    }}
                    data-testid="gift-hero-cta-desktop"
                    className="flex w-full items-center justify-center min-h-12 bg-ember hover:bg-ember/90 text-bone px-6 rounded-md text-sm font-medium tracking-wide transition"
                  >
                    Continue with {option.label} · {formatUsd(option.price)}
                  </a>
                  <HeroTrustRow className="mt-3 justify-center" />
                </div>
              </section>
            </div>
          </div>
        </section>

        <section
          id="gift-details"
          ref={detailsSectionRef}
          className="max-w-2xl lg:max-w-5xl mx-auto px-4 sm:px-6 lg:px-10 mt-10 lg:mt-16 scroll-mt-28"
          data-testid="gift-season-details"
        >
          <div className="text-[11px] uppercase tracking-[0.12em] text-[#5b613f]">Step 2 of 2</div>
          <h2 className="font-serif font-normal text-[25px] lg:text-[30px] leading-[1.2] tracking-[-0.025em] text-[#111] mt-1 mb-4">
            Who is it for?
          </h2>
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10 lg:items-start">
            <div onFocusCapture={handleFirstFocus}>
              <div className="bg-bone-dark/40 rounded-lg border border-forest/15 p-5">
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

                <div className="mt-4 pt-4 border-t border-forest/15 flex items-baseline justify-between lg:hidden">
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

            {/* Desktop order summary, right column next to the form. */}
            <aside
              className="hidden lg:block sticky top-28 rounded-lg border border-forest/15 bg-white/60 p-6"
              aria-label="Order summary"
              data-testid="gift-order-summary"
            >
              <div className="text-[11px] uppercase tracking-[0.12em] text-[#5b613f]">Order summary</div>
              <div className="mt-4 flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm text-[#111]">Reserve gift, {option.label}</div>
                  <div className="text-[12px] text-[#625e55] mt-0.5">{OPTION_COPY[option.seasons].detail}</div>
                </div>
                <button
                  type="button"
                  onClick={changeLength}
                  className="shrink-0 text-[12px] text-[#111] underline underline-offset-4 decoration-charcoal/30 hover:decoration-charcoal"
                  data-testid="gift-summary-change"
                >
                  Change
                </button>
              </div>
              <div className="mt-4 pt-4 border-t border-forest/10 space-y-1.5 text-[12px] text-[#625e55]">
                <div className="flex justify-between">
                  <span>Per season</span>
                  <span>{formatUsd(perSeasonPrice(option.price, option.seasons))}</span>
                </div>
                {seasonSavings(option.price, option.seasons, singlePrice) > 0 ? (
                  <div className="flex justify-between text-ember">
                    <span>You save</span>
                    <span>{formatUsd(seasonSavings(option.price, option.seasons, singlePrice))}</span>
                  </div>
                ) : null}
                {recipientName.trim() ? (
                  <div className="flex justify-between">
                    <span>For</span>
                    <span className="truncate max-w-[160px] text-right">{recipientName.trim()}</span>
                  </div>
                ) : null}
              </div>
              <div className="mt-4 pt-4 border-t border-forest/10 flex items-baseline justify-between">
                <span className="text-sm text-[#111]">Total</span>
                <span className="font-serif text-[28px] leading-none text-[#111]" data-testid="gift-summary-total">
                  {formatUsd(option.price)}
                </span>
              </div>
              <div className="mt-2 text-right text-[11px] text-[#625e55]">Paid once, never renews.</div>
            </aside>
          </div>
        </section>


        {/* Gift moment: real Reserve unboxing photo, below the fold so the
            hero keeps one focal point. Background matches the photo's
            backdrop so the square image blends into the band. */}
        <section
          className="mt-10 bg-[#1E3D2E] text-bone"
          data-testid="gift-moment"
          aria-labelledby="gift-moment-title"
        >
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 items-center">
            <div className="relative aspect-square w-full max-w-[560px] mx-auto lg:mx-0 lg:justify-self-end">
              <Image
                src={GIFT_MOMENT_IMAGE}
                alt="An opened Mully Reserve with a leather belt and folded apparel inside"
                fill
                sizes="(min-width: 1024px) 560px, 100vw"
                className="object-cover"
              />
            </div>
            <div className="px-6 pb-12 lg:py-16 lg:pl-12 lg:pr-16 max-w-xl">
              <div className="text-[11px] tracking-[0.2em] uppercase text-bone/60">The gift moment</div>
              <h2 id="gift-moment-title" className="font-serif text-3xl sm:text-4xl leading-[1.1] mt-3">
                Something new to open every season.
              </h2>
              <p className="mt-4 text-sm sm:text-base text-bone/75 leading-relaxed">
                Each Reserve arrives packed and styled to them, in the sizes they chose.
              </p>
              <button
                type="button"
                onClick={() => scrollToPicker("moment")}
                className="mt-7 inline-block bg-bone text-forest hover:bg-bone/90 py-3 px-7 rounded-md text-sm font-medium tracking-wide transition"
                data-testid="gift-moment-cta"
              >
                Choose a gift length
              </button>
            </div>
          </div>
        </section>

        <section className="py-12 bg-bone-dark/30 border-y border-forest/10">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            <h2 className="font-serif text-2xl text-forest mb-6">How the gift works</h2>
            <ol className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              {giftSteps(giftSeasonTimingLine({ now })).map((s, i) => (
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
