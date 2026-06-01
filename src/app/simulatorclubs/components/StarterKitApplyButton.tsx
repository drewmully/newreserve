"use client";

import { useState } from "react";
import StarterKitOnboarding from "./StarterKitOnboarding";

interface Props {
  className?: string;
  children: React.ReactNode;
}

/**
 * Tiny client wrapper that renders an "Apply" trigger plus the
 * StarterKitOnboarding modal. Used wherever the page needs an
 * "Apply for a founding kit" CTA while keeping the page server-rendered.
 */
export default function StarterKitApplyButton({ className, children }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
      >
        {children}
      </button>
      <StarterKitOnboarding open={open} onClose={() => setOpen(false)} />
    </>
  );
}
