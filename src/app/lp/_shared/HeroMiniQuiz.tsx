"use client";

/**
 * Inline mini style quiz shared by /lp/subscription and /lp/consult.
 *
 * Replaces the old static "How it works" 3-step block with an interactive,
 * paginated card: style -> shirt size -> waist -> a short reveal that hands
 * off straight to the Reserve Member checkout, carrying the collected answers
 * as Shopify subscription line-item properties.
 *
 * This reuses the existing createMembershipCheckout builder (no product/plan
 * IDs change). New analytics events only (mini_quiz_started /
 * mini_quiz_completed) so existing LP event names are untouched.
 */

import Image from "next/image";
import { useState } from "react";
import { createMembershipCheckout } from "@/lib/shopifyCheckout";
import { trackEvent } from "@/lib/tracking";
import { RECENT_BOX_PRODUCTS } from "./products";

const STYLES = [
  { key: "Prep", image: RECENT_BOX_PRODUCTS[2].image },
  { key: "Modern", image: RECENT_BOX_PRODUCTS[0].image },
  { key: "Classic", image: RECENT_BOX_PRODUCTS[1].image },
  { key: "Athletic", image: RECENT_BOX_PRODUCTS[4].image },
] as const;

const SHIRT_SIZES = ["S", "M", "L", "XL", "XXL"] as const;
const WAIST_SIZES = ["28", "30", "32", "34", "36", "38", "40"] as const;

const PILL =
  "rounded-full border px-5 py-2.5 text-sm tracking-wide transition cursor-pointer";
const PILL_ACTIVE = "border-forest bg-forest text-bone";
const PILL_IDLE = "border-charcoal/20 text-charcoal/70 hover:border-forest";

export function HeroMiniQuiz({ source }: { source: string }) {
  const [step, setStep] = useState(1);
  const [style, setStyle] = useState<string | null>(null);
  const [shirt, setShirt] = useState<string | null>(null);
  const [waist, setWaist] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function markStarted() {
    if (started) return;
    setStarted(true);
    trackEvent(
      "mini_quiz_started",
      { properties: { source } },
      { includeAuth: false }
    ).catch(() => {});
  }

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    trackEvent(
      "mini_quiz_completed",
      { properties: { source, style, shirt, waist } },
      { includeAuth: false }
    ).catch(() => {});
    try {
      await createMembershipCheckout("member", {
        attributes: [{ key: "lp_source", value: source }],
        subscriptionLineAttributes: [
          ...(style ? [{ key: "Style", value: style }] : []),
          ...(shirt ? [{ key: "Top size", value: shirt }] : []),
          ...(waist ? [{ key: "Waist", value: waist }] : []),
        ],
      });
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <section className="py-20 sm:py-28">
      <div className="max-w-2xl mx-auto px-5 sm:px-8">
        <div className="text-center mb-10">
          <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
            Build your edit
          </div>
          <h2 className="font-serif text-3xl sm:text-4xl text-forest leading-tight">
            Three questions. Sixty seconds.
          </h2>
          <p className="text-sm sm:text-base text-charcoal/65 mt-4 leading-relaxed">
            Martine curates every edit. Answer three quick questions and
            she&rsquo;ll build yours.
          </p>
        </div>

        <div className="rounded-lg border border-charcoal/[0.1] bg-white p-6 sm:p-8">
          {step <= 3 ? (
            <div className="text-[10px] tracking-[0.28em] uppercase text-charcoal/45 mb-5">
              Step {step} of 3
            </div>
          ) : null}

          {step === 1 && (
            <div>
              <div className="font-serif text-xl text-forest mb-5">
                What&rsquo;s your style?
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {STYLES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => {
                      markStarted();
                      setStyle(s.key);
                      setStep(2);
                    }}
                    className={[
                      "group relative overflow-hidden rounded-sm border transition cursor-pointer",
                      style === s.key
                        ? "border-forest"
                        : "border-charcoal/10 hover:border-forest",
                    ].join(" ")}
                  >
                    <div className="relative aspect-[3/4] bg-bone-dark/20">
                      <Image
                        src={s.image}
                        alt={s.key}
                        fill
                        sizes="(min-width: 640px) 22vw, 45vw"
                        className="object-cover"
                        unoptimized
                      />
                    </div>
                    <div className="py-2 text-center text-[11px] tracking-[0.22em] uppercase text-charcoal/70">
                      {s.key}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="font-serif text-xl text-forest mb-5">
                Your shirt size?
              </div>
              <div className="flex flex-wrap gap-2.5">
                {SHIRT_SIZES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setShirt(s);
                      setStep(3);
                    }}
                    className={[
                      PILL,
                      shirt === s ? PILL_ACTIVE : PILL_IDLE,
                    ].join(" ")}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="mt-6 text-xs tracking-wide text-charcoal/50 hover:text-charcoal underline cursor-pointer"
              >
                Back
              </button>
            </div>
          )}

          {step === 3 && (
            <div>
              <div className="font-serif text-xl text-forest mb-5">
                Your waist?
              </div>
              <div className="flex flex-wrap gap-2.5">
                {WAIST_SIZES.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => {
                      setWaist(w);
                      setStep(4);
                    }}
                    className={[
                      PILL,
                      waist === w ? PILL_ACTIVE : PILL_IDLE,
                    ].join(" ")}
                  >
                    {w}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="mt-6 text-xs tracking-wide text-charcoal/50 hover:text-charcoal underline cursor-pointer"
              >
                Back
              </button>
            </div>
          )}

          {step === 4 && (
            <div className="text-center">
              <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-3">
                Your edit
              </div>
              <div className="font-serif text-2xl sm:text-3xl text-forest leading-tight">
                Martine is ready to build your edit.
              </div>
              <p className="text-sm text-charcoal/65 mt-3 leading-relaxed">
                A {style?.toLowerCase()} edit in shirt {shirt}, waist {waist}.
                Here are two pieces she has in mind.
              </p>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-sm border border-charcoal/[0.1] px-4 py-5">
                  <div className="text-[10px] tracking-[0.22em] uppercase text-charcoal/45">
                    Rhone
                  </div>
                  <div className="font-serif text-base text-forest mt-1.5">
                    Commuter Quarter-Zip
                  </div>
                </div>
                <div className="rounded-sm border border-charcoal/[0.1] px-4 py-5">
                  <div className="text-[10px] tracking-[0.22em] uppercase text-charcoal/45">
                    Greyson
                  </div>
                  <div className="font-serif text-base text-forest mt-1.5">
                    Polo
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleConfirm}
                disabled={submitting}
                className="mt-7 w-full bg-ember hover:bg-ember/90 text-bone py-3.5 rounded-md text-sm font-medium tracking-wide transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting
                  ? "One moment…"
                  : "Confirm your edit → straight to checkout"}
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="mt-4 text-xs tracking-wide text-charcoal/50 hover:text-charcoal underline cursor-pointer"
              >
                Back
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
