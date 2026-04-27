"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Back9WelcomeModalProps {
  username: string;
  onClose: () => Promise<void>;
}

export function Back9WelcomeModal({ username, onClose }: Back9WelcomeModalProps) {
  const router = useRouter();

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") void onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [handleEscape]);

  async function handleUpgrade() {
    await onClose();
    router.push("/dashboard?upgrade=1");
  }

  async function handleContinue() {
    await onClose();
  }

  const greeting = username ? `Welcome back, ${username}.` : "Welcome back.";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-obsidian/70 backdrop-blur-sm"
        onClick={() => void onClose()}
      />

      <div className="relative w-full max-w-lg bg-bone rounded-xl shadow-2xl overflow-hidden">
        {/* Header strip */}
        <div className="bg-forest px-8 py-6">
          <p className="text-xs font-medium tracking-widest text-sage uppercase mb-1">
            Back 9 Member
          </p>
          <h2 className="font-serif text-2xl text-bone leading-snug">
            {greeting}
          </h2>
        </div>

        {/* Body */}
        <div className="px-8 py-6 space-y-4 text-charcoal text-sm leading-relaxed">
          <p>
            You were with us before much of what you see here existed. We
            wanted to take a moment to acknowledge that, and show you what
            has changed.
          </p>

          <div className="bg-cream rounded-xl p-4 space-y-2">
            <p className="font-medium text-obsidian text-xs uppercase tracking-wide">
              What you have as a Back 9 member
            </p>
            <ul className="space-y-1 text-charcoal">
              <li className="flex items-start gap-2">
                <span className="text-sage mt-0.5">+</span>
                Pro Shop with member discount
              </li>
              <li className="flex items-start gap-2">
                <span className="text-sage mt-0.5">+</span>
                Private Club Registry
              </li>
              <li className="flex items-start gap-2">
                <span className="text-sage mt-0.5">+</span>
                Benefits portal
              </li>
            </ul>
          </div>

          <p className="text-xs text-taupe">
            Reserve Member ($250/quarter) adds an AI-personalized quarterly
            box, priority concierge, and first access on all limited drops.
          </p>
        </div>

        {/* Actions */}
        <div className="px-8 pb-8 flex flex-col gap-3">
          <button
            onClick={() => void handleUpgrade()}
            className="w-full bg-forest text-bone rounded-xl py-3 text-sm font-medium hover:bg-forest/90 transition-colors"
          >
            Upgrade to Reserve Member
          </button>
          <button
            onClick={() => void handleContinue()}
            className="w-full text-charcoal text-sm hover:text-obsidian transition-colors py-2"
          >
            Continue to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
