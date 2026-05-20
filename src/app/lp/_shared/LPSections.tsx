"use client";

import Image from "next/image";
import { RECENT_BOX_PRODUCTS, TRUST_BADGES } from "./products";

/* -------------------------------------------------------------------------- */
/*  Trust badge strip — Amazon-style icons row directly under the buy box     */
/* -------------------------------------------------------------------------- */

function BadgeIcon({ kind }: { kind: string }) {
  // Inline SVGs so we don't depend on any icon library
  const common = "h-6 w-6 text-forest";
  switch (kind) {
    case "value":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 7l9-4 9 4-9 4-9-4z" />
          <path d="M3 7v10l9 4 9-4V7" />
          <path d="M12 11v10" />
        </svg>
      );
    case "ship":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="2" y="7" width="13" height="10" rx="1" />
          <path d="M15 10h4l3 4v3h-7" />
          <circle cx="6" cy="19" r="2" />
          <circle cx="18" cy="19" r="2" />
        </svg>
      );
    case "cancel":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="12" cy="12" r="9" />
          <path d="M9 12h6" />
        </svg>
      );
    case "exchange":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 9h13l-3-3" />
          <path d="M20 15H7l3 3" />
        </svg>
      );
    case "sizing":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3" y="9" width="18" height="6" rx="1" />
          <path d="M7 9v3M11 9v3M15 9v3M19 9v3" />
        </svg>
      );
    default:
      return null;
  }
}

export function TrustBadgeStrip() {
  return (
    <div className="border-y border-forest/15 bg-bone-dark/30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-4">
          {TRUST_BADGES.map((b) => (
            <div key={b.label} className="flex items-center gap-3">
              <div className="shrink-0 h-10 w-10 rounded-full bg-bone border border-forest/15 flex items-center justify-center">
                <BadgeIcon kind={b.icon} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-forest leading-tight">
                  {b.label}
                </div>
                <div className="text-[11px] text-charcoal/60 leading-tight">
                  {b.sub}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Recent boxes carousel — Amazon's "frequently bought together" equivalent  */
/* -------------------------------------------------------------------------- */

export function RecentBoxesCarousel() {
  return (
    <section className="bg-bone py-14 sm:py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-3">
          <div className="text-[11px] tracking-[0.25em] uppercase text-ember/80 mb-2">
            Recently in members' boxes
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl text-forest">
            Examples of what's been inside.
          </h2>
          <p className="text-sm text-charcoal/70 mt-3 max-w-2xl mx-auto">
            These are examples of brands and pieces past members have unboxed.
            Curation rotates every quarter — your box will include a new
            handpicked mix from labels worth knowing.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {RECENT_BOX_PRODUCTS.map((p) => (
            <div
              key={p.title}
              className="bg-bone-dark/40 rounded-lg overflow-hidden border border-forest/10 group"
            >
              <div className="aspect-square relative bg-white overflow-hidden">
                <Image
                  src={p.image}
                  alt={`Example item from a past Mully Reserve box: ${p.vendor} ${p.title}`}
                  fill
                  sizes="(min-width: 1024px) 22vw, (min-width: 640px) 30vw, 45vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                  unoptimized
                />
                <div className="absolute top-2 left-2 z-10 inline-flex items-center gap-1 bg-forest/90 backdrop-blur-sm text-bone text-[9px] tracking-[0.18em] uppercase font-medium px-2 py-1 rounded-sm shadow-sm">
                  <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.2L19.8 8 12 11.8 4.2 8 12 4.2zM4 9.8l7 3.5v6.4l-7-3.5V9.8zm9 9.9v-6.4l7-3.5v6.4l-7 3.5z"/>
                  </svg>
                  Example
                </div>
              </div>
              <div className="px-3 py-3 border-t border-forest/10">
                <div className="text-[10px] tracking-[0.2em] uppercase text-ember/80">
                  {p.category}
                </div>
                <div className="text-sm font-medium text-forest leading-tight mt-1">
                  {p.vendor}
                </div>
                <div className="text-xs text-charcoal/70 leading-tight mt-0.5 line-clamp-1">
                  {p.title}
                </div>
                {p.retail ? (
                  <div className="text-[11px] text-charcoal/60 mt-1.5">
                    Retail {p.retail}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-[11px] text-charcoal/55 mt-6">
          Photos are examples of items members have received. Your box will be
          a new curated selection.
        </p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Reviews block — Junip-powered                                             */
/*  Uses Junip's storewide review section so reviews from both Reserve Access */
/*  and Member products surface together. Script + store key are loaded once  */
/*  in src/app/layout.tsx. Junip auto-mounts widgets on DOMContentLoaded; we   */
/*  also dispatch a window event after mount to trigger a refresh on SPA nav. */
/* -------------------------------------------------------------------------- */

export function ReviewsBlock() {
  return (
    <section className="bg-bone-dark/40 py-14 sm:py-20 border-y border-forest/10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <div className="text-[11px] tracking-[0.25em] uppercase text-ember/80 mb-2">
            Member reviews
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl text-forest">
            What members say.
          </h2>
        </div>

        {/*
          Junip storewide review section. data-reviews-type="all" pulls
          product reviews from every product in the store (incl. both the
          Reserve Access and Member products) plus any store-level reviews.
          data-show-summary renders Junip's own rating histogram at the top.
        */}
        <div className="junip-reviews-frame">
          <span
            className="junip-review-section"
            data-layout="grid"
            data-reviews-type="all"
            data-show-summary="true"
            data-reviews-count="12"
          >
            <span className="junip-review-section-wrapper" />
          </span>
        </div>

        {/*
          Hidden product-id anchors so Junip can also surface per-product
          context if we later swap in `junip-product-review` widgets.
          Reserve Access: 8501257175232
          Member:         8501257044160
        */}
        <span
          className="junip-product-review"
          data-product-id="8501257175232"
          aria-hidden="true"
          style={{ display: "none" }}
        />
        <span
          className="junip-product-review"
          data-product-id="8501257044160"
          aria-hidden="true"
          style={{ display: "none" }}
        />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  How sizing works — addresses "confirm sizing after purchase"               */
/* -------------------------------------------------------------------------- */

export function HowItWorks({ giftMode = false }: { giftMode?: boolean }) {
  const steps = giftMode
    ? [
        {
          n: "1",
          title: "Check out today",
          body: "Enter the recipient's name, an optional delivery date, and a personal message. We hold the box until you're ready.",
        },
        {
          n: "2",
          title: "We email the recipient",
          body: "On your chosen date, your giftee gets a beautiful note from you with a private link to confirm their sizing (shirt, pant, shoe, glove).",
        },
        {
          n: "3",
          title: "First box ships",
          body: "Hand-curated $300+ retail value box ships the next business day after they submit. Wrong size? Exchange free, no questions.",
        },
      ]
    : [
        {
          n: "1",
          title: "Check out today",
          body: "Quarterly Reserve Member subscription. $250 per quarter, billed once every three months. Cancel anytime after your first box.",
        },
        {
          n: "2",
          title: "Confirm sizing",
          body: "We email you a quick sizing form (shirt, pant, shoe, glove, fit preference). Takes under two minutes. No sizing form, no box.",
        },
        {
          n: "3",
          title: "First box ships",
          body: "Your first hand-curated box ships within one business day of the form. Wrong fit on anything? Exchange free, no questions asked.",
        },
      ];

  return (
    <section className="bg-bone py-14 sm:py-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <div className="text-[11px] tracking-[0.25em] uppercase text-ember/80 mb-2">
            How it works
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl text-forest">
            Three steps. No friction.
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {steps.map((s) => (
            <div
              key={s.n}
              className="bg-bone-dark/40 rounded-lg border border-forest/10 p-6 relative"
            >
              <div className="font-serif text-4xl text-ember/30 leading-none">
                {s.n}
              </div>
              <div className="font-serif text-lg text-forest mt-3">
                {s.title}
              </div>
              <p className="text-sm text-charcoal/75 mt-2 leading-relaxed">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Lifestyle gallery — Amazon's "From the manufacturer" equivalent           */
/* -------------------------------------------------------------------------- */

export function LifestyleGallery() {
  return (
    <section className="bg-forest text-bone py-14 sm:py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <div className="text-[11px] tracking-[0.25em] uppercase text-bone/70 mb-2">
            Inside the box
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl text-bone">
            Built for golfers with taste.
          </h2>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {RECENT_BOX_PRODUCTS.slice(0, 4).map((p) => (
            <div
              key={p.title}
              className="bg-bone aspect-square relative rounded-md overflow-hidden"
            >
              <Image
                src={p.image}
                alt={`${p.vendor} ${p.title} — featured in a past Mully Reserve box.`}
                fill
                sizes="(min-width: 1024px) 22vw, 45vw"
                className="object-cover"
                unoptimized
              />
              <div className="absolute top-2 left-2 z-10 inline-flex items-center gap-1 bg-forest-dark/85 backdrop-blur-sm text-bone text-[9px] tracking-[0.18em] uppercase font-medium px-2 py-1 rounded-sm">
                <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.2L19.8 8 12 11.8 4.2 8 12 4.2zM4 9.8l7 3.5v6.4l-7-3.5V9.8zm9 9.9v-6.4l7-3.5v6.4l-7 3.5z"/>
                </svg>
                Example
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-[11px] text-bone/55 mt-5">
          Past curations shown. Your box will include a new mix of brands and
          pieces our team selects this quarter.
        </p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Detailed product description — Amazon "Product description"               */
/* -------------------------------------------------------------------------- */

export function ProductDetails({ giftMode = false }: { giftMode?: boolean }) {
  return (
    <section className="bg-bone py-14 sm:py-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <div className="text-[11px] tracking-[0.25em] uppercase text-ember/80 mb-2">
            What's inside
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl text-forest">
            Quarterly curations, made for taste.
          </h2>
        </div>

        <div className="space-y-10">
          <div>
            <h3 className="font-serif text-xl text-forest mb-3">
              What's inside each quarter
            </h3>
            <p className="text-sm text-charcoal/80 leading-relaxed">
              Every quarter, our team curates a 4–6 piece capsule worth $300+
              at retail. You'll find apparel layers (polos, quarter-zips,
              shorts, hoodies), an accessory or two (belts, hats, yardage
              books, headcovers), and an occasional surprise from a small
              brand worth knowing. We rotate the entire mix every quarter —
              you'll never get the same box twice.
            </p>
          </div>

          <div>
            <h3 className="font-serif text-xl text-forest mb-3">
              How sizing works
            </h3>
            <p className="text-sm text-charcoal/80 leading-relaxed">
              {giftMode
                ? "After your purchase confirms, your recipient receives an email with a private link to enter their sizing — shirt, pant, shoe, glove, and a quick fit preference. Their first box ships within one business day of submission."
                : "After checkout we'll email you a private link to enter your sizing — shirt, pant, shoe, glove, and a quick fit preference. Takes under two minutes. Your first box ships within one business day of submission. We don't ship anything until sizing is confirmed."}
            </p>
          </div>

          <div>
            <h3 className="font-serif text-xl text-forest mb-3">
              Shipping and cadence
            </h3>
            <p className="text-sm text-charcoal/80 leading-relaxed">
              Free shipping in the continental US. Boxes ship quarterly on
              your billing date. Cancel anytime from your account after the
              first box — there's no annual lock-in.
            </p>
          </div>

          <div>
            <h3 className="font-serif text-xl text-forest mb-3">
              Wrong fit? We make it right.
            </h3>
            <p className="text-sm text-charcoal/80 leading-relaxed">
              If anything in your box doesn't fit or doesn't land for you,
              email us. We'll send a swap in the next size or pull something
              else from the rack. No restocking fee, no shipping fee, no
              questions.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
