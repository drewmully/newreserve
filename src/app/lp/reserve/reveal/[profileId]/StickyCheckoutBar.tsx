"use client";

/**
 * Sticky bottom checkout bar for the Reserve reveal page.
 *
 * Why this exists:
 *   The reveal page is intentionally long (hero + recent apparel + recent
 *   accessories + welcome gift + value math + checkout + proof). On desktop
 *   especially, the user can scroll past the above-the-fold CTA and lose
 *   sight of any way to convert. This bar keeps a primary action visible
 *   on every breakpoint after the user scrolls past the hero.
 *
 * Behavior:
 *   - Hidden until the user has scrolled at least one viewport height
 *     (avoids competing with the in-hero CTA).
 *   - Sticky on every breakpoint (mobile + desktop). The bottom-of-page
 *     CheckoutBlock fades into the page padding, and this bar replaces it
 *     as the "always-there" CTA.
 *   - Re-uses ReserveCheckoutCTA so all tracking + LIP plumbing is shared.
 */

import { useEffect, useState } from "react";
import {
  ReserveCheckoutCTA,
  type QuizLineItemPropsInput,
} from "./ReserveCheckoutCTA";
import type { StyleBucket } from "@/lib/styleProfiles/types";

export function StickyCheckoutBar({
  profileId,
  bucket,
  quizLineItemProps,
  typicalRetail,
}: {
  profileId: string;
  bucket: StyleBucket;
  quizLineItemProps: QuizLineItemPropsInput;
  typicalRetail: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      // Show once the user is meaningfully past the hero. Using window
      // height as the threshold keeps it responsive on tall desktops and
      // short mobile viewports without hard-coding pixel values.
      setVisible(window.scrollY > Math.max(320, window.innerHeight * 0.6));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      aria-hidden={!visible}
      className={[
        "fixed inset-x-0 bottom-0 z-40 border-t border-forest/15 bg-bone/95 backdrop-blur",
        "transition-transform duration-200",
        visible ? "translate-y-0" : "translate-y-full",
      ].join(" ")}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3 sm:px-6 sm:py-4">
        <div className="hidden flex-1 sm:block">
          <div className="font-serif text-base text-forest">
            Reserve — $250 / quarter
          </div>
          <div className="text-xs text-charcoal/65">
            {typicalRetail} typical retail · Free size exchanges · Cancel anytime after Q1.
          </div>
        </div>
        <div className="flex-1 sm:max-w-xs">
          <ReserveCheckoutCTA
            profileId={profileId}
            styleBucket={bucket}
            quizLineItemProps={quizLineItemProps}
          />
        </div>
      </div>
    </div>
  );
}
