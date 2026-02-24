"use client";

import { useState, useEffect, useCallback } from "react";

/* ═══════════════════════════════════════════
   UPGRADE MODAL
   Plan selection → Fit profile (Reserve Member)
   ═══════════════════════════════════════════ */

type MemberTier = "free" | "access" | "member" | "black";

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  currentTier: MemberTier;
  onSelectPlan: (tier: MemberTier) => void;
}

/* ── Fit form sizing options ── */

const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const GLOVE_HANDS = ["Left (right-handed)", "Right (left-handed)"];
const GLOVE_SIZES = ["S", "M", "ML", "L", "XL"];
const WAIST_SIZES = ["28", "29", "30", "31", "32", "33", "34", "36", "38", "40"];
const SHOE_SIZES = ["7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "13", "14"];
const PANTS_INSEAMS = ["28\"", "30\"", "32\"", "34\"", "36\""];
const SHORTS_INSEAMS = ["7\"", "9\"", "10\"", "11\""];

export function UpgradeModal({ open, onClose, currentTier, onSelectPlan }: UpgradeModalProps) {
  // "plans" = pick a plan, "fit" = fill out fit profile (Reserve Member only)
  const [view, setView] = useState<"plans" | "fit">("plans");

  // Fit form state
  const [shirtSize, setShirtSize] = useState("");
  const [gloveHand, setGloveHand] = useState("");
  const [gloveSize, setGloveSize] = useState("");
  const [waistSize, setWaistSize] = useState("");
  const [shoeSize, setShoeSize] = useState("");
  const [pantsInseam, setPantsInseam] = useState("");
  const [shortsInseam, setShortsInseam] = useState("");

  // Reset on open
  useEffect(() => {
    if (open) {
      setView("plans");
    }
  }, [open]);

  // Escape key
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, handleEscape]);

  if (!open) return null;

  function handleChooseAccess() {
    onSelectPlan("access");
    onClose();
  }

  function handleChooseMember() {
    // Go to fit step before confirming
    setView("fit");
  }

  function handleFitComplete() {
    onSelectPlan("member");
    onClose();
  }

  function handleFitSkip() {
    onSelectPlan("member");
    onClose();
  }

  const showAccessCard = currentTier === "free";
  const showMemberCard = currentTier !== "member" && currentTier !== "black";

  return (
    <div className="fixed inset-0 z-[95]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-obsidian/50 backdrop-blur-sm animate-modal-backdrop"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6 pointer-events-none">
        <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-bone shadow-2xl pointer-events-auto animate-modal-content">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-taupe/10 hover:bg-taupe/20 flex items-center justify-center transition-colors duration-300 cursor-pointer"
            aria-label="Close"
          >
            <svg className="w-4 h-4 text-charcoal/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* ════════ PLAN SELECTION VIEW ════════ */}
          {view === "plans" && (
            <div className="p-6 sm:p-8">
              <span className="inline-flex items-center gap-2 text-xs tracking-[0.3em] uppercase text-sage font-medium mb-4">
                <span className="w-6 h-px bg-sage/50" />
                Upgrade
                <span className="w-6 h-px bg-sage/50" />
              </span>
              <h2 className="font-serif text-2xl sm:text-3xl text-obsidian leading-tight mb-2">
                Elevate your membership.
              </h2>
              <p className="text-sm text-charcoal/55 leading-relaxed mb-8">
                Built for the modern golfer. Premium gear, concierge access, and a community that gets it.
              </p>

              <div className="space-y-4">
                {/* Reserve Access */}
                {showAccessCard && (
                  <div className="bg-cream rounded-2xl p-6 border border-taupe/20">
                    <span className="text-[11px] tracking-[0.25em] uppercase text-forest font-medium">
                      Reserve Access
                    </span>
                    <div className="mt-2 mb-4">
                      <span className="font-serif text-2xl text-obsidian">$99</span>
                      <span className="text-charcoal/40 text-sm ml-1">/year</span>
                    </div>
                    <div className="border-t border-taupe/12 pt-4">
                      <ul className="space-y-2 mb-5">
                        <ModalFeature text="Reserve pricing unlocked" />
                        <ModalFeature text="Early access to drops" />
                        <ModalFeature text="Free 2-day shipping" />
                        <ModalFeature text="Partner benefit access" />
                      </ul>
                      <button
                        onClick={handleChooseAccess}
                        className="h-11 px-8 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-all duration-300 cursor-pointer btn-press"
                      >
                        Join Reserve Access
                      </button>
                    </div>
                  </div>
                )}

                {/* Reserve Member (featured) */}
                {showMemberCard && (
                  <div className="relative">
                    <div className="absolute -top-3 left-6 z-20">
                      <span className="inline-block bg-sage text-bone text-[10px] tracking-[0.2em] uppercase font-semibold px-3 py-1 rounded-full shadow-sm">
                        Recommended
                      </span>
                    </div>
                    <div className="bg-forest rounded-2xl overflow-hidden relative shadow-xl shadow-forest/20 ring-1 ring-sage/20">
                      <div className="relative z-10 p-6">
                        <span className="text-[11px] tracking-[0.25em] uppercase text-sage font-medium">
                          Reserve Member
                        </span>
                        <div className="mt-2 mb-1">
                          <span className="font-serif text-2xl text-bone">$249</span>
                          <span className="text-bone/45 text-sm ml-1">/quarter</span>
                        </div>
                        <p className="text-xs text-bone/40 mb-4">
                          Includes a personalized fit profile for curated drops and member boxes.
                        </p>
                        <div className="border-t border-bone/10 pt-4">
                          <ul className="space-y-2 mb-5">
                            <ModalFeature text="Everything in Access" light />
                            <ModalFeature text="Personalized fit profile" light />
                            <ModalFeature text="Curated member boxes for him" light />
                            <ModalFeature text="Priority release access" light />
                            <ModalFeature text="Concierge booking support" light />
                            <ModalFeature text="Invite-only events" light />
                          </ul>
                          <button
                            onClick={handleChooseMember}
                            className="h-11 px-8 rounded-xl bg-bone text-forest text-sm font-medium tracking-wider uppercase hover:bg-bone-dark transition-all duration-300 cursor-pointer btn-press"
                          >
                            Continue
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Reserve Black */}
                <div className="bg-cream rounded-2xl p-6 border border-taupe/20 relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-1 bg-obsidian" />
                  <span className="text-[11px] tracking-[0.25em] uppercase text-charcoal/50 font-medium">
                    Reserve Black
                  </span>
                  <div className="mt-2 mb-4">
                    <span className="font-serif text-2xl text-obsidian">Invite Only</span>
                  </div>
                  <div className="border-t border-taupe/12 pt-4">
                    <ul className="space-y-2 mb-5">
                      <ModalFeature text="Everything in Member" />
                      <ModalFeature text="$1,000 quarterly credit" />
                      <ModalFeature text="Personal stylist" />
                      <ModalFeature text="Concierge phone line" />
                    </ul>
                    <div className="inline-block h-11 px-8 leading-[2.75rem] rounded-xl border border-charcoal/15 text-charcoal/40 text-sm font-medium tracking-wider uppercase cursor-default">
                      By Invitation
                    </div>
                  </div>
                </div>
              </div>

              {/* Reassurance line + subtle positioning note */}
              <p className="text-center text-xs text-charcoal/35 mt-6 leading-relaxed">
                Cancel or change plans anytime. Member boxes and fit profiles are currently available in menswear only.
              </p>
            </div>
          )}

          {/* ════════ FIT PROFILE VIEW (Reserve Member) ════════ */}
          {view === "fit" && (
            <div className="p-6 sm:p-8 animate-substep-in">
              <span className="inline-flex items-center gap-2 text-xs tracking-[0.3em] uppercase text-sage font-medium mb-4">
                <span className="w-6 h-px bg-sage/50" />
                Your Fit
                <span className="w-6 h-px bg-sage/50" />
              </span>
              <h2 className="font-serif text-2xl sm:text-3xl text-obsidian leading-tight mb-2">
                Let&rsquo;s dial in your fit.
              </h2>
              <p className="text-sm text-charcoal/55 leading-relaxed mb-2">
                We use this to curate member boxes and recommend the right size across every brand we carry.
              </p>
              <p className="text-xs text-charcoal/35 leading-relaxed mb-8">
                Our fit program currently covers men&rsquo;s apparel and accessories. We&rsquo;re working on expanding, so stay tuned.
              </p>

              {/* Shirt Size */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-obsidian tracking-wide mb-3">
                  Shirt size
                </h3>
                <div className="flex flex-wrap gap-2">
                  {SHIRT_SIZES.map((s) => (
                    <PillButton key={s} label={s} active={shirtSize === s} onClick={() => setShirtSize(shirtSize === s ? "" : s)} />
                  ))}
                </div>
              </div>

              {/* Glove Hand + Size */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-obsidian tracking-wide mb-3">
                  Glove
                </h3>
                <div className="flex flex-wrap gap-2 mb-3">
                  {GLOVE_HANDS.map((h) => (
                    <PillButton key={h} label={h} active={gloveHand === h} onClick={() => setGloveHand(gloveHand === h ? "" : h)} />
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {GLOVE_SIZES.map((s) => (
                    <PillButton key={s} label={s} active={gloveSize === s} onClick={() => setGloveSize(gloveSize === s ? "" : s)} />
                  ))}
                </div>
              </div>

              {/* Waist */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-obsidian tracking-wide mb-3">
                  Waist
                </h3>
                <div className="flex flex-wrap gap-2">
                  {WAIST_SIZES.map((s) => (
                    <PillButton key={s} label={s} active={waistSize === s} onClick={() => setWaistSize(waistSize === s ? "" : s)} />
                  ))}
                </div>
              </div>

              {/* Shoe Size */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-obsidian tracking-wide mb-3">
                  Shoe size
                </h3>
                <div className="flex flex-wrap gap-2">
                  {SHOE_SIZES.map((s) => (
                    <PillButton key={s} label={s} active={shoeSize === s} onClick={() => setShoeSize(shoeSize === s ? "" : s)} />
                  ))}
                </div>
              </div>

              {/* Pants Inseam */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-obsidian tracking-wide mb-3">
                  Pants inseam
                </h3>
                <div className="flex flex-wrap gap-2">
                  {PANTS_INSEAMS.map((s) => (
                    <PillButton key={s} label={s} active={pantsInseam === s} onClick={() => setPantsInseam(pantsInseam === s ? "" : s)} />
                  ))}
                </div>
              </div>

              {/* Shorts Inseam */}
              <div className="mb-8">
                <h3 className="text-sm font-medium text-obsidian tracking-wide mb-3">
                  Shorts inseam
                </h3>
                <div className="flex flex-wrap gap-2">
                  {SHORTS_INSEAMS.map((s) => (
                    <PillButton key={s} label={s} active={shortsInseam === s} onClick={() => setShortsInseam(shortsInseam === s ? "" : s)} />
                  ))}
                </div>
              </div>

              {/* Navigation */}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setView("plans")}
                  className="text-sm text-charcoal/40 hover:text-charcoal/60 transition-colors duration-300 cursor-pointer flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  </svg>
                  Back
                </button>
                <div className="flex items-center gap-4">
                  <button
                    onClick={handleFitSkip}
                    className="text-sm text-charcoal/40 hover:text-charcoal/60 transition-colors duration-300 cursor-pointer"
                  >
                    Skip for now
                  </button>
                  <button
                    onClick={handleFitComplete}
                    className="h-11 px-8 rounded-xl text-sm font-medium tracking-wider uppercase transition-all duration-300 cursor-pointer btn-press bg-forest text-bone hover:bg-forest-dark"
                  >
                    Complete
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════ */

function ModalFeature({ text, light }: { text: string; light?: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <svg
        className={`w-3.5 h-3.5 shrink-0 ${light ? "text-sage" : "text-forest"}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      <span className={`text-sm ${light ? "text-bone/65" : "text-charcoal/65"}`}>{text}</span>
    </li>
  );
}

function PillButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 rounded-xl text-sm transition-all duration-300 cursor-pointer border ${
        active
          ? "bg-forest text-bone border-forest"
          : "bg-cream border-taupe/25 text-charcoal/70 hover:border-forest/40"
      }`}
    >
      {label}
    </button>
  );
}
