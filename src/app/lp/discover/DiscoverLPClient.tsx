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
  /**
   * Flat-lay hero for the tier card and the What's Inside section. When
   * `image` is undefined we render a PlaceholderFrame with the shot
   * direction copy in `imageNote`. Populate `image` once the final
   * photograph is delivered.
   */
  image?: string;
  imageNote: string;
  itemLabels: { category: string; brandTier: string; season: string }[];
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
    imageNote:
      "FLAT LAY, 2 PIECES. Forest green paper background. Overhead 90 degree. One folded polo or 1/4 zip + one accessory (belt or headwear) + Mully hangtag. Minimal negative space, single soft key light from upper-left.",
    itemLabels: [
      { category: "Layer", brandTier: "Premium", season: "Fall" },
      { category: "Accessory", brandTier: "Core", season: "Fall" },
    ],
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
    imageNote:
      "FLAT LAY, 3 to 4 PIECES. Same forest background, same 90 degree overhead, same lighting as Discovery. One layer + one polo + one bottom or accessory + Mully box lid corner in frame. Visibly denser than Discovery, still styled.",
    itemLabels: [
      { category: "Layer", brandTier: "Premium", season: "Fall" },
      { category: "Polo", brandTier: "Premium", season: "Fall" },
      { category: "Accessory", brandTier: "Core", season: "Fall" },
    ],
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
    imageNote:
      "FLAT LAY, 5 to 6 PIECES. Same forest background, same 90 degree overhead, same lighting. Two layers + one polo + one bottom + two accessories + open Mully box in frame. Visibly the fullest of the three. This photo must read as the most product per square inch.",
    itemLabels: [
      { category: "Layer", brandTier: "Premium", season: "Fall" },
      { category: "Layer", brandTier: "Premium", season: "Fall" },
      { category: "Polo", brandTier: "Premium", season: "Fall" },
      { category: "Bottom", brandTier: "Premium", season: "Fall" },
      { category: "Accessory", brandTier: "Core", season: "Fall" },
      { category: "Accessory", brandTier: "Core", season: "Fall" },
    ],
  },
];

/* ---------- Hero + unboxing imagery ---------------------------------- */

/**
 * The hero uses the existing Reserve Collection styled flat-lay on the
 * forest background. Landscape crop on desktop, portrait crop on mobile.
 */
const HERO_LANDSCAPE = "/lp/hero/hero-landscape-4x3.webp";
const HERO_PORTRAIT = "/lp/hero/hero-portrait-4x5.webp";

/**
 * The unboxing photo uses the existing closed branded box on white. Once a
 * shot with tissue + insert card is delivered, swap this constant.
 */
const UNBOXING_IMAGE = "/consult-hero-box.jpg";
const UNBOXING_NOTE =
  "Replace with a 4:3 landscape shot of the closed Mully box on bone paper, tissue folded to one side, insert card angled forward, high three-quarter camera, one soft key from upper-right. Same bone-white paper background as the current placeholder so the swap is one-line.";

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

  return (
    <div className="min-h-screen bg-white text-charcoal">
      <GlassHeader />

      {/* ================================ HERO =============================== */}
      {/* Full-bleed styled flat-lay of the Reserve Collection on the forest
          background. Desktop: photo left, copy right. Mobile: photo top,
          copy below. This is intentionally the first frame a visitor sees. */}
      <section className="pt-20 sm:pt-24 lg:pt-28 pb-14 md:pb-20">
        <div className="max-w-7xl mx-auto px-5 sm:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-14 items-center">
            {/* Photo. Two <Image> tags so we can crop tighter on mobile via
                CSS. The landscape asset is the default; the portrait asset
                takes over below 640px for a tighter framing on phones. */}
            <div className="relative w-full aspect-[4/5] sm:aspect-[4/3] bg-forest rounded-md overflow-hidden order-first">
              <Image
                src={HERO_PORTRAIT}
                alt=""
                fill
                priority
                sizes="100vw"
                className="object-cover sm:hidden"
              />
              <Image
                src={HERO_LANDSCAPE}
                alt="An open Mully Reserve Collection box surrounded by folded apparel, a leather accessory, and a Perficio golf-shoe bag, all styled on a forest-green backdrop."
                fill
                priority
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover hidden sm:block"
              />
            </div>

            {/* Copy */}
            <div className="text-center lg:text-left">
              <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
                Mully Reserve
              </div>
              <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl text-forest leading-[1.05]">
                Discover your first box.
              </h1>
              <p className="mt-5 text-base sm:text-lg text-charcoal/75 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                Three ways into one membership. Pick your first shipment.
                Every box after renews as the full Reserve Collection at{" "}
                <span className="font-medium text-forest">
                  $250 per quarter
                </span>
                .
              </p>
              <div className="mt-8 flex flex-col sm:flex-row items-center lg:items-start justify-center lg:justify-start gap-3">
                <a
                  href="#tiers"
                  className="w-full sm:w-auto bg-forest hover:bg-forest/90 text-bone py-3.5 px-10 rounded-md text-sm font-medium tracking-wide transition cursor-pointer text-center"
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

      {/* ============================ WHAT'S INSIDE ==========================
          Reinstated. Three large flat lays side by side. The visual density
          delta is the argument, so the photos are the primary content and
          the labels are supporting. */}
      <section id="whats-inside" className="py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-10 sm:mb-14">
            <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
              What&rsquo;s inside
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl text-forest">
              See the three boxes side by side.
            </h2>
            <p className="mt-4 text-sm sm:text-base text-charcoal/70 max-w-2xl mx-auto leading-relaxed">
              Same photographer, same background, same lighting, same angle.
              The difference you see is the difference you get.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {TIERS.map((tier) => (
              <TierFlatlayCard key={tier.id} tier={tier} />
            ))}
          </div>
        </div>
      </section>

      {/* ============================ UNBOXING MOMENT =========================
          One frame of the closed branded box + tissue + insert card.
          Currently uses the existing closed-box photo on white; replace
          with the styled shot per UNBOXING_NOTE when it lands. */}
      <section className="bg-bone py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-5 sm:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-14 items-center">
            <div className="lg:col-span-3 relative aspect-[4/3] w-full bg-white rounded-md overflow-hidden border border-forest/10">
              <Image
                src={UNBOXING_IMAGE}
                alt="The closed forest-green Mully Reserve box, embossed logo forward, shot on a neutral bone-white paper background."
                fill
                sizes="(min-width: 1024px) 60vw, 100vw"
                className="object-contain p-6 sm:p-10"
              />
              <div
                className="absolute bottom-3 right-3 text-[10px] tracking-[0.24em] uppercase text-forest/50 bg-white/85 backdrop-blur px-2 py-1 rounded"
                title={UNBOXING_NOTE}
              >
                Placeholder shot
              </div>
            </div>
            <div className="lg:col-span-2">
              <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
                The unboxing
              </div>
              <h2 className="font-serif text-3xl sm:text-4xl text-forest leading-[1.1]">
                Built for the moment you open it.
              </h2>
              <p className="mt-5 text-sm sm:text-base text-charcoal/75 leading-relaxed">
                Rigid magnetic box, tissue-wrapped pieces, an insert card
                that names every item and why it was picked for you. The
                packaging is part of the product.
              </p>
            </div>
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

/* ---------- Placeholder frame ----------------------------------------
 * Renders a real photo if `src` is provided; otherwise renders a
 * correctly-proportioned frame containing the shot direction so the
 * layout is production-shaped and can accept a final image with zero
 * layout rework.
 */

function PlaceholderFrame({
  src,
  alt,
  note,
  aspect = "aspect-square",
  bg = "bg-forest",
  sizes,
  variant = "dense",
}: {
  src?: string;
  alt: string;
  note: string;
  aspect?: string;
  bg?: string;
  sizes: string;
  /** "dense" for tier cards, "large" for the What's Inside section. */
  variant?: "dense" | "large";
}) {
  if (src) {
    return (
      <div className={`relative w-full ${aspect} ${bg} overflow-hidden`}>
        <Image src={src} alt={alt} fill sizes={sizes} className="object-cover" />
      </div>
    );
  }
  return (
    <div
      className={`relative w-full ${aspect} ${bg} overflow-hidden`}
      role="img"
      aria-label={alt}
    >
      {/* Corner tag */}
      <div className="absolute top-3 left-3 text-[9px] tracking-[0.28em] uppercase text-bone/80 border border-bone/40 px-2 py-1 rounded-sm bg-forest/40">
        Photo placeholder
      </div>
      {/* Camera icon */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-4 sm:px-6 text-center text-bone">
        <svg
          viewBox="0 0 24 24"
          className={variant === "large" ? "w-10 h-10 mb-4 opacity-60" : "w-7 h-7 mb-3 opacity-60"}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.174-1.26.207-2.152 1.31-2.152 2.586v10.503a2.25 2.25 0 002.25 2.25h15.75a2.25 2.25 0 002.25-2.25V9.99c0-1.276-.891-2.379-2.152-2.586a44.63 44.63 0 00-1.134-.174 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"
          />
        </svg>
        <p
          className={
            variant === "large"
              ? "text-[11px] sm:text-xs leading-relaxed text-bone/90 max-w-md"
              : "text-[10px] sm:text-[11px] leading-relaxed text-bone/85 max-w-[22ch] sm:max-w-[26ch]"
          }
        >
          {note}
        </p>
      </div>
    </div>
  );
}

/* ---------- Tier card ------------------------------------------------- */

/**
 * Alignment strategy: the card is a flex column. Every text row that can
 * vary in height across tiers gets a `min-h` slot sized to the worst-case
 * content. That guarantees the price row of every card sits on the same
 * baseline, ditto positioning, ditto renewal line, ditto BEST FOR block,
 * ditto CTA. The image slot is a fixed aspect ratio so the top edges of
 * every card align regardless of tier.
 */
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
          ? "relative flex flex-col bg-white border-2 border-forest rounded-md overflow-hidden shadow-[0_8px_24px_-12px_rgba(20,45,30,0.25)] "
          : "relative flex flex-col bg-white border border-forest/20 rounded-md overflow-hidden ") +
        (selected ? " ring-2 ring-forest/40 ring-offset-2" : "")
      }
    >
      {isEmphasized ? (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-forest text-bone text-[10px] tracking-[0.28em] uppercase px-3 py-1 rounded-sm shadow-sm">
          Most chosen
        </div>
      ) : null}

      {/* Image slot: fixed aspect ratio, identical across all three cards */}
      <PlaceholderFrame
        src={tier.image}
        alt={`${tier.title} first-box contents flat lay.`}
        note={tier.imageNote}
        aspect="aspect-[4/3]"
        bg="bg-forest"
        sizes="(min-width: 768px) 32vw, 92vw"
        variant="dense"
      />

      {/* Card body */}
      <div className="flex flex-col flex-1 p-6 sm:p-7">
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

        {/* Positioning: 3-line slot on md+, natural on mobile */}
        <p className="mt-4 text-sm text-charcoal/75 leading-relaxed md:min-h-[4.5rem]">
          {tier.positioning}
        </p>

        {/* Bullets: 3-item slot on md+, natural on mobile */}
        <ul className="mt-4 space-y-2 text-sm text-charcoal/80 leading-relaxed md:min-h-[6.75rem]">
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
        <p className="mt-5 text-sm text-forest leading-relaxed font-medium md:min-h-[2.75rem]">
          Renews at $250 per quarter as the full Reserve Collection. Skip or
          cancel any time.
        </p>

        {/* BEST FOR block: identical slot height across tiers */}
        <div className="mt-5 pt-5 border-t border-forest/10">
          <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-2">
            Best for
          </div>
          <p className="text-sm text-charcoal/70 leading-relaxed md:min-h-[2.75rem]">
            {tier.bestFor}
          </p>
        </div>

        {/* Spacer to push CTA to the bottom on md+ */}
        <div className="flex-1" />

        <button
          type="button"
          onClick={onSelect}
          className="mt-6 w-full bg-forest hover:bg-forest/90 text-bone py-3.5 rounded-md text-sm font-medium tracking-wide transition cursor-pointer"
        >
          {tier.ctaLabel}
        </button>
      </div>
    </div>
  );
}

/* ---------- Tier flat lay card (What's Inside section) ---------------- */

function TierFlatlayCard({ tier }: { tier: TierConfig }) {
  return (
    <figure className="flex flex-col">
      <PlaceholderFrame
        src={tier.image}
        alt={`${tier.title} flat lay showing every included piece.`}
        note={tier.imageNote}
        aspect="aspect-square"
        bg="bg-forest"
        sizes="(min-width: 768px) 32vw, 92vw"
        variant="large"
      />
      <figcaption className="mt-5 flex flex-col flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-serif text-xl text-forest">{tier.title}</h3>
          <span className="text-[10px] tracking-[0.28em] uppercase text-forest/60">
            {tier.itemLabels.length} pieces
          </span>
        </div>
        <ul className="mt-4 space-y-1.5 text-sm text-charcoal/80 md:min-h-[9rem]">
          {tier.itemLabels.map((item, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 border-b border-forest/10 py-1.5">
              <span className="text-charcoal/85">{item.category}</span>
              <span className="text-[10px] tracking-[0.22em] uppercase text-forest/60">
                {item.brandTier} · {item.season}
              </span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
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
