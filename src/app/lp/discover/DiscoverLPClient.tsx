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
  bestFor: string;
  ctaLabel: string;
  emphasized?: boolean;
  /**
   * Curation-framed body copy (Round 3). Replaces the earlier bulleted
   * contents list. Every tier reads as a single confident paragraph. Do
   * not reintroduce item counts or category tables anywhere on the page.
   */
  bodyCopy: string;
  /** Curation-framed column copy for the "difference is the edit" section. */
  editCopy: string;
  /**
   * Flat-lay hero for the tier card and the What's Inside section. When
   * `image` is undefined we render a PlaceholderFrame with the shot
   * direction copy in `imageNote`. Populate `image` once the final
   * photograph is delivered.
   */
  image?: string;
  imageNote: string;
}

const TIERS: TierConfig[] = [
  {
    id: "discovery",
    eyebrow: "Introductory box",
    title: "Discovery",
    firstBoxPrice: "$50",
    positioning:
      "One hero piece and the accessories that finish it. A shorter first shipment for members trying the format.",
    bodyCopy:
      "One hero piece and the accessories that finish it. A first look at how Mully curates.",
    editCopy:
      "A taste. One piece we believe in, finished with the right accessories.",
    bestFor: "Curious members who want a low-commitment way in.",
    ctaLabel: "Start with Discovery",
    imageNote:
      "FLAT LAY, 2 PIECES. Forest green paper background. Overhead 90 degree. One folded polo or 1/4 zip + one accessory (belt or headwear) + Mully hangtag. Minimal negative space, single soft key light from upper-left.",
  },
  {
    id: "signature",
    eyebrow: "Enhanced box",
    title: "Signature Preview",
    firstBoxPrice: "$125",
    positioning:
      "Two or three pieces styled to layer into a full outfit for your next round.",
    bodyCopy:
      "A styled pairing built to leave the house together. Apparel and accessories, chosen as one look.",
    editCopy:
      "A look. Pieces selected to work together, not just arrive together.",
    bestFor: "Members ready for a real outfit out of the gate.",
    ctaLabel: "Start with Signature Preview",
    emphasized: true,
    imageNote:
      "FLAT LAY, 3 to 4 PIECES. Same forest background, same 90 degree overhead, same lighting as Discovery. One layer + one polo + one bottom or accessory + Mully box lid corner in frame. Visibly denser than Discovery, still styled.",
  },
  {
    id: "reserve",
    eyebrow: "Full first box",
    title: "Reserve Collection",
    firstBoxPrice: "$250",
    positioning:
      "The complete quarterly edit from day one. Four to six hand-picked pieces valued well above the membership rate.",
    bodyCopy:
      "The full quarterly edit. A complete seasonal kit of apparel, headwear, and accessories, picked for how and where you play.",
    editCopy:
      "The kit. Everything we would pull for your quarter, styled as one edit. Retail value clears the membership price, but the point is that you did not have to choose any of it.",
    bestFor: "Members who want the full edit on arrival.",
    ctaLabel: "Start with Reserve Collection",
    imageNote:
      "FLAT LAY, 5 to 6 PIECES. Same forest background, same 90 degree overhead, same lighting. Two layers + one polo + one bottom + two accessories + open Mully box in frame. Visibly the fullest of the three. This photo must read as the most product per square inch.",
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
    a: "Discovery introduces the format with a single hero piece and supporting accessories. Reserve Collection is the complete quarterly edit. Same curation, different scope.",
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
    a: "The rotation stays at the caliber you would expect from a premium golf edit. Familiar names alongside the pieces we go find so the box does not read like a display shelf.",
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

  // Closing CTA ("Take the style quiz") launches the quiz WITHOUT stashing a
  // tier. Any prior tier selection from the top tier grid is cleared, so
  // the visitor lands on the reveal page unpinned and defaults to the full
  // Reserve checkout unless they go back and pick a tier explicitly. This
  // replaces the earlier behavior which silently preselected Signature
  // Preview and applied MULLY_SIGNATURE at checkout. Recommendation logic
  // based on quiz answers is planned separately.
  const openQuizWithoutTier = useCallback(() => {
    setSelectedTier(null);
    try {
      window.localStorage.removeItem(DISCOVER_TIER_STORAGE_KEY);
    } catch {
      // localStorage may be unavailable; safe to ignore.
    }
    trackEvent("lp_discover_closing_quiz_tapped").catch(() => {});
    trackEvent(
      "quiz_started",
      { properties: { source: "lp_discover", tier: null } },
      { includeAuth: false }
    ).catch(() => {});
    setQuizOpen(true);
  }, []);

  return (
    <div className="min-h-screen bg-white text-charcoal">
      <DiscoverHeader />

      {/* ================================ HERO =============================== */}
      {/* Full-bleed styled flat-lay of the Reserve Collection on the forest
          background. Desktop: photo left, copy right. Mobile: photo top,
          copy below. This is intentionally the first frame a visitor sees. */}
      <section className="pt-16 sm:pt-20 lg:pt-24 pb-14 md:pb-20">
        <div className="max-w-7xl mx-auto px-5 sm:px-8">
          {/* Round-3 hero rebalance: 60/40 photo-dominant split on desktop
              (image col-span-3, copy col-span-2 out of 5), keeps overlay
              copy legible without going full-bleed. Mobile stays stacked. */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-12 items-center">
            {/* Photo. Two <Image> tags so we can crop tighter on mobile via
                CSS. The landscape asset is the default; the portrait asset
                takes over below 640px for a tighter framing on phones. */}
            <div className="lg:col-span-3 relative w-full aspect-[4/5] sm:aspect-[4/3] bg-forest rounded-md overflow-hidden order-first">
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
                sizes="(min-width: 1024px) 60vw, 100vw"
                className="object-cover hidden sm:block"
              />
            </div>

            {/* Copy */}
            <div className="lg:col-span-2 text-center lg:text-left">
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

      {/* ============================ THE EDIT (Round 3) =====================
          Round-3 rewrite: three large flat lays remain (the visual density
          delta is still the argument), but the section title, intro, and
          three columns are now curation-framed. Item counts and category
          tables have been removed everywhere; the point is the edit, not
          the inventory. */}
      <section id="whats-inside" className="py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-10 sm:mb-14">
            <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
              The curation
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl text-forest">
              The difference is the edit.
            </h2>
            <p className="mt-4 text-sm sm:text-base text-charcoal/70 max-w-2xl mx-auto leading-relaxed">
              Every box is built from the same question: what would we hand
              you for the season ahead? The tiers change how much of the
              answer you get.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {TIERS.map((tier) => (
              <TierEditColumn key={tier.id} tier={tier} />
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
              onClick={openQuizWithoutTier}
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

      {/* Legal-only footer (Round 3). Members reach their dashboard
          through the main site, not through this acquisition surface. */}
      <DiscoverFooter />

      {/* Quiz modal, portaled to body so mobile fixed positioning escapes
          the stacking context of the sticky footer. */}
      {quizOpen ? (
        <QuizPortal onClose={() => setQuizOpen(false)} />
      ) : null}
    </div>
  );
}

/* ---------- Quiz portal wrapper --------------------------------------- */

/**
 * Round-3 viewport fix: use 100dvh (dynamic viewport height) on the
 * portal so the modal sizes correctly when the mobile address bar
 * collapses, and route the scrollbar to a single inner region so the
 * shared QuizModal (whose internal steps are already compact) has a
 * predictable frame to render inside. Matches the pattern already used
 * by /lp/_shared/QuizLauncher so both entry points behave identically.
 */
function QuizPortal({ onClose }: { onClose: () => void }) {
  // Client-only component. QuizPortal is only rendered when the tier CTA
  // is clicked (quizOpen === true), which cannot happen during SSR, so
  // document.body is guaranteed to exist by the time this runs.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-white">
      <div className="min-h-[100dvh] px-4 pt-5 pb-10 sm:pt-12 sm:pb-16">
        <QuizModal source="lp_discover" onClose={onClose} />
      </div>
    </div>,
    document.body
  );
}

/* ---------- Stripped nav for /lp/discover (Round 3) ------------------
 * The Round-3 brief calls for a nav that’s a logo only, plus a footer
 * that’s legal-only. Existing members reach their dashboard through the
 * main site, not through this acquisition surface. Both components live
 * inline here so they cannot leak into any other page.
 */

function DiscoverHeader() {
  return (
    <header className="absolute top-0 left-0 right-0 z-40">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center">
        <Link
          href="/"
          className="flex items-center gap-2 text-forest"
          aria-label="Mully home"
        >
          <svg
            viewBox="0 0 1002 540"
            fill="currentColor"
            className="h-5 w-auto"
            aria-hidden="true"
          >
            <path
              d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z"
              fillRule="evenodd"
            />
          </svg>
          <span className="font-serif text-2xl font-bold tracking-wide">
            mully.
          </span>
        </Link>
      </div>
    </header>
  );
}

function DiscoverFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-forest/15 bg-white">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-charcoal/60">
        <div>
          &copy; {year} Mully. All rights reserved.
        </div>
        <ul className="flex items-center gap-6">
          <li>
            <Link href="/terms" className="hover:text-forest transition">
              Terms
            </Link>
          </li>
          <li>
            <Link href="/privacy" className="hover:text-forest transition">
              Privacy
            </Link>
          </li>
          <li>
            <Link href="/contact" className="hover:text-forest transition">
              Contact
            </Link>
          </li>
        </ul>
      </div>
    </footer>
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

        {/* Round-3 body: single curation-framed paragraph per tier. Fixed
            min-h keeps all three cards' price/BEST FOR/CTA rows on the
            same baseline across the grid. */}
        <p className="mt-4 text-sm text-charcoal/80 leading-relaxed md:min-h-[8rem]">
          {tier.bodyCopy}
        </p>

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

/* ---------- Tier edit column (The difference is the edit) -------------
 * Round-3 replacement for TierFlatlayCard. Photo on top, tier name, short
 * curation-framed paragraph. No item counts, no category tables, per the
 * copy directive.
 */

function TierEditColumn({ tier }: { tier: TierConfig }) {
  return (
    <figure className="flex flex-col">
      <PlaceholderFrame
        src={tier.image}
        alt={`${tier.title} flat lay showing the shape of the tier.`}
        note={tier.imageNote}
        aspect="aspect-square"
        bg="bg-forest"
        sizes="(min-width: 768px) 32vw, 92vw"
        variant="large"
      />
      <figcaption className="mt-5 flex flex-col flex-1">
        <h3 className="font-serif text-xl text-forest">{tier.title}</h3>
        <p className="mt-3 text-sm text-charcoal/80 leading-relaxed">
          {tier.editCopy}
        </p>
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

/**
 * Meteorological Northern-Hemisphere seasons — aligns with how apparel
 * boxes are actually named in the trade. Spring = Mar/Apr/May, Summer =
 * Jun/Jul/Aug, Fall = Sep/Oct/Nov, Winter = Dec/Jan/Feb. Confirmed with
 * Drew in Round 3.
 */
function seasonFromDate(d: Date): "Spring" | "Summer" | "Fall" | "Winter" {
  const m = d.getMonth(); // 0 = January
  if (m >= 2 && m <= 4) return "Spring";
  if (m >= 5 && m <= 7) return "Summer";
  if (m >= 8 && m <= 10) return "Fall";
  return "Winter";
}

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
    // Box 1 uses the visitor's selected tier name (or a neutral fallback).
    // Boxes 2–4 are always the full Reserve edit, dynamically named by the
    // meteorological season of their ship date so "Winter Collection" reads
    // right in December and "Summer Collection" reads right in July.
    const b2 = plus(90);
    const b3 = plus(180);
    const b4 = plus(270);
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
        date: fmt(b2),
        title: `Reserve ${seasonFromDate(b2)} Collection`,
        price: "$250",
        highlight: false,
      },
      {
        boxLabel: "Box 3",
        date: fmt(b3),
        title: `Reserve ${seasonFromDate(b3)} Collection`,
        price: "$250",
        highlight: false,
      },
      {
        boxLabel: "Box 4",
        date: fmt(b4),
        title: `Reserve ${seasonFromDate(b4)} Collection`,
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
        Every box is curated for the season it ships in. Winter boxes lean
        layers and travel. Summer boxes lean lightweight. The renewal price
        is always $250 per quarter.
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
