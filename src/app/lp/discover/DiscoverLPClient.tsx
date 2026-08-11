"use client";

/**
 * Mully Reserve /lp/discover landing page.
 *
 * Three-tier acquisition page. Every tier is the FIRST BOX of the same
 * Reserve membership; renewals cycle at the full quarterly rate.
 *
 * FLOW (rebuilt 2026-08-11 after review):
 *   1. User taps a tier CTA.
 *   2. We stash the tier in localStorage under `mully_discover_tier`,
 *      fire lp_discover_tier_selected, and open the same QuizModal used
 *      by /lp/subscription (source: "lp_discover").
 *   3. Quiz completes and routes to /lp/reserve/reveal/{profileId} as
 *      normal.
 *   4. ReserveCheckoutCTA on the reveal page reads the stashed tier and
 *      applies the matching Shopify discount code + `discover_tier` cart
 *      attribute + visible "First Box Edition" line-item property. The
 *      orders-paid webhook then adds a `discover-tier-<tier>` order tag
 *      and prepends a pick-ticket note.
 *
 * COPY RULES (verified, do not violate):
 *   - No em-dashes anywhere on the page. Use periods or commas.
 *   - The words cheap / discount / deal / save must not appear.
 *   - No percent-off framing.
 *   - Lower tiers described by contents and experience, not price.
 *   - Voice: confident, factual, private-club register.
 */

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { GlassHeader } from "@/app/components/ClientComponents";
import { captureAttributionFromUrl } from "@/lib/attribution";
import { trackEvent } from "@/lib/tracking";
import { QuizModal } from "../_shared/QuizModal";
import { RECENT_BOX_PRODUCTS } from "../_shared/products";

/* ---------- Types + tiers --------------------------------------------- */

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
  emphasized?: boolean;
}

const TIERS: TierConfig[] = [
  {
    id: "discovery",
    eyebrow: "Introductory box",
    title: "Discovery",
    firstBoxPrice: "$50",
    positioning:
      "One hero piece and the accessories that finish it. A shorter first shipment for members trying the format.",
    contents: [
      "One layer or polo chosen for your climate and fit",
      "One accessory pairing (belt, socks, or headwear)",
      "Curator notes on how to wear it on and off the course",
    ],
    bestFor: "Curious members who want a low-commitment way in.",
    ctaLabel: "Start with Discovery",
  },
  {
    id: "signature",
    eyebrow: "Enhanced box",
    title: "Signature Preview",
    firstBoxPrice: "$125",
    positioning:
      "Two or three pieces styled to layer into a full outfit for your next round.",
    contents: [
      "Two apparel pieces styled to layer together",
      "One accessory pairing to complete the look",
      "Curator notes and care guidance",
    ],
    bestFor: "Members ready for a real outfit out of the gate.",
    ctaLabel: "Start with Signature Preview",
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
    bestFor: "Members who want the full edit on arrival.",
    ctaLabel: "Start with Reserve Collection",
  },
];

/* ---------- FAQ ------------------------------------------------------- */

const FAQ: { q: string; a: string }[] = [
  {
    q: "How is Discovery different from Reserve Collection?",
    a: "Discovery ships a shorter first box built around one hero piece. Reserve Collection ships the full quarterly edit of four to six pieces on day one.",
  },
  {
    q: "What happens after my first box?",
    a: "Every membership renews as the full Reserve Collection at $250 per quarter. Your first-box choice only determines what arrives on shipment one.",
  },
  {
    q: "Can I skip a quarter or cancel?",
    a: "Yes. Skip any quarter from your dashboard, or cancel any time before the next cycle.",
  },
  {
    q: "Who curates the box?",
    a: "Our editorial team, who play the game. Every shipment is built against your quiz answers by hand.",
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

const DISCOVER_TIER_STORAGE_KEY = "mully_discover_tier";

/* ---------- Component -------------------------------------------------- */

export default function DiscoverLPClient() {
  const [selectedTier, setSelectedTier] = useState<DiscoverTier | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [showStickyCTA, setShowStickyCTA] = useState(false);

  useEffect(() => {
    captureAttributionFromUrl();
    trackEvent("lp_discover_view").catch(() => {});
  }, []);

  // Sticky mobile CTA appears after user scrolls past the tier cards.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const tierEl = document.getElementById("tiers");
    if (!tierEl) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Once the tier grid's bottom leaves the viewport upward, show
          // the sticky. When it returns into view, hide it.
          setShowStickyCTA(!entry.isIntersecting && entry.boundingClientRect.top < 0);
        }
      },
      { threshold: 0, rootMargin: "0px" }
    );
    io.observe(tierEl);
    return () => io.disconnect();
  }, []);

  // Body-scroll lock + hide the sticky footer while the quiz modal is open.
  useEffect(() => {
    if (!quizOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.setAttribute("data-consult-open", "true");
    return () => {
      document.body.style.overflow = prev;
      document.documentElement.removeAttribute("data-consult-open");
    };
  }, [quizOpen]);

  const startTierFlow = useCallback((tier: TierConfig) => {
    setSelectedTier(tier.id);
    try {
      window.localStorage.setItem(DISCOVER_TIER_STORAGE_KEY, tier.id);
    } catch {
      // localStorage may be unavailable in private mode; the reveal CTA
      // gracefully falls back to no-tier behavior.
    }
    trackEvent("lp_discover_tier_selected", {
      properties: { tier: tier.id },
    }).catch(() => {});
    // quiz_started fires here (mirroring QuizLauncher's behavior) so the
    // funnel from tier selection → quiz start → completion is unbroken.
    trackEvent(
      "quiz_started",
      { properties: { source: "lp_discover", tier: tier.id } },
      { includeAuth: false }
    ).catch(() => {});
    setQuizOpen(true);
  }, []);

  const onStickyCTA = useCallback(() => {
    trackEvent("lp_discover_sticky_cta_tapped").catch(() => {});
    const el = document.getElementById("tiers");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
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

      {/* ================================ HERO =============================== */}
      <section className="pt-24 sm:pt-28 lg:pt-32 pb-14 md:pb-20">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 text-center">
          <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-5">
            Mully Reserve
          </div>
          <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl text-forest leading-[1.05]">
            Discover your first box.
          </h1>
          <p className="mt-5 text-base sm:text-lg text-charcoal/75 max-w-2xl mx-auto leading-relaxed">
            Three ways into one membership. Pick your first shipment. Every
            box after renews as the full Reserve Collection at{" "}
            <span className="font-medium text-forest">$250 per quarter</span>.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="#tiers"
              className="w-full sm:w-auto bg-forest hover:bg-forest/90 text-bone py-3.5 px-10 rounded-md text-sm font-medium tracking-wide transition cursor-pointer"
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

      {/* =============================== TIER CARDS ========================== */}
      <section id="tiers" className="pb-10 md:pb-14">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-10 sm:mb-14">
            <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
              Choose your first box
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl text-forest">
              One membership. Three ways in.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TIERS.map((tier) => (
              <TierCard
                key={tier.id}
                tier={tier}
                selected={selectedTier === tier.id}
                onSelect={() => startTierFlow(tier)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ============================ TRUST STRIP ============================ */}
      <TrustStrip />

      {/* ============================= TIMELINE ============================== */}
      <section id="how-it-works" className="bg-bone py-16 md:py-24">
        <div className="max-w-5xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-10 sm:mb-14">
            <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
              How Reserve works
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl text-forest">
              A quarterly rhythm, priced up front.
            </h2>
          </div>
          <Timeline selectedTier={selectedTier} />
        </div>
      </section>

      {/* ============================== WARDROBE ============================= */}
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
              <figure key={product.title} className="text-left">
                <div className="aspect-[3/4] bg-bone relative overflow-hidden">
                  <Image
                    src={product.image}
                    alt={`${product.vendor} ${product.title}`}
                    fill
                    sizes="(min-width: 768px) 22vw, 45vw"
                    className="object-cover"
                  />
                </div>
                <figcaption className="mt-2 text-[11px] text-charcoal/60 leading-snug">
                  <span className="uppercase tracking-[0.14em] text-forest/70">
                    {product.vendor}
                  </span>
                  <span className="text-charcoal/40"> / </span>
                  <span>{product.title}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ MEMBER REVIEWS ==========================
          Reuses the same Junip Reserve Member widget from /lp/subscription.
          Star color and photo-first sort are controlled via the
          .junip-review CSS overrides in globals.css (added in this pass).
      ============================================================== */}
      <section className="bg-bone py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-10 sm:mb-12">
            <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
              Member reviews
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl text-forest">
              What members say.
            </h2>
          </div>
          <div className="junip-discover-scope">
            <span
              className="junip-product-review"
              data-product-id="8501257044160"
            />
          </div>
        </div>
      </section>

      {/* ================================ FAQ ================================ */}
      <section className="bg-white py-16 md:py-24">
        <div className="max-w-3xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-10 sm:mb-12">
            <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
              Questions
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl text-forest">
              Common questions.
            </h2>
          </div>
          <div className="divide-y divide-forest/15 bg-bone border border-forest/15 rounded-md">
            {FAQ.map((item) => (
              <FAQItem key={item.q} question={item.q} answer={item.a} />
            ))}
          </div>
        </div>
      </section>

      {/* ============================= FINAL CTA ============================= */}
      <section className="bg-bone py-16 md:py-24">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 text-center">
          <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
            Ready when you are
          </div>
          <h2 className="font-serif text-3xl sm:text-4xl text-forest">
            Not sure which box is right?
          </h2>
          <p className="mt-4 text-sm sm:text-base text-charcoal/75 leading-relaxed">
            Take the two-minute style quiz. Our curators recommend the entry
            that fits how you play.
          </p>
          <div className="mt-8 flex justify-center">
            <button
              type="button"
              onClick={() =>
                startTierFlow(TIERS.find((t) => t.emphasized) ?? TIERS[1])
              }
              className="bg-forest hover:bg-forest/90 text-bone py-3.5 px-10 rounded-md text-sm font-medium tracking-wide transition cursor-pointer"
            >
              Take the style quiz
            </button>
          </div>
        </div>
      </section>

      {/* ============================ MOBILE STICKY ==========================
          Appears once the user scrolls past the tier cards. Hidden while
          the quiz modal is open (via [data-consult-open="true"] rule in
          globals.css).
      ============================================================== */}
      {showStickyCTA ? (
        <div
          data-lp-sticky
          className="fixed bottom-0 left-0 right-0 z-30 md:hidden bg-white/95 backdrop-blur border-t border-forest/15 animate-fade-up"
        >
          <div className="max-w-md mx-auto px-4 py-3">
            <button
              type="button"
              onClick={onStickyCTA}
              className="block w-full text-center bg-forest hover:bg-forest/90 text-bone py-3 rounded-md text-sm font-medium tracking-wide transition"
            >
              Choose your box
            </button>
          </div>
        </div>
      ) : null}

      {/* Quiz modal, portaled to body so mobile fixed positioning escapes
          the stacking context of the sticky footer. */}
      {quizOpen ? (
        <QuizPortal onClose={() => setQuizOpen(false)} />
      ) : null}
    </div>
  );
}

/* ---------- Quiz portal wrapper --------------------------------------- */

function QuizPortal({ onClose }: { onClose: () => void }) {
  // Client-only component. QuizPortal is only rendered when the tier CTA
  // is clicked (quizOpen === true), which cannot happen during SSR, so
  // document.body is guaranteed to exist by the time this runs.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto bg-white">
      <QuizModal source="lp_discover" onClose={onClose} />
    </div>,
    document.body
  );
}

/* ---------- Tier card ------------------------------------------------- */

function TierCard({
  tier,
  selected,
  onSelect,
}: {
  tier: TierConfig;
  selected: boolean;
  onSelect: () => void;
}) {
  const isEmphasized = !!tier.emphasized;
  return (
    <div
      className={
        (isEmphasized
          ? "relative flex flex-col bg-white border-2 border-forest rounded-md p-6 sm:p-7 shadow-[0_8px_24px_-12px_rgba(20,45,30,0.25)] "
          : "relative flex flex-col bg-white border border-forest/20 rounded-md p-6 sm:p-7 ") +
        (selected ? " ring-2 ring-forest/40 ring-offset-2" : "")
      }
    >
      {isEmphasized ? (
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
        <span className="text-xs text-charcoal/60">first box</span>
      </div>
      <p className="mt-4 text-sm text-charcoal/75 leading-relaxed">
        {tier.positioning}
      </p>
      <ul className="mt-4 space-y-2 text-sm text-charcoal/80 leading-relaxed">
        {tier.contents.map((line) => (
          <li key={line} className="flex gap-2.5">
            <span aria-hidden className="text-forest/60 mt-1">
              &bull;
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>

      {/* Renewal transparency, full body size, directly under contents. */}
      <p className="mt-5 text-sm text-forest leading-relaxed font-medium">
        Renews at $250 per quarter as the full Reserve Collection. Skip or
        cancel any time.
      </p>

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
        onClick={onSelect}
        className="mt-6 w-full bg-forest hover:bg-forest/90 text-bone py-3.5 rounded-md text-sm font-medium tracking-wide transition cursor-pointer"
      >
        {tier.ctaLabel}
      </button>
    </div>
  );
}

/* ---------- Trust strip ----------------------------------------------- */

function TrustStrip() {
  const items = [
    {
      icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6h9.75a2.25 2.25 0 012.25 2.25v9m-12 0h13.5m-13.5 0a1.5 1.5 0 01-1.5-1.5V6.75m1.5 10.5a1.5 1.5 0 001.5-1.5v-.75m15-8.25v9a1.5 1.5 0 01-1.5 1.5m1.5-10.5h-4.5a2.25 2.25 0 00-2.25 2.25v.75m6.75-3l-3-3m3 3l-3 3" />
        </svg>
      ),
      label: "Free US shipping on every box",
    },
    {
      icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m4-2a8 8 0 11-16 0 8 8 0 0116 0z" />
        </svg>
      ),
      label: "Skip or cancel any time before ship",
    },
    {
      icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.25a7.5 7.5 0 0115 0" />
        </svg>
      ),
      label: "Curated by humans who play the game",
    },
  ];
  return (
    <div className="border-y border-forest/15 bg-white">
      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-4">
        <ul className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-6 text-xs sm:text-sm text-charcoal/80">
          {items.map((item) => (
            <li key={item.label} className="flex items-center gap-2 text-forest/80">
              {item.icon}
              <span className="text-charcoal/75">{item.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ---------- Timeline (horizontal desktop, vertical stepper mobile) ---- */

function Timeline({ selectedTier }: { selectedTier: DiscoverTier | null }) {
  const today = useMemo(() => new Date(), []);
  const tierMeta = useMemo(() => {
    const active = TIERS.find((t) => t.id === selectedTier);
    return {
      label: active?.title ?? "Your selected tier",
      price: active?.firstBoxPrice ?? "Pick a tier",
    };
  }, [selectedTier]);

  const nodes = useMemo(() => {
    const fmt = (d: Date) =>
      d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    const plus = (days: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() + days);
      return d;
    };
    return [
      {
        boxLabel: "Box 1",
        date: fmt(today),
        title: tierMeta.label,
        price: tierMeta.price,
        highlight: true,
      },
      {
        boxLabel: "Box 2",
        date: fmt(plus(90)),
        title: "Reserve Collection",
        price: "$250",
        highlight: false,
      },
      {
        boxLabel: "Box 3",
        date: fmt(plus(180)),
        title: "Reserve Collection",
        price: "$250",
        highlight: false,
      },
      {
        boxLabel: "Box 4",
        date: fmt(plus(270)),
        title: "Reserve Collection",
        price: "$250",
        highlight: false,
      },
    ];
  }, [today, tierMeta]);

  const onNodeClick = useCallback((boxLabel: string) => {
    trackEvent("lp_discover_timeline_interacted", {
      properties: { node: boxLabel.toLowerCase().replace(" ", "_") },
    }).catch(() => {});
  }, []);

  return (
    <div>
      {/* Desktop: horizontal 4-node row */}
      <div className="hidden md:block">
        <div className="relative">
          {/* Connector line */}
          <div
            aria-hidden
            className="absolute top-5 left-8 right-8 h-px bg-forest/25"
          />
          <ol className="grid grid-cols-4 gap-4 relative">
            {nodes.map((node) => (
              <li
                key={node.boxLabel}
                className="flex flex-col items-center text-center"
                onClick={() => onNodeClick(node.boxLabel)}
              >
                <span
                  aria-hidden
                  className={
                    node.highlight
                      ? "w-10 h-10 rounded-full bg-forest text-bone flex items-center justify-center text-[11px] font-medium border-2 border-forest ring-4 ring-white"
                      : "w-10 h-10 rounded-full bg-white text-forest flex items-center justify-center text-[11px] font-medium border-2 border-forest/30 ring-4 ring-bone"
                  }
                >
                  {node.boxLabel.replace("Box ", "")}
                </span>
                <div className="mt-4 text-[10px] tracking-[0.28em] uppercase text-forest/60">
                  {node.date}
                </div>
                <div
                  className={
                    node.highlight
                      ? "mt-1 font-serif text-lg text-forest"
                      : "mt-1 font-serif text-lg text-charcoal/85"
                  }
                >
                  {node.title}
                </div>
                <div
                  className={
                    node.highlight
                      ? "mt-1 text-sm font-medium text-forest"
                      : "mt-1 text-sm text-charcoal/70"
                  }
                >
                  {node.price}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* Mobile: vertical stepper */}
      <ol className="md:hidden border-l border-forest/25 pl-6 space-y-6">
        {nodes.map((node) => (
          <li
            key={node.boxLabel}
            className="relative"
            onClick={() => onNodeClick(node.boxLabel)}
          >
            <span
              aria-hidden
              className={
                node.highlight
                  ? "absolute -left-[33px] top-1 w-4 h-4 rounded-full bg-forest border-2 border-bone"
                  : "absolute -left-[31px] top-1.5 w-3 h-3 rounded-full bg-white border-2 border-forest/40"
              }
            />
            <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60">
              {node.boxLabel} &middot; {node.date}
            </div>
            <div
              className={
                node.highlight
                  ? "mt-1 font-serif text-lg text-forest"
                  : "mt-1 font-serif text-lg text-charcoal/85"
              }
            >
              {node.title}
            </div>
            <div
              className={
                node.highlight
                  ? "mt-0.5 text-sm font-medium text-forest"
                  : "mt-0.5 text-sm text-charcoal/70"
              }
            >
              {node.price}
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-8 text-center text-xs text-charcoal/55 max-w-lg mx-auto leading-relaxed">
        Every membership renews as the full Reserve Collection at $250 per
        quarter. Your first-box choice does not change the renewal price.
      </p>
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
        <span className="text-sm font-medium text-forest group-hover:text-forest/80 transition-colors">
          {question}
        </span>
        <svg
          className={`w-4 h-4 text-charcoal/40 shrink-0 transition-transform duration-300 ${
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
          <p className="text-sm text-charcoal/70 leading-relaxed">{answer}</p>
        </div>
      ) : null}
    </div>
  );
}
