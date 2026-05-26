"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { createMembershipCheckout } from "@/lib/shopifyCheckout";
import { trackEvent } from "@/lib/tracking";
import { captureAttributionFromUrl } from "@/lib/attribution";
import { GlassHeader } from "@/app/components/ClientComponents";
import { ReserveHeroImage } from "@/app/components/ReserveHeroImage";
import FoundingHundredCard from "@/app/components/FoundingHundredCard";
import { LP_GALLERY } from "../_shared/products";
import {
  TrustBadgeStrip,
  RecentBoxesCarousel,
  ReviewsBlock,
  HowItWorks,
  LifestyleGallery,
  ProductDetails,
} from "../_shared/LPSections";

const BRAND_LOGOS = [
  { src: "/brands/greyson.png", alt: "Greyson" },
  { src: "/brands/rhone.png", alt: "Rhone" },
  { src: "/brands/quiet-golf.png", alt: "Quiet Golf" },
  { src: "/brands/topo.png", alt: "Topo" },
  { src: "/brands/feetures.png", alt: "Feetures" },
  { src: "/brands/arnies.png", alt: "Arnie's" },
  { src: "/brands/field-day.png", alt: "Field Day" },
  { src: "/brands/harlestons.png", alt: "Harlestons" },
  { src: "/brands/hyperice.png", alt: "Hyperice" },
];

const ABOUT_BULLETS = [
  "Give a hand-curated quarterly box of $300+ retail value golf apparel and accessories — without picking sizes blind.",
  "After you check out, your recipient gets a beautifully designed note from you with a private link to confirm their sizing.",
  "Brands worth knowing: Rhone, Greyson, Quiet Golf, Will Leather Goods, Field Day, Penfold and more.",
  "Wrong fit on anything? They exchange free — no questions, no shipping fee.",
  "Quarterly recurring at $250/qtr — they can cancel anytime after the first box if they prefer a one-and-done gift.",
];

export default function GiftLPClient() {
  const [heroIndex, setHeroIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [deliverOn, setDeliverOn] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    // Persist ?gclid / ?utm_* into localStorage + cookie so they survive
    // the hop to Shopify checkout and back to /auth/callback.
    captureAttributionFromUrl();
    trackEvent("lp_gift_view");
  }, []);

  async function handleGift() {
    setError(null);

    const trimmedEmail = recipientEmail.trim();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Please enter the recipient's email so we can send them the gift.");
      return;
    }
    if (!recipientName.trim()) {
      setError("Please add the recipient's first name.");
      return;
    }

    setLoading(true);
    trackEvent("lp_gift_checkout_clicked", {
      properties: { tier: "member", method: "shopify_checkout_gift" },
    });

    try {
      await createMembershipCheckout("member", {
        returnPath: "/auth/callback",
        attributes: [
          { key: "lp_source", value: "lp_gift" },
          { key: "ad_group", value: "google_ads" },
          { key: "gift", value: "true" },
          { key: "gift_recipient_name", value: recipientName.trim() },
          { key: "gift_recipient_email", value: trimmedEmail },
          { key: "gift_deliver_on", value: deliverOn },
          { key: "gift_message", value: message },
        ],
      });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not start checkout. Please try again."
      );
      setLoading(false);
    }
  }

  const hero = LP_GALLERY[heroIndex];

  return (
    <div className="min-h-screen bg-bone text-charcoal">
      <GlassHeader />

      {/* ------------------------------- HERO ------------------------------- */}
      <main className="pt-20 sm:pt-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
            {/* Thumbnail rail */}
            <div className="hidden lg:flex lg:col-span-1 flex-col gap-2">
              {LP_GALLERY.map((g, i) => (
                <button
                  key={g.src}
                  type="button"
                  onMouseEnter={() => setHeroIndex(i)}
                  onClick={() => setHeroIndex(i)}
                  className={`relative w-full aspect-square rounded-md overflow-hidden border-2 transition ${
                    g.treatment === "flatlay" ? "bg-[#162b1e]" : ""
                  } ${
                    heroIndex === i
                      ? "border-forest"
                      : "border-forest/15 hover:border-forest/40"
                  }`}
                  aria-label={`Show image ${i + 1}`}
                >
                  <Image
                    src={g.src}
                    alt={g.alt}
                    fill
                    sizes="60px"
                    className={g.treatment === "flatlay" ? "object-contain" : "object-cover"}
                    unoptimized
                  />
                  {g.isExample ? (
                    <span className="absolute top-0.5 left-0.5 bg-forest/90 text-bone text-[7px] tracking-[0.15em] uppercase px-1 py-0.5 rounded-sm">
                      Ex.
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            {/* Main hero */}
            { /* Uses ReserveHeroImage so flat-lay-treatment heroes (cut-off-edge
               imagery with transparent top) feather into a forest backdrop. */ }
            <div className="lg:col-span-6">
              <div className="relative aspect-square bg-bone-dark/40 rounded-lg overflow-hidden border border-forest/10">
                <ReserveHeroImage
                  src={hero.src}
                  alt={hero.alt}
                  treatment={hero.treatment === "flatlay" ? "flatlay" : "default"}
                  sizes="(min-width: 1024px) 50vw, 100vw"
                  priority
                  unoptimized
                />
                {hero.isExample ? (
                  <div className="absolute top-4 left-4 z-10 inline-flex items-center gap-1.5 bg-forest/90 backdrop-blur-sm text-bone text-[10px] tracking-[0.22em] uppercase font-medium px-3 py-1.5 rounded-sm shadow-sm">
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.2L19.8 8 12 11.8 4.2 8 12 4.2zM4 9.8l7 3.5v6.4l-7-3.5V9.8zm9 9.9v-6.4l7-3.5v6.4l-7 3.5z"/>
                    </svg>
                    Example of past inclusions
                  </div>
                ) : null}
              </div>
              <div className="lg:hidden mt-3 grid grid-cols-5 gap-2">
                {LP_GALLERY.map((g, i) => (
                  <button
                    key={g.src}
                    type="button"
                    onClick={() => setHeroIndex(i)}
                    className={`relative aspect-square rounded-md overflow-hidden border-2 ${
                      g.treatment === "flatlay" ? "bg-[#162b1e]" : ""
                    } ${
                      heroIndex === i ? "border-forest" : "border-forest/15"
                    }`}
                    aria-label={`Show image ${i + 1}`}
                  >
                    <Image
                      src={g.src}
                      alt={g.alt}
                      fill
                      sizes="60px"
                      className={g.treatment === "flatlay" ? "object-contain" : "object-cover"}
                      unoptimized
                    />
                    {g.isExample ? (
                      <span className="absolute top-0.5 left-0.5 bg-forest/90 text-bone text-[7px] tracking-[0.15em] uppercase px-1 py-0.5 rounded-sm">
                        Ex.
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            {/* Buy box */}
            <div className="lg:col-span-5 flex flex-col">
              <div className="text-[11px] tracking-[0.25em] uppercase text-ember/80 mb-2">
                Mully Reserve · Gift Box
              </div>
              <h1 className="font-serif text-3xl sm:text-4xl text-forest leading-[1.1]">
                The gift for the<br />
                golfer with taste.
              </h1>

              <div className="mt-3 flex items-center gap-2 text-sm">
                <div className="inline-flex items-center gap-0.5 text-ember">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <svg
                      key={i}
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" />
                    </svg>
                  ))}
                </div>
                <span className="text-charcoal/70 text-xs">
                  4.9 · 1,247 members
                </span>
              </div>

              <p className="text-sm text-charcoal/80 mt-4 leading-relaxed">
                Hand-curated quarterly box. $300+ retail value. We email your
                recipient a beautiful note with a private link to confirm
                their sizing — so the box arrives perfect, not blind-guessed.
              </p>

              {/* Founding 100 — the recipient becomes a founding member,
                  so the rangefinder ships in their first box. Hidden when
                  sold out / inactive. */}
              <FoundingHundredCard className="mt-5" />

              {/* Gift form + Price + CTA */}
              <div className="mt-5 bg-bone-dark/40 rounded-lg border border-forest/15 p-5">
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] uppercase tracking-[0.15em] text-charcoal/65 mb-1.5">
                      Recipient name
                    </label>
                    <input
                      type="text"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder="Their first name"
                      className="w-full bg-bone border border-forest/20 rounded px-3 py-2.5 text-sm text-charcoal focus:outline-none focus:border-forest"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-[0.15em] text-charcoal/65 mb-1.5">
                      Recipient email
                    </label>
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="their@email.com"
                      className="w-full bg-bone border border-forest/20 rounded px-3 py-2.5 text-sm text-charcoal focus:outline-none focus:border-forest"
                    />
                    <p className="text-[10px] text-charcoal/55 mt-1">
                      We email them on the date below with a sizing link — they confirm fit before we ship.
                    </p>
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-[0.15em] text-charcoal/65 mb-1.5">
                      Deliver email on
                      <span className="text-charcoal/45 ml-1 normal-case tracking-normal">
                        (optional — leave blank to send today)
                      </span>
                    </label>
                    <input
                      type="date"
                      value={deliverOn}
                      onChange={(e) => setDeliverOn(e.target.value)}
                      className="w-full bg-bone border border-forest/20 rounded px-3 py-2.5 text-sm text-charcoal focus:outline-none focus:border-forest"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-[0.15em] text-charcoal/65 mb-1.5">
                      Personal message
                      <span className="text-charcoal/45 ml-1 normal-case tracking-normal">
                        (optional)
                      </span>
                    </label>
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="A short note that arrives with their gift email"
                      rows={3}
                      className="w-full bg-bone border border-forest/20 rounded px-3 py-2.5 text-sm text-charcoal focus:outline-none focus:border-forest resize-none"
                    />
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-forest/15 flex items-baseline justify-between">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.2em] text-charcoal/60">
                      Reserve Member · Gift
                    </div>
                    <div className="font-serif text-3xl text-forest mt-1">
                      $250
                      <span className="text-base text-charcoal/60 font-sans ml-1">
                        / quarter
                      </span>
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-charcoal/60">
                    Quarterly · recipient<br />
                    cancels anytime
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleGift}
                  disabled={loading}
                  className="w-full mt-4 bg-ember hover:bg-ember/90 disabled:opacity-60 text-bone py-3.5 rounded-md text-sm font-medium tracking-wide transition"
                >
                  {loading ? "Opening checkout…" : "Send the gift"}
                </button>

                <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-charcoal/60">
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                  Secure checkout via Shopify
                </div>

                {error ? (
                  <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                    {error}
                  </div>
                ) : null}

                <p className="text-[11px] text-charcoal/55 leading-relaxed mt-3 pt-3 border-t border-forest/10">
                  Gift purchases use the quarterly Reserve Member SKU. Your
                  recipient can cancel from their account anytime after the
                  first box if they'd prefer a one-and-done gift.
                </p>
              </div>

              <ul className="mt-5 space-y-2.5">
                {ABOUT_BULLETS.slice(0, 3).map((b) => (
                  <li
                    key={b}
                    className="flex gap-2.5 text-sm text-charcoal/80 leading-snug"
                  >
                    <span className="text-ember mt-1 shrink-0">▸</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* ----------------------- TRUST BADGE STRIP ----------------------- */}
        <div className="mt-10">
          <TrustBadgeStrip />
        </div>

        {/* ----------------------- BRAND LOGOS ----------------------- */}
        <section className="py-8 bg-bone">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            <div className="text-center text-[11px] tracking-[0.25em] uppercase text-charcoal/55 mb-5">
              Brands you'll find inside
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-x-4 gap-y-5 items-center">
              {BRAND_LOGOS.map((b) => (
                <div key={b.alt} className="relative h-7 sm:h-8">
                  <Image
                    src={b.src}
                    alt={b.alt}
                    fill
                    sizes="80px"
                    className="object-contain opacity-65"
                  />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ----------------------- ABOUT THIS GIFT ----------------------- */}
        <section className="py-12 bg-bone-dark/30 border-y border-forest/10">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <h2 className="font-serif text-xl text-forest mb-5">
              About this gift
            </h2>
            <ul className="space-y-3">
              {ABOUT_BULLETS.map((b) => (
                <li
                  key={b}
                  className="flex gap-3 text-sm text-charcoal/85 leading-relaxed"
                >
                  <span className="text-ember mt-1.5 shrink-0 text-xs">●</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ----------------------- HOW IT WORKS ----------------------- */}
        <HowItWorks giftMode />

        {/* ----------------------- RECENT BOXES CAROUSEL ----------------------- */}
        <RecentBoxesCarousel />

        {/* ----------------------- LIFESTYLE GALLERY ----------------------- */}
        <LifestyleGallery />

        {/* ----------------------- PRODUCT DETAILS ----------------------- */}
        <ProductDetails giftMode />

        {/* ----------------------- REVIEWS ----------------------- */}
        <ReviewsBlock />

        {/* ----------------------- FINAL CTA ----------------------- */}
        <section className="bg-forest text-bone py-16 sm:py-20">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
            <h2 className="font-serif text-3xl sm:text-4xl">
              The gift you'll be remembered for.
            </h2>
            <p className="text-sm sm:text-base text-bone/80 mt-4 max-w-2xl mx-auto leading-relaxed">
              They confirm their sizing. We curate the box. They get four
              quarters of brands worth knowing — without the awkward
              guess-the-shirt-size moment. $250/qtr, cancel anytime.
            </p>
            <button
              type="button"
              onClick={handleGift}
              disabled={loading}
              className="mt-7 bg-ember hover:bg-ember/90 disabled:opacity-60 text-bone py-3.5 px-10 rounded-md text-sm font-medium tracking-wide transition"
            >
              {loading ? "Opening checkout…" : "Send the gift · $250/qtr"}
            </button>
            <div className="mt-3 text-[11px] text-bone/55">
              Sizing confirmed by recipient · Free shipping · Exchange free
            </div>
          </div>
        </section>

        <footer className="bg-forest-dark text-bone/55 text-xs py-8 text-center">
          © {new Date().getFullYear()} Mullybox. All rights reserved.
        </footer>
      </main>
    </div>
  );
}
