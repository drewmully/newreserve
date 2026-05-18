"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { createMembershipCheckout } from "@/lib/shopifyCheckout";
import { trackEvent } from "@/lib/tracking";
import { GlassHeader } from "@/app/components/ClientComponents";

type Tier = "access" | "member";

const TIERS: Array<{
  id: Tier;
  label: string;
  price: string;
  cadence: string;
  blurb: string;
  highlight?: boolean;
}> = [
  {
    id: "access",
    label: "Reserve Access",
    price: "$99",
    cadence: "/year",
    blurb:
      "An annual taste of Mully Reserve. First access to drops and member pricing on every release.",
  },
  {
    id: "member",
    label: "Reserve Member",
    price: "$250",
    cadence: "/quarter",
    blurb:
      "The full quarterly box — $300+ retail value, hand-picked from brands worth wearing.",
    highlight: true,
  },
];

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
    q: "When does my first box ship?",
    a: "Within one business day of your first quarterly billing date. You'll get tracking the moment it leaves our warehouse.",
  },
  {
    q: "What if something doesn't fit?",
    a: "Exchange it without question. Members get free shipping both ways and we'll find you the right size or swap the item entirely.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel from your account in two clicks — no hoops, no retention emails, no nonsense.",
  },
  {
    q: "What brands are inside?",
    a: "Quiet Golf, Greyson, Rhone, Topo, Feetures, Arnie's, Field Day, Harlestons, Hyperice and more. We rotate the lineup so every box is a new discovery.",
  },
  {
    q: "How much value is in each box?",
    a: "Members typically receive $300+ retail value in each quarterly Reserve Member box. We curate, you save.",
  },
  {
    q: "I want to give this as a gift — can I?",
    a: "Yes. Visit our gift page to send Mully Reserve to someone else.",
  },
];

export default function SubscriptionLPClient() {
  const [selected, setSelected] = useState<Tier>("member");
  const [submitting, setSubmitting] = useState<Tier | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Fire the page-view event once on mount.
  useEffect(() => {
    void trackEvent("lp_subscription_view", {
      properties: { tier_default: "member" },
    });
    void trackEvent("view_item", {
      properties: { item: "mully-reserve-subscription", source: "lp_subscription" },
    });
  }, []);

  async function handleCheckout() {
    if (submitting) return;
    setSubmitting(selected);

    void trackEvent("lp_subscription_checkout_clicked", {
      properties: { tier: selected },
    });
    void trackEvent("checkout_clicked", {
      properties: { plan: selected, source: "lp_subscription" },
    });
    void trackEvent("plan_selected", {
      properties: { plan: selected, method: "shopify_checkout" },
    });

    try {
      await createMembershipCheckout(selected, {
        returnPath: "/auth/callback",
        attributes: [
          { key: "lp_source", value: "lp_subscription" },
          { key: "ad_group", value: "golf-subscription-intent" },
        ],
      });
    } catch (err) {
      console.error("[lp/subscription] checkout failed:", err);
      setSubmitting(null);
    }
  }

  return (
    <div className="min-h-screen bg-bone">
      <GlassHeader />

      {/* ─── HERO / PDP-style above-fold ─── */}
      <section className="relative px-6 md:px-12 lg:px-20 pt-24 md:pt-32 pb-16">
        <div className="max-w-7xl mx-auto grid md:grid-cols-[55%_45%] gap-8 md:gap-16 items-start">
          {/* LEFT — Image stack (Amazon-style gallery) */}
          <div>
            <div className="relative w-full aspect-[4/5] rounded-2xl overflow-hidden bg-[#162b1e] border border-[#F5F1E8]/10 shadow-xl">
              <Image
                src="/reserve-founders-hero.jpg"
                alt="Mully Reserve quarterly box: striped polo, navy pants, woven leather belt"
                fill
                sizes="(min-width: 768px) 50vw, 100vw"
                className="object-cover"
                priority
              />
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
                <span className="gold-shimmer-text">Mully Reserve</span>
                <span className="w-10 h-px bg-forest/20" />
              </span>
            </div>

            <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-forest leading-[1.05] tracking-tight mb-4">
              Quarterly box.<br />
              Built for golfers<br />with taste.
            </h1>

            {/* Rating / social proof row */}
            <div className="flex items-center gap-3 mb-5 text-sm">
              <div className="flex items-center gap-0.5 text-ember">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i}>★</span>
                ))}
              </div>
              <span className="text-charcoal/70">4.9 · 1,200+ members</span>
            </div>

            <p className="text-base md:text-lg text-charcoal leading-relaxed mb-6 max-w-md">
              Hand-curated quarterly boxes from the brands worth knowing.
              Members typically receive $300+ retail value per box. Free
              shipping. Cancel anytime.
            </p>

            {/* Tier picker */}
            <div className="space-y-3 mb-6">
              {TIERS.map((tier) => {
                const active = selected === tier.id;
                return (
                  <button
                    key={tier.id}
                    type="button"
                    onClick={() => setSelected(tier.id)}
                    className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
                      active
                        ? "border-forest bg-forest/5 shadow-sm"
                        : "border-forest/15 bg-white hover:border-forest/40"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`w-4 h-4 rounded-full border-2 ${
                              active
                                ? "border-forest bg-forest"
                                : "border-forest/30"
                            } flex items-center justify-center`}
                          >
                            {active && (
                              <span className="w-1.5 h-1.5 rounded-full bg-bone" />
                            )}
                          </span>
                          <span className="font-serif text-lg text-forest">
                            {tier.label}
                          </span>
                          {tier.highlight && (
                            <span className="text-[10px] tracking-[0.2em] uppercase bg-ember/10 text-ember px-1.5 py-0.5 rounded">
                              Most popular
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-charcoal/70 leading-relaxed pl-6">
                          {tier.blurb}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-serif text-xl text-forest">
                          {tier.price}
                        </div>
                        <div className="text-xs text-charcoal/60">
                          {tier.cadence}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
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
                <span className="text-ember">⟳</span> Exchange without question
              </span>
            </div>

            {/* Primary CTA */}
            <button
              type="button"
              onClick={handleCheckout}
              disabled={submitting !== null}
              className="w-full bg-forest hover:bg-forest-light disabled:opacity-60 text-bone font-medium tracking-wide py-4 rounded-xl transition-colors text-base"
            >
              {submitting ? "Loading checkout…" : "Start membership"}
            </button>

            <p className="text-[11px] text-charcoal/50 tracking-wide mt-3 text-center">
              Curated by hand · Shipped in one business day · Exchanged without question
            </p>
          </div>
        </div>
      </section>

      {/* ─── BRAND STRIP ─── */}
      <section className="px-6 md:px-12 lg:px-20 py-12 md:py-16 bg-bone-dark/40 border-y border-forest/10">
        <div className="max-w-7xl mx-auto">
          <p className="text-[11px] tracking-[0.38em] uppercase text-forest/60 text-center mb-6">
            Brands you'll find inside
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

      {/* ─── BENEFITS ─── */}
      <section className="px-6 md:px-12 lg:px-20 py-16 md:py-24">
        <div className="max-w-5xl mx-auto">
          <p className="text-[11px] tracking-[0.38em] uppercase text-sage text-center mb-3">
            Member benefits
          </p>
          <h2 className="font-serif text-3xl md:text-4xl text-forest text-center mb-12">
            More than a box.
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: "First access to every drop",
                body: "See new releases before they go public — and get member pricing on every one.",
              },
              {
                title: "Private course access",
                body: "Tee times at private clubs, partner fittings, and member-only experiences.",
              },
              {
                title: "Exchanged without question",
                body: "Wrong size? Wrong fit? Send it back. We'll make it right and ship the swap.",
              },
            ].map((b) => (
              <div key={b.title} className="text-center">
                <div className="font-serif text-xl text-forest mb-2">
                  {b.title}
                </div>
                <p className="text-sm text-charcoal/70 leading-relaxed">
                  {b.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── TESTIMONIALS ─── */}
      <section className="px-6 md:px-12 lg:px-20 py-16 md:py-20 bg-forest text-bone">
        <div className="max-w-5xl mx-auto">
          <p className="text-[11px] tracking-[0.38em] uppercase text-bone/60 text-center mb-3">
            Member reviews
          </p>
          <h2 className="font-serif text-3xl md:text-4xl text-bone text-center mb-12">
            What members say.
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                quote:
                  "Like Uncrate, but for golfers. I've discovered three brands I now buy from directly.",
                name: "Marcus P.",
                meta: "Member · 4 quarters",
              },
              {
                quote:
                  "The first quarter paid for itself. The Greyson polo alone retails at more than I paid.",
                name: "Drew K.",
                meta: "Member · 2 quarters",
              },
              {
                quote:
                  "I gifted this to my brother. Now we both subscribe. Best gift I've given in years.",
                name: "Sarah L.",
                meta: "Member · 6 quarters",
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
            Questions
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
            Built for golfers with taste.
          </h2>
          <p className="text-bone/75 mb-8">
            Quarterly curations. More value inside than what you pay. Cancel anytime.
          </p>
          <button
            type="button"
            onClick={handleCheckout}
            disabled={submitting !== null}
            className="bg-ember hover:bg-ember/90 disabled:opacity-60 text-forest-dark font-medium tracking-wide py-4 px-10 rounded-xl transition-colors"
          >
            {submitting ? "Loading checkout…" : "Start membership"}
          </button>
        </div>
      </section>
    </div>
  );
}
