"use client";

/**
 * Mounts the QuizModal in a full-screen overlay when the LP's primary CTA
 * is tapped. Lives in a portal-style fixed wrapper so we don't fight the
 * existing LP's scroll/layout.
 *
 * Renders nothing until opened — keeps the LP's initial HTML lean and
 * defers the (relatively large) quiz JS until intent is shown.
 */

import { useCallback, useEffect, useState } from "react";
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

  // Lock body scroll while modal is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
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
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-white">
      <div className="min-h-screen px-4 py-10 sm:py-16">
        <QuizModal source={source} onClose={onClose} />
      </div>
    </div>
  );
}
