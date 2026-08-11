"use client";

/**
 * Mully Reserve — /lp/discover landing page.
 *
 * Three-tier acquisition page. Every tier is the FIRST BOX of the same
 * Reserve membership; subsequent quarterly cycles bill at the full Reserve
 * Collection rate regardless of tier chosen today.
 *
 * COPY RULES (verified — do not violate):
 *   - No em-dashes anywhere on the page.
 *   - The words cheap / discount / deal / save must not appear.
 *   - No percent-off framing. Never "X% off", never "you save $Y".
 *   - Lower tiers are described by contents and experience, not price.
 *   - Voice: confident, direct, private-club register. Never a coupon.
 *
 * Data wiring:
 *   - `createMembershipCheckout("member", { discountCodes, attributes })`
 *     is the single seam. `discountCodes` is passed straight through to
 *     Shopify Storefront cartCreate; `attributes` become order note
 *     attributes for the orders-paid webhook.
 *   - Discount codes MULLY_DISCOVER (fixed $200 off Reserve Member,
 *     one-per-customer, product-scoped) and MULLY_SIGNATURE (fixed $125
 *     off, same rules) were created in Shopify admin on 2026-08-11.
 *   - The `discover_tier` cart attribute carries the choice into
 *     orders-paid where the FIRST order is tagged `discover-tier-<tier>`.
 *     Loop renewals cannot inherit the cart attribute.
 *
 * Analytics:
 *   - `lp_discover_view` on mount.
 *   - `lp_discover_tier_selected` on any tier CTA click (property: tier).
 *   - `lp_discover_timeline_interacted` when a member expands a timeline
 *     node.
 *   - Existing `quiz_started` / `quiz_step_completed` / `quiz_completed`
 *     from QuizLauncher/QuizModal continue to fire (source:
 *     "lp_discover").
 */

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GlassHeader } from "@/app/components/ClientComponents";
import { captureAttributionFromUrl } from "@/lib/attribution";
import { createMembershipCheckout } from "@/lib/shopifyCheckout";
import { trackEvent } from "@/lib/tracking";
import { CuratorStrip } from "../_shared/CuratorStrip";
import { QuizLauncher } from "../_shared/QuizLauncher";
import { RECENT_BOX_PRODUCTS } from "../_shared/products";

/* ---------- Tier definitions ------------------------------------------- */

type DiscoverTier = "discovery" | "signature" | "reserve";

interface TierConfig {
  id: DiscoverTier;
  eyebrow: string;
  title: string;
  firstBoxPrice: string;
  positioning: string;
  contents: string[];
  bestFor: string;
  ctaLabel: string;
  /** Shopify discount code passed to cartCreate. Empty string = no code. */
  discountCode: string;
  emphasized?: boolean;
}

const TIERS: TierConfig[] = [
  {
    id: "discovery",
    eyebrow: "Introductory box",
    title: "Discovery",
    firstBoxPrice: "$50",
    positioning:
      "Your first look at what Reserve does. A shorter edit built around one hero piece and the accessories that finish it.",
    contents: [
      "One layer or polo, chosen for your climate and fit",
      "One accessory pairing (belt, socks, or headwear)",
      "Curator notes on how to wear the pieces on and off the course",
    ],
    bestFor:
      "The player curious about the membership who wants a low-commitment way in.",
    ctaLabel: "Start with Discovery",
    discountCode: "MULLY_DISCOVER",
  },
  {
    id: "signature",
    eyebrow: "Enhanced box",
    title: "Signature Preview",
    firstBoxPrice: "$125",
    positioning:
      "A broader introduction to the Reserve mix. Two or three pieces chosen to work as a full outfit for your next round.",
    contents: [
      "Two apparel pieces styled to layer together",
      "One accessory pairing selected to complete the look",
      "Curator notes and care guidance",
    ],
    bestFor:
      "The member ready for a real outfit out of the gate, not just a taste.",
    ctaLabel: "Start with Signature Preview",
    discountCode: "MULLY_SIGNATURE",
    emphasized: true,
  },
  {
    id: "reserve",
    eyebrow: "Full first box",
    title: "Reserve Collection",
    firstBoxPrice: "$250",
    positioning:
      "The complete quarterly edit from day one. Four to six hand-picked pieces valued well above the membership rate.",
    contents: [
      "Four to six pieces spanning layers, polos, and accessories",
      "Full editorial styling notes for the season",
      "Priority selection into next quarter's rotation",
    ],
    bestFor:
      "The member who already knows the format and wants the whole edit on arrival.",
    ctaLabel: "Start with Reserve Collection",
    discountCode: "",
  },
];

/* ---------- Timeline definition --------------------------------------- */

interface TimelineNode {
  id: string;
  label: string;
  headline: string;
  body: string;
}

const TIMELINE: TimelineNode[] = [
  {
    id: "today",
    label: "Today",
    headline: "You pick your first box.",
    body: "Three ways into the same membership. Choose the entry that matches how you want to start.",
  },
  {
    id: "quiz",
    label: "Next",
    headline: "Two minutes with the style quiz.",
    body: "You tell us your fit, your favorite brands, and how you play. Our curators build your first shipment against your answers, not a template.",
  },
  {
    id: "first-box",
    label: "Within days",
    headline: "Your first box ships.",
    body: "Hand-selected pieces from Rhone, Greyson, Quiet Golf, Topo, and the rest of our rotation. Curator notes included.",
  },
  {
    id: "renewal",
    label: "Every quarter",
    headline: "The full Reserve Collection.",
    body: "From your second shipment onward, you receive the complete quarterly edit at the standard Reserve rate of $250 per quarter. Skip any quarter, adjust your profile any time.",
  },
];

/* ---------- FAQ definition -------------------------------------------- */

const FAQ: { q: string; a: string }[] = [
  {
    q: "How is Discovery different from Reserve Collection?",
    a: "Discovery ships a shorter first shipment focused on one hero piece and its accessories. Reserve Collection ships the full quarterly edit of four to six pieces from day one. Both continue as the same quarterly membership afterward.",
  },
  {
    q: "What happens after my first box?",
    a: "Every tier renews as the full Reserve Collection at $250 per quarter. You never re-select a tier; the first choice only determines what arrives on shipment one.",
  },
  {
    q: "Can I skip a quarter or cancel?",
    a: "Yes. You can skip any quarter from your dashboard, and you can cancel from your dashboard at any time before the next cycle.",
  },
  {
    q: "Who curates the box?",
    a: "Our editorial team, who play the game. Every shipment is built against your quiz answers by hand; nothing is auto-picked.",
  },
  {
    q: "Which brands are in the rotation?",
    a: "Rhone, Greyson, Quiet Golf, Topo, Feetures, Arnie's, Field Day, Harlestons, Hyperice, and a growing set of premium partners.",
  },
  {
    q: "How does shipping work?",
    a: "Free shipping on every quarterly shipment inside the US.",
  },
];

/* ---------- Component -------------------------------------------------- */

export default function DiscoverLPClient() {
  const [checkoutState, setCheckoutState] = useState<{
    tier: DiscoverTier | null;
    loading: boolean;
    error: string | null;
  }>({ tier: null, loading: false, error: null });

  useEffect(() => {
    captureAttributionFromUrl();
    trackEvent("lp_discover_view").catch(() => {});
  }, []);

  const startCheckout = useCallback(async (tier: TierConfig) => {
    setCheckoutState({ tier: tier.id, loading: true, error: null });
    trackEvent("lp_discover_tier_selected", {
      properties: { tier: tier.id },
    }).catch(() => {});
    try {
      await createMembershipCheckout("member", {
        discountCodes: tier.discountCode ? [tier.discountCode] : undefined,
        attributes: [
          { key: "discover_tier", value: tier.id },
          { key: "lp_source", value: "lp_discover" },
        ],
      });
      // createMembershipCheckout navigates the browser away; the state
      // below only matters if navigation fails silently.
      setCheckoutState({ tier: tier.id, loading: false, error: null });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again in a moment.";
      setCheckoutState({ tier: tier.id, loading: false, error: message });
    }
  }, []);

  const gridShots = useMemo(
    () =>
      [
        RECENT_BOX_PRODUCTS[0],
        RECENT_BOX_PRODUCTS[2],
        RECENT_BOX_PRODUCTS[4],
        RECENT_BOX_PRODUCTS[3],
      ].filter(Boolean),
    []
  );

  return (
    <div className="min-h-screen bg-white text-charcoal">
      <GlassHeader />

      {/* ============================== HERO ============================== */}
      <section className="pt-24 sm:pt-28 lg:pt-32 pb-14 md:pb-20">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 text-center">
          <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-5">
            Mully Reserve
          </div>
          <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl text-forest leading-[1.05]">
            Discover your first box.
          </h1>
          <p className="mt-5 text-base sm:text-lg text-charcoal/70 max-w-2xl mx-auto leading-relaxed">
            Three ways into one membership. Pick the shipment that fits how you
            want to start. Every choice becomes the same quarterly Reserve
            curation from the second box forward.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="#tiers"
              className="w-full sm:w-auto bg-ember hover:bg-ember/90 text-bone py-3.5 px-10 rounded-md text-sm font-medium tracking-wide transition cursor-pointer"
            >
              See the three boxes
            </a>
            <Link
              href="#how-it-works"
              className="text-sm underline text-charcoal/70 hover:text-charcoal transition"
            >
              How the membership works
            </Link>
          </div>
        </div>
      </section>

      {/* ============================ TIER CARDS ========================== */}
      <section id="tiers" className="pb-16 md:pb-24">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-10 sm:mb-14">
            <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
              Choose your entry
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl text-forest">
              Three first boxes, one membership.
            </h2>
            <p className="mt-4 text-sm text-charcoal/60 max-w-xl mx-auto leading-relaxed">
              Pricing shown is your first shipment only. Every tier renews as
              the full Reserve Collection at $250 per quarter.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TIERS.map((tier) => (
              <TierCard
                key={tier.id}
                tier={tier}
                loading={
                  checkoutState.loading && checkoutState.tier === tier.id
                }
                onSelect={() => startCheckout(tier)}
              />
            ))}
          </div>

          {checkoutState.error ? (
            <p className="mt-6 text-center text-sm text-ember">
              {checkoutState.error}
            </p>
          ) : null}

          <p className="mt-8 text-center text-xs text-charcoal/50 max-w-xl mx-auto leading-relaxed">
            Prices above are for your first shipment. From your second
            shipment forward, your Reserve membership continues at $250 per
            quarter as the full Reserve Collection. Skip or cancel any time
            before the next cycle.
          </p>
        </div>
      </section>

      {/* ========================== HOW IT WORKS ========================== */}
      <section id="how-it-works" className="bg-bone py-16 md:py-24">
        <div className="max-w-4xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-12 sm:mb-16">
            <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
              How Reserve works
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl text-forest">
              A quarterly rhythm, curated by hand.
            </h2>
          </div>
          <Timeline nodes={TIMELINE} />
        </div>
      </section>

      {/* ============================ WARDROBE ============================ */}
      <section className="py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-10 sm:mb-14">
            <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
              Recent shipments
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl text-forest">
              What our members opened this quarter.
            </h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {gridShots.map((product) => (
              <div
                key={product.title}
                className="aspect-[3/4] bg-bone-dark relative overflow-hidden"
              >
                <Image
                  src={product.image}
                  alt={`${product.vendor} ${product.title}`}
                  fill
                  sizes="(min-width: 768px) 22vw, 45vw"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =========================== CURATORS ============================ */}
      <section className="bg-bone py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-10 sm:mb-14">
            <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
              Meet the curators
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl text-forest">
              Editors who play the game.
            </h2>
          </div>
          <CuratorStrip />
        </div>
      </section>

      {/* ========================= MEMBER REVIEWS ========================
          Reuses the Junip Reserve Member widget already used on
          /lp/subscription. The junip script is loaded globally in
          layout.tsx and hydrates the matching product-review node. */}
      <section className="bg-white py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-10 sm:mb-12">
            <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
              Member reviews
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl text-forest">
              What members are saying
            </h2>
          </div>
          <span
            className="junip-product-review"
            data-product-id="8501257044160"
          />
        </div>
      </section>

      {/* ============================== FAQ =============================== */}
      <section className="bg-bone py-16 md:py-24">
        <div className="max-w-3xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-10 sm:mb-12">
            <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
              Questions
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl text-forest">
              Common questions, answered.
            </h2>
          </div>
          <div className="divide-y divide-forest/15 bg-white border border-forest/15 rounded-md">
            {FAQ.map((item) => (
              <FAQItem key={item.q} question={item.q} answer={item.a} />
            ))}
          </div>
        </div>
      </section>

      {/* ============================ FINAL CTA =========================== */}
      <section className="py-16 md:py-24">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 text-center">
          <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
            Ready when you are
          </div>
          <h2 className="font-serif text-3xl sm:text-4xl text-forest">
            Not sure which box is right?
          </h2>
          <p className="mt-4 text-sm sm:text-base text-charcoal/70 leading-relaxed">
            Take the two-minute style quiz. Our curators will suggest the entry
            that fits how you play and what you already own.
          </p>
          <div className="mt-8 flex justify-center">
            <QuizLauncher
              variant="primary-pill"
              label="Take the style quiz"
              source="lp_discover"
            />
          </div>
        </div>
      </section>

      {/* =========================== MOBILE STICKY ======================== */}
      <div
        data-lp-sticky
        className="fixed bottom-0 left-0 right-0 z-30 md:hidden bg-white/95 backdrop-blur border-t border-forest/15"
      >
        <div className="max-w-md mx-auto px-4 py-3">
          <a
            href="#tiers"
            className="block w-full text-center bg-ember hover:bg-ember/90 text-bone py-3 rounded-md text-sm font-medium tracking-wide transition"
          >
            See the three boxes
          </a>
        </div>
      </div>
    </div>
  );
}

/* ---------- Tier card ------------------------------------------------- */

function TierCard({
  tier,
  loading,
  onSelect,
}: {
  tier: TierConfig;
  loading: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={
        tier.emphasized
          ? "relative flex flex-col bg-white border border-forest/40 rounded-md p-6 sm:p-7 shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
          : "relative flex flex-col bg-white border border-forest/15 rounded-md p-6 sm:p-7"
      }
    >
      {tier.emphasized ? (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-forest text-bone text-[10px] tracking-[0.28em] uppercase px-3 py-1 rounded-sm">
          Most chosen
        </div>
      ) : null}
      <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-3">
        {tier.eyebrow}
      </div>
      <h3 className="font-serif text-2xl text-forest">{tier.title}</h3>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="font-serif text-4xl text-forest">
          {tier.firstBoxPrice}
        </span>
        <span className="text-xs text-charcoal/55">first box</span>
      </div>
      <p className="mt-5 text-sm text-charcoal/70 leading-relaxed">
        {tier.positioning}
      </p>
      <ul className="mt-5 space-y-2.5">
        {tier.contents.map((line) => (
          <li
            key={line}
            className="flex gap-2.5 text-sm text-charcoal/75 leading-relaxed"
          >
            <span aria-hidden className="text-forest/60 mt-1">
              &bull;
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 pt-5 border-t border-forest/10">
        <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-2">
          Best for
        </div>
        <p className="text-sm text-charcoal/70 leading-relaxed">
          {tier.bestFor}
        </p>
      </div>
      <button
        type="button"
        disabled={loading}
        onClick={onSelect}
        className={
          tier.emphasized
            ? "mt-6 w-full bg-ember hover:bg-ember/90 disabled:opacity-60 text-bone py-3.5 rounded-md text-sm font-medium tracking-wide transition cursor-pointer"
            : "mt-6 w-full bg-forest hover:bg-forest/90 disabled:opacity-60 text-bone py-3.5 rounded-md text-sm font-medium tracking-wide transition cursor-pointer"
        }
      >
        {loading ? "Loading…" : tier.ctaLabel}
      </button>
      <p className="mt-3 text-[11px] text-charcoal/50 leading-relaxed text-center">
        Renews at $250 per quarter as the full Reserve Collection.
      </p>
    </div>
  );
}

/* ---------- Timeline -------------------------------------------------- */

function Timeline({ nodes }: { nodes: TimelineNode[] }) {
  const [expanded, setExpanded] = useState<string | null>(nodes[0]?.id ?? null);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = prev === id ? null : id;
      if (next) {
        trackEvent("lp_discover_timeline_interacted", {
          properties: { node: next },
        }).catch(() => {});
      }
      return next;
    });
  }, []);

  return (
    <div className="border-l border-forest/20 pl-6 sm:pl-8 space-y-6">
      {nodes.map((node) => {
        const open = expanded === node.id;
        return (
          <div key={node.id} className="relative">
            <span
              aria-hidden
              className="absolute -left-[33px] sm:-left-[41px] top-1 w-3 h-3 rounded-full bg-forest"
            />
            <button
              type="button"
              onClick={() => toggle(node.id)}
              className="text-left w-full cursor-pointer group"
              aria-expanded={open}
            >
              <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60">
                {node.label}
              </div>
              <div className="mt-1 font-serif text-lg sm:text-xl text-forest group-hover:text-forest/80 transition-colors">
                {node.headline}
              </div>
            </button>
            {open ? (
              <p className="mt-2 text-sm text-charcoal/70 leading-relaxed max-w-xl animate-fade-up">
                {node.body}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- FAQ item -------------------------------------------------- */

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left cursor-pointer group"
        aria-expanded={open}
      >
        <span className="text-sm font-medium text-obsidian group-hover:text-forest transition-colors duration-300">
          {question}
        </span>
        <svg
          className={`w-4 h-4 text-charcoal/30 shrink-0 transition-transform duration-300 ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 8.25l-7.5 7.5-7.5-7.5"
          />
        </svg>
      </button>
      {open ? (
        <div className="px-5 pb-4 animate-fade-up">
          <p className="text-sm text-charcoal/55 leading-relaxed">{answer}</p>
        </div>
      ) : null}
    </div>
  );
}
