"use client";

/**
 * Mounts the QuizModal in a full-screen overlay when the LP's primary CTA
 * is tapped. Renders via React portal to <document.body> so the fixed
 * overlay escapes any ancestor that establishes a containing block for
 * position:fixed — in particular the mobile sticky footer's backdrop-blur
 * ancestor stack, which was trapping the modal inside a ~72px strip below
 * the viewport on iOS Safari.
 *
 * Also toggles [data-consult-open="true"] on <html> for the duration of the
 * modal so any [data-lp-sticky] element (currently the LP mobile bottom bar)
 * hides via the global rule in globals.css. Mirrors the fix already applied
 * to ConsultOnboardingLauncher.
 *
 * Renders nothing until opened — keeps the LP's initial HTML lean and
 * defers the (relatively large) quiz JS until intent is shown.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { QuizModal } from "./QuizModal";
import { trackEvent } from "@/lib/tracking";

export interface QuizLauncherProps {
  /** Visual style of the launcher button. */
  variant?: "primary-large" | "primary-pill" | "ghost";
  /** CTA label override. */
  label?: string;
  /** Analytics source identifier. */
  source?: string;
  className?: string;
}

export function QuizLauncher({
  variant = "primary-large",
  label,
  source = "lp_subscription",
  className,
}: QuizLauncherProps) {
  const [open, setOpen] = useState(false);

  const buttonClass = (() => {
    switch (variant) {
      case "primary-large":
        return "w-full bg-ember hover:bg-ember/90 text-bone py-3.5 rounded-md text-sm font-medium tracking-wide transition cursor-pointer";
      case "primary-pill":
        return "bg-ember hover:bg-ember/90 text-bone py-3.5 px-10 rounded-md text-sm font-medium tracking-wide transition cursor-pointer";
      case "ghost":
        return "text-sm underline text-charcoal/70 hover:text-charcoal transition";
    }
  })();

  const openQuiz = useCallback(() => {
    trackEvent(
      "quiz_started",
      { properties: { source } },
      { includeAuth: false }
    ).catch(() => {});
    setOpen(true);
  }, [source]);

  // Lock body scroll AND expose a signal the mobile sticky CTA can read via
  // CSS while the modal is open. See globals.css:
  //   html[data-consult-open="true"] [data-lp-sticky] { display: none; }
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.setAttribute("data-consult-open", "true");
    return () => {
      document.body.style.overflow = prev;
      document.documentElement.removeAttribute("data-consult-open");
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={openQuiz}
        className={[buttonClass, className].filter(Boolean).join(" ")}
      >
        {label ?? "Build my Reserve edit"}
      </button>
      {open && <QuizOverlay onClose={() => setOpen(false)} source={source} />}
    </>
  );
}

function QuizOverlay({
  onClose,
  source,
}: {
  onClose: () => void;
  source: string;
}) {
  // SSR guard: createPortal needs a real DOM.
  if (typeof document === "undefined") return null;

  // Use 100svh (small viewport height) so the modal sizing is correct when
  // the mobile keyboard is open or the address bar collapses. Tight top
  // padding so the first step (style cards) fits a single mobile viewport.
  //
  // z-[100] matches ConsultOnboardingOverlay so both LPs' modals sit above
  // any z-50 sticky affordance without a fight.
  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-bone">
      <div className="min-h-[100svh] px-4 pt-5 pb-10 sm:pt-12 sm:pb-16">
        <QuizModal source={source} onClose={onClose} />
      </div>
    </div>,
    document.body,
  );
}
