"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { createMembershipCheckout } from "@/lib/shopifyCheckout";
import { trackEvent } from "@/lib/tracking";
import { GlassHeader } from "@/app/components/ClientComponents";

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

const FAQS = [
  {
    q: "When does the box ship?",
    a: "First box ships within one business day of purchase. Quarterly thereafter on the same cadence — cancel anytime after the first.",
  },
  {
    q: "Can I time it for a birthday or holiday?",
    a: "Yes. Use the 'Deliver on' field below to schedule the first box for any future date. We'll hold and ship to land on time.",
  },
  {
    q: "Does the recipient need to know my email?",
    a: "No. We collect their shipping address and sizing directly from them after purchase. Your email is just for receipts.",
  },
  {
    q: "What if they don't like what's in the box?",
    a: "Members get free exchanges, no questions. Wrong size, wrong color — we'll swap it.",
  },
  {
    q: "Can I include a personal message?",
    a: "Yes. There's a message field below — we'll include it in the recipient's first box.",
  },
  {
    q: "How is this different from a gift card?",
    a: "A gift card is forgettable. Mully Reserve is a curated experience — premium brands, hand-picked, delivered to their door.",
  },
];

export default function GiftLPClient() {
  const [submitting, setSubmitting] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Personalization state. Captured as Shopify cart attributes so the
  // orders/paid webhook can route them to the (future) gift pipeline.
  const [recipientName, setRecipientName] = useState("");
  const [deliverOn, setDeliverOn] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void trackEvent("lp_gift_view", {
      properties: { source: "lp_gift" },
    });
    void trackEvent("view_item", {
      properties: { item: "mully-reserve-gift", source: "lp_gift" },
    });
  }, []);

  async function handleCheckout() {
    if (submitting) return;
    setSubmitting(true);

    void trackEvent("lp_gift_checkout_clicked", {
      properties: {
        has_recipient_name: Boolean(recipientName.trim()),
        has_message: Boolean(message.trim()),
        has_deliver_on: Boolean(deliverOn),
      },
    });
    void trackEvent("checkout_clicked", {
      properties: { plan: "member", source: "lp_gift" },
    });
    void trackEvent("plan_selected", {
      properties: { plan: "member", method: "shopify_checkout_gift" },
    });

    try {
      // Always uses the Reserve Member SKU ($250/qtr displayed, $249 charged). Phase 2 will add
      // logic in the orders/paid webhook to recognize gift=true and route
      // into the redemption pipeline (auto-cancel + recipient email).
      await createMembershipCheckout("member", {
        returnPath: "/auth/callback",
        attributes: [
          { key: "lp_source", value: "lp_gift" },
          { key: "ad_group", value: "golf-gifting" },
          { key: "gift", value: "true" },
          ...(recipientName.trim()
            ? [{ key: "gift_recipient_name", value: recipientName.trim().slice(0, 100) }]
            : []),
          ...(deliverOn
            ? [{ key: "gift_deliver_on", value: deliverOn }]
            : []),
          ...(message.trim()
            ? [{ key: "gift_message", value: message.trim().slice(0, 500) }]
            : []),
        ],
      });
    } catch (err) {
      console.error("[lp/gift] checkout failed:", err);
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-bone">
      <GlassHeader />

      {/* ─── HERO / PDP-style above-fold ─── */}
      <section className="relative px-6 md:px-12 lg:px-20 pt-24 md:pt-32 pb-16">
        <div className="max-w-7xl mx-auto grid md:grid-cols-[55%_45%] gap-8 md:gap-16 items-start">
          {/* LEFT — Image stack */}
          <div>
            <div className="relative w-full aspect-[4/5] rounded-2xl overflow-hidden bg-[#162b1e] border border-[#F5F1E8]/10 shadow-xl">
              <Image
                src="/reserve-founders-hero.jpg"
                alt="Mully Reserve gift box: curated premium golf brands"
                fill
                sizes="(min-width: 768px) 50vw, 100vw"
                className="object-cover"
                priority
              />
              {/* Gift ribbon badge overlay */}
              <div className="absolute top-4 left-4 bg-ember text-forest-dark text-[10px] tracking-[0.3em] uppercase font-medium px-3 py-1.5 rounded-full">
                The Gift
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3 mt-3">
              {[
                "/hero-shelf.png",
                "/hero-tee-flag.png",
                "/hero-chalice.png",
                "/hero-golf-ball.png",
              ].map((src) => (
                <div
                  key={src}
                  className="relative aspect-square rounded-lg overflow-hidden bg-bone-dark border border-forest/10"
                >
                  <Image src={src} alt="" fill sizes="120px" className="object-cover" />
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT — Buy box */}
          <div className="md:sticky md:top-28">
            <div className="mb-4">
              <span className="inline-flex items-center gap-2.5 text-[11px] tracking-[0.38em] uppercase font-medium">
                <span className="w-10 h-px bg-forest/20" />
                <span className="gold-shimmer-text">The Gift</span>
                <span className="w-10 h-px bg-forest/20" />
              </span>
            </div>

            <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-forest leading-[1.05] tracking-tight mb-4">
              The golf gift<br />that lasts longer<br />than a round.
            </h1>

            <div className="flex items-center gap-3 mb-5 text-sm">
              <div className="flex items-center gap-0.5 text-ember">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i}>★</span>
                ))}
              </div>
              <span className="text-charcoal/70">4.9 · 1,200+ members</span>
            </div>

            <p className="text-base md:text-lg text-charcoal leading-relaxed mb-6 max-w-md">
              Hand-curated quarterly box of premium golf brands. More value
              inside than what you pay. Better than a gift card — they
              actually use what's in it.
            </p>

            {/* Single tier card — gift is one option */}
            <div className="rounded-xl border-2 border-forest bg-forest/5 shadow-sm p-5 mb-6">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="font-serif text-xl text-forest">
                    Mully Reserve Gift
                  </div>
                  <div className="text-xs text-charcoal/60 mt-0.5">
                    Quarterly box · $300+ retail value inside
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-serif text-xl text-forest">$250</div>
                  <div className="text-xs text-charcoal/60">/quarter</div>
                </div>
              </div>
              <p className="text-xs text-charcoal/60 leading-relaxed pt-3 border-t border-forest/10">
                <span className="font-medium text-forest">Heads up:</span>{" "}
                Quarterly recurring — cancel anytime after the first box.
                We're rolling out true one-and-done gift purchases soon.
              </p>
            </div>

            {/* Personalization form */}
            <div className="space-y-3 mb-6">
              <div>
                <label className="text-xs text-forest/70 tracking-wide mb-1.5 block">
                  Recipient name (optional)
                </label>
                <input
                  type="text"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder="Their first name"
                  maxLength={100}
                  className="w-full px-3 py-2.5 rounded-lg border border-forest/20 bg-white text-sm focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest"
                />
              </div>
              <div>
                <label className="text-xs text-forest/70 tracking-wide mb-1.5 block">
                  Deliver on (optional)
                </label>
                <input
                  type="date"
                  value={deliverOn}
                  onChange={(e) => setDeliverOn(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="w-full px-3 py-2.5 rounded-lg border border-forest/20 bg-white text-sm focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest"
                />
              </div>
              <div>
                <label className="text-xs text-forest/70 tracking-wide mb-1.5 block">
                  Personal message (optional)
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="A short note we'll include in their first box."
                  maxLength={500}
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-lg border border-forest/20 bg-white text-sm focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest resize-none"
                />
                <div className="text-[11px] text-charcoal/50 mt-1">
                  {message.length}/500
                </div>
              </div>
            </div>

            {/* Trust badges */}
            <div className="flex flex-wrap gap-x-5 gap-y-2 mb-6 text-sm text-forest/80">
              <span className="flex items-center gap-1.5">
                <span className="text-ember">⛳</span> Free shipping
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-ember">✦</span> Cancel anytime
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-ember">⟳</span> Free exchanges
              </span>
            </div>

            <button
              type="button"
              onClick={handleCheckout}
              disabled={submitting}
              className="w-full bg-forest hover:bg-forest-light disabled:opacity-60 text-bone font-medium tracking-wide py-4 rounded-xl transition-colors text-base"
            >
              {submitting ? "Loading checkout…" : "Gift Mully Reserve"}
            </button>

            <p className="text-[11px] text-charcoal/50 tracking-wide mt-3 text-center">
              Hand-curated · Shipped in one business day · Exchanged without question
            </p>
          </div>
        </div>
      </section>

      {/* ─── HOW GIFTING WORKS ─── */}
      <section className="px-6 md:px-12 lg:px-20 py-16 md:py-24 bg-bone-dark/40 border-y border-forest/10">
        <div className="max-w-5xl mx-auto">
          <p className="text-[11px] tracking-[0.38em] uppercase text-sage text-center mb-3">
            How gifting works
          </p>
          <h2 className="font-serif text-3xl md:text-4xl text-forest text-center mb-12">
            Effortless from start to finish.
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                n: "1",
                title: "You buy the gift",
                body: "Add a personal note and choose when to deliver. Checkout in under a minute.",
              },
              {
                n: "2",
                title: "We curate the box",
                body: "Hand-picked premium golf brands worth $300+. Wrapped, shipped, ready.",
              },
              {
                n: "3",
                title: "They open it",
                body: "First box arrives on your chosen date. Free shipping. Free exchanges if anything's off.",
              },
            ].map((step) => (
              <div key={step.n} className="text-center">
                <div className="font-serif text-5xl text-ember mb-3">
                  {step.n}
                </div>
                <div className="font-serif text-xl text-forest mb-2">
                  {step.title}
                </div>
                <p className="text-sm text-charcoal/70 leading-relaxed">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── BRAND STRIP ─── */}
      <section className="px-6 md:px-12 lg:px-20 py-12 md:py-16">
        <div className="max-w-7xl mx-auto">
          <p className="text-[11px] tracking-[0.38em] uppercase text-forest/60 text-center mb-6">
            Brands inside
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-6 md:gap-10 items-center justify-items-center opacity-80">
            {BRAND_LOGOS.map((b) => (
              <div key={b.src} className="relative w-20 h-12">
                <Image
                  src={b.src}
                  alt={b.alt}
                  fill
                  sizes="80px"
                  className="object-contain"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── TESTIMONIALS ─── */}
      <section className="px-6 md:px-12 lg:px-20 py-16 md:py-20 bg-forest text-bone">
        <div className="max-w-5xl mx-auto">
          <p className="text-[11px] tracking-[0.38em] uppercase text-bone/60 text-center mb-3">
            Reviews from gift recipients
          </p>
          <h2 className="font-serif text-3xl md:text-4xl text-bone text-center mb-12">
            The gift they remember.
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                quote:
                  "My wife gifted me Mully Reserve for our anniversary. Two boxes in and I've replaced half my golf wardrobe.",
                name: "James R.",
                meta: "Recipient · Anniversary gift",
              },
              {
                quote:
                  "Beats every gift card I've ever received. The Greyson polo alone was worth more than what she paid.",
                name: "Tyler M.",
                meta: "Recipient · Birthday gift",
              },
              {
                quote:
                  "I gifted this to my dad for Father's Day. He said it's the best gift I've given him in 10 years.",
                name: "Sarah L.",
                meta: "Gifter · Father's Day",
              },
            ].map((t) => (
              <div
                key={t.name}
                className="bg-forest-light/30 border border-bone/10 rounded-xl p-6"
              >
                <div className="text-ember mb-3">★★★★★</div>
                <p className="text-bone/90 text-sm leading-relaxed mb-4">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div className="text-xs text-bone/60 tracking-wide">
                  {t.name} — {t.meta}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section className="px-6 md:px-12 lg:px-20 py-16 md:py-24">
        <div className="max-w-3xl mx-auto">
          <p className="text-[11px] tracking-[0.38em] uppercase text-sage text-center mb-3">
            Gifting questions
          </p>
          <h2 className="font-serif text-3xl md:text-4xl text-forest text-center mb-10">
            Everything you'd ask.
          </h2>
          <div className="space-y-2">
            {FAQS.map((faq, i) => (
              <div
                key={i}
                className="border border-forest/15 rounded-lg bg-white"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full text-left px-5 py-4 flex items-center justify-between gap-4"
                >
                  <span className="font-medium text-forest">{faq.q}</span>
                  <span className="text-forest/40 text-xl shrink-0">
                    {openFaq === i ? "−" : "+"}
                  </span>
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4 text-sm text-charcoal/75 leading-relaxed">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── BOTTOM CTA ─── */}
      <section className="px-6 md:px-12 lg:px-20 py-16 md:py-24 bg-forest text-bone text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="font-serif text-3xl md:text-5xl mb-4 leading-tight">
            The gift every golfer wants.
          </h2>
          <p className="text-bone/75 mb-8">
            Hand-picked brands. Delivered to their door. Better than a gift card.
          </p>
          <button
            type="button"
            onClick={handleCheckout}
            disabled={submitting}
            className="bg-ember hover:bg-ember/90 disabled:opacity-60 text-forest-dark font-medium tracking-wide py-4 px-10 rounded-xl transition-colors"
          >
            {submitting ? "Loading checkout…" : "Gift Mully Reserve"}
          </button>
        </div>
      </section>
    </div>
  );
}
