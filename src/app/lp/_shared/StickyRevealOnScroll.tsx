"use client";

/**
 * Renders its children as a bottom-anchored mobile sticky, but only after
 * the user has scrolled past the hero region. Uses IntersectionObserver on
 * a sentinel div rendered by the parent (default: right after the hero
 * section). While the sentinel is in the viewport, the sticky is hidden.
 * Once the sentinel scrolls out of view (i.e. the hero has left the top of
 * the viewport), the sticky slides up.
 *
 * Why not "scrollY > 40% of viewport height"?
 *   Different hero heights on different arms and different devices make a
 *   fixed scroll threshold either fire mid-hero (bad) or never fire on
 *   tall hero variants. Anchoring to a sentinel that lives at the bottom
 *   of the hero gives the right answer regardless of hero height.
 *
 * Also honours the [data-consult-open="true"] flag on <html> — the modal
 * arm needs the sticky to disappear entirely while the modal is open, and
 * the existing globals.css rule already handles that via [data-lp-sticky].
 * This component adds data-lp-sticky to the wrapper for you.
 *
 * Usage:
 *
 *   <StickyRevealSentinel />          <-- place at bottom of hero
 *   ...more sections...
 *   <StickyRevealOnScroll>
 *     <a href="#quiz">Start the quiz</a>
 *   </StickyRevealOnScroll>
 *
 * The parent controls where the sentinel lives, so callers can trigger the
 * reveal at whatever point in the page makes sense (bottom of hero for
 * ConsultLPClient, bottom of the QuizModal section for ConsultQuizFirstClient
 * so the sticky only appears once the quiz has scrolled off).
 */

import { useEffect, useRef, useState } from "react";

/**
 * Shared sentinel id so multiple stickies on the same page can watch the
 * same element without prop drilling.
 */
export const STICKY_REVEAL_SENTINEL_ID = "sticky-reveal-sentinel";

export function StickyRevealSentinel({ id }: { id?: string } = {}) {
  return (
    <div
      id={id ?? STICKY_REVEAL_SENTINEL_ID}
      aria-hidden="true"
      // 1px non-zero size so IntersectionObserver can find it.
      className="h-px w-full pointer-events-none"
    />
  );
}

export function StickyRevealOnScroll({
  children,
  sentinelId,
  className,
}: {
  children: React.ReactNode;
  sentinelId?: string;
  className?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = document.getElementById(
      sentinelId ?? STICKY_REVEAL_SENTINEL_ID,
    );
    if (!sentinel) {
      // No sentinel on the page — reveal immediately so we don't strand
      // users on a page that expects a sticky CTA.
      setRevealed(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        // While the sentinel is visible, we're still in the hero — hide.
        // Once it leaves the viewport (user scrolled past hero), show.
        setRevealed(!entry.isIntersecting);
      },
      // Fire when the sentinel is fully out of view (default threshold).
      { root: null, threshold: 0 },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [sentinelId]);

  return (
    <div
      ref={ref}
      data-lp-sticky
      aria-hidden={!revealed}
      className={[
        // Base: hidden below viewport, fades/slides in when revealed.
        "lg:hidden fixed bottom-0 inset-x-0 z-50",
        "border-t border-charcoal/10 bg-white/95 backdrop-blur-md",
        "shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.15)]",
        "transition-transform duration-200 ease-out",
        revealed
          ? "translate-y-0 pointer-events-auto"
          : "translate-y-full pointer-events-none",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="max-w-6xl mx-auto px-4 py-3">{children}</div>
    </div>
  );
}
