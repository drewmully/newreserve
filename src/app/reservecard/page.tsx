"use client";

import { useState } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../lib/firebase";
import {
  FIT_SHIRT_SIZES, FIT_GLOVE_HANDS, FIT_GLOVE_SIZES,
  FIT_WAIST_SIZES, FIT_SHOE_SIZES, FIT_PANTS_INSEAMS, FIT_SHORTS_INSEAMS,
  PillButton,
} from "../components/UpgradeModal";

/* ═══════════════════════════════════════════
   RESERVE CARD — Existing Member Update Flow
   QR code entry → sizing → preferences → plan → confirm
   ═══════════════════════════════════════════ */

const TOTAL_STEPS = 6;

const STYLE_VIBES = [
  "Classic / Traditional",
  "Modern / Athletic",
  "Streetwear Inspired",
  "Keep It Simple",
];

const COLOR_PREFERENCES = [
  "Neutrals",
  "Earth Tones",
  "Bold / Bright",
  "Dark & Muted",
  "No Preference",
];

const PUTTER_TYPES = ["Blade", "Mallet", "Mid-Mallet", "Not Sure"];

const BRAND_INTEREST = [
  "Nike",
  "adidas",
  "FootJoy",
  "Titleist",
  "TravisMathew",
  "Peter Millar",
  "Greyson",
  "PUMA",
  "Malbon Golf",
  "No Preference",
];

export default function ReserveCardPage() {
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 1: Welcome + email + gender
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [gender, setGender] = useState("");

  // Step 2: Fit tops
  const [shirtSize, setShirtSize] = useState("");
  const [gloveHand, setGloveHand] = useState("");
  const [gloveSize, setGloveSize] = useState("");

  // Step 3: Fit bottoms
  const [waistSize, setWaistSize] = useState("");
  const [pantsInseam, setPantsInseam] = useState("");
  const [shortsInseam, setShortsInseam] = useState("");
  const [shoeSize, setShoeSize] = useState("");

  // Step 4: Style preferences (optional)
  const [styleVibe, setStyleVibe] = useState("");
  const [colorPref, setColorPref] = useState("");
  const [putterType, setPutterType] = useState("");
  const [brands, setBrands] = useState<string[]>([]);

  // Step 5: Plan selection
  const [selectedPlan, setSelectedPlan] = useState("");

  // Step 6: Confirmation (no state needed)

  const animClass = direction === "forward" ? "animate-substep-in" : "animate-substep-back-in";

  function goTo(target: number) {
    setDirection(target > step ? "forward" : "back");
    setStep(target);
  }

  function toggleBrand(brand: string) {
    if (brand === "No Preference") {
      setBrands(brands.includes("No Preference") ? [] : ["No Preference"]);
      return;
    }
    setBrands((prev: string[]) => {
      const filtered = prev.filter((b: string) => b !== "No Preference");
      return filtered.includes(brand)
        ? filtered.filter((b: string) => b !== brand)
        : [...filtered, brand];
    });
  }

  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function handleConfirm() {
    if (!selectedPlan || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const docRef = doc(db, "reserve_card_submissions", email.trim().toLowerCase());
      await setDoc(docRef, {
        email: email.trim().toLowerCase(),
        gender,
        fit: {
          shirt_size: shirtSize,
          glove_hand: gloveHand,
          glove_size: gloveSize,
          waist_size: waistSize,
          pants_inseam: pantsInseam,
          shorts_inseam: shortsInseam,
          shoe_size: shoeSize,
        },
        style: {
          vibe: styleVibe,
          color_preference: colorPref,
          putter_type: putterType,
          brand_interest: brands,
        },
        selected_plan: selectedPlan,
        submitted_at: serverTimestamp(),
        source: "reserve_card_qr",
      }, { merge: true });
      goTo(6);
    } catch (err) {
      console.error("Failed to save reserve card submission:", err);
      // Still advance — don't block the member on a Firestore error
      goTo(6);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-bone">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/20">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-center h-14">
          <span className="flex items-center gap-2 text-forest">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-4 w-auto" aria-hidden="true">
              <path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" />
            </svg>
            <span className="font-serif text-xl font-bold tracking-wide">mully.</span>
          </span>
        </div>
      </header>

      <main className="pt-24 pb-20 px-6">
        <div className="max-w-md mx-auto">
          {/* Progress bar */}
          {step < TOTAL_STEPS && (
            <div className="flex items-center gap-1.5 mb-8">
              {Array.from({ length: TOTAL_STEPS - 1 }, (_, i) => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-colors duration-500 ${
                    step > i ? "bg-forest" : "bg-taupe/25"
                  }`}
                />
              ))}
            </div>
          )}

          {/* ═══════ STEP 1: WELCOME ═══════ */}
          {step === 1 && (
            <div className={animClass}>
              <span className="inline-flex items-center gap-2 text-xs tracking-[0.3em] uppercase text-sage font-medium mb-4">
                <span className="w-6 h-px bg-sage/50" />
                Welcome Back
                <span className="w-6 h-px bg-sage/50" />
              </span>

              <h1 className="font-serif text-3xl text-obsidian leading-tight mb-3">
                Good to see you.
              </h1>
              <p className="text-base text-charcoal/55 leading-relaxed mb-10">
                We&rsquo;re updating the Reserve experience. Take a minute to confirm your sizing, tell us what you like, and choose the membership that fits.
              </p>

              {/* Email */}
              <div className="mb-8">
                <label htmlFor="rc-email" className="block text-sm font-medium text-obsidian tracking-wide mb-3">
                  Your email
                </label>
                <input
                  id="rc-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setEmailTouched(true)}
                  className={`w-full h-12 px-4 rounded-xl border bg-cream text-obsidian text-sm placeholder:text-charcoal/30 outline-none transition-all duration-200 ${
                    emailTouched && !emailIsValid
                      ? "border-ember/60 focus:border-ember"
                      : "border-taupe/25 focus:border-forest"
                  }`}
                />
                {emailTouched && !emailIsValid && (
                  <p className="mt-2 text-xs text-ember/80">Please enter a valid email address.</p>
                )}
              </div>

              {/* Gender */}
              <div className="mb-12">
                <h3 className="text-sm font-medium text-obsidian tracking-wide mb-4">
                  I shop for
                </h3>
                <div className="flex gap-3">
                  {["Menswear", "Womenswear"].map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setGender(gender === opt ? "" : opt)}
                      className={`flex-1 py-3 rounded-xl text-sm font-medium transition-all duration-300 cursor-pointer border ${
                        gender === opt
                          ? "bg-forest text-bone border-forest"
                          : "bg-cream border-taupe/25 text-charcoal/70 hover:border-forest/40"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => goTo(2)}
                  disabled={!emailIsValid || !gender}
                  className={`h-12 px-10 rounded-xl text-sm font-medium tracking-wider uppercase transition-all duration-300 btn-press ${
                    emailIsValid && gender
                      ? "bg-forest text-bone hover:bg-forest-dark cursor-pointer"
                      : "bg-taupe/25 text-charcoal/30 cursor-not-allowed"
                  }`}
                >
                  Get Started
                </button>
              </div>
            </div>
          )}

          {/* ═══════ STEP 2: TOPS & GLOVE ═══════ */}
          {step === 2 && (
            <div className={animClass}>
              <StepDots total={3} current={1} />

              <h1 className="font-serif text-3xl text-obsidian leading-tight mb-2">
                Tops &amp; glove.
              </h1>
              <p className="text-sm text-charcoal/45 mb-8">
                Let&rsquo;s make sure we have your fit dialed in.
              </p>

              {/* Shirt */}
              <div className="mb-8">
                <h3 className="text-sm font-medium text-obsidian mb-3">Shirt</h3>
                <div className="flex flex-wrap gap-2">
                  {FIT_SHIRT_SIZES.map((s) => (
                    <PillButton key={s} label={s} active={shirtSize === s} onClick={() => setShirtSize(shirtSize === s ? "" : s)} />
                  ))}
                </div>
              </div>

              {/* Glove Hand */}
              <div className="mb-8">
                <h3 className="text-sm font-medium text-obsidian mb-3">Glove hand</h3>
                <div className="flex flex-wrap gap-2">
                  {FIT_GLOVE_HANDS.map((h) => (
                    <PillButton key={h} label={h} active={gloveHand === h} onClick={() => setGloveHand(gloveHand === h ? "" : h)} />
                  ))}
                </div>
              </div>

              {/* Glove Size */}
              {gloveHand && (
                <div className="mb-10 animate-fade-up">
                  <h3 className="text-sm font-medium text-obsidian mb-3">Glove size</h3>
                  <div className="flex flex-wrap gap-2">
                    {FIT_GLOVE_SIZES.map((s) => (
                      <PillButton key={s} label={s} active={gloveSize === s} onClick={() => setGloveSize(gloveSize === s ? "" : s)} />
                    ))}
                  </div>
                </div>
              )}

              <StepNav onBack={() => goTo(1)} onNext={() => goTo(3)} />
            </div>
          )}

          {/* ═══════ STEP 3: BOTTOMS & SHOES ═══════ */}
          {step === 3 && (
            <div className={animClass}>
              <StepDots total={3} current={2} />

              <h1 className="font-serif text-3xl text-obsidian leading-tight mb-2">
                Bottoms &amp; shoes.
              </h1>
              <p className="text-sm text-charcoal/45 mb-8">
                Almost done with sizing.
              </p>

              {/* Waist */}
              <div className="mb-8">
                <h3 className="text-sm font-medium text-obsidian mb-3">Waist</h3>
                <div className="flex flex-wrap gap-2">
                  {FIT_WAIST_SIZES.map((s) => (
                    <PillButton key={s} label={s} active={waistSize === s} onClick={() => setWaistSize(waistSize === s ? "" : s)} />
                  ))}
                </div>
              </div>

              {/* Pants Inseam */}
              <div className="mb-8">
                <h3 className="text-sm font-medium text-obsidian mb-3">Pants inseam</h3>
                <div className="flex flex-wrap gap-2">
                  {FIT_PANTS_INSEAMS.map((s) => (
                    <PillButton key={s} label={s} active={pantsInseam === s} onClick={() => setPantsInseam(pantsInseam === s ? "" : s)} />
                  ))}
                </div>
              </div>

              {/* Shorts Inseam */}
              <div className="mb-8">
                <h3 className="text-sm font-medium text-obsidian mb-3">Shorts inseam</h3>
                <div className="flex flex-wrap gap-2">
                  {FIT_SHORTS_INSEAMS.map((s) => (
                    <PillButton key={s} label={s} active={shortsInseam === s} onClick={() => setShortsInseam(shortsInseam === s ? "" : s)} />
                  ))}
                </div>
              </div>

              {/* Shoe */}
              <div className="mb-10">
                <h3 className="text-sm font-medium text-obsidian mb-3">Shoe size</h3>
                <div className="flex flex-wrap gap-2">
                  {FIT_SHOE_SIZES.map((s) => (
                    <PillButton key={s} label={s} active={shoeSize === s} onClick={() => setShoeSize(shoeSize === s ? "" : s)} />
                  ))}
                </div>
              </div>

              <StepNav onBack={() => goTo(2)} onNext={() => goTo(4)} />
            </div>
          )}

          {/* ═══════ STEP 4: STYLE PREFERENCES (Optional) ═══════ */}
          {step === 4 && (
            <div className={animClass}>
              <StepDots total={3} current={3} />

              <h1 className="font-serif text-3xl text-obsidian leading-tight mb-2">
                Your style.
              </h1>
              <p className="text-sm text-charcoal/45 mb-8">
                Optional, but helps our curation team put together better Reserve boxes and recommendations for you.
              </p>

              {/* Style Vibe */}
              <div className="mb-8">
                <h3 className="text-sm font-medium text-obsidian mb-3">How would you describe your style?</h3>
                <div className="flex flex-wrap gap-2">
                  {STYLE_VIBES.map((v) => (
                    <PillButton key={v} label={v} active={styleVibe === v} onClick={() => setStyleVibe(styleVibe === v ? "" : v)} />
                  ))}
                </div>
              </div>

              {/* Color Preference */}
              <div className="mb-8">
                <h3 className="text-sm font-medium text-obsidian mb-3">Color palette you gravitate toward?</h3>
                <div className="flex flex-wrap gap-2">
                  {COLOR_PREFERENCES.map((c) => (
                    <PillButton key={c} label={c} active={colorPref === c} onClick={() => setColorPref(colorPref === c ? "" : c)} />
                  ))}
                </div>
              </div>

              {/* Putter Type */}
              <div className="mb-8">
                <h3 className="text-sm font-medium text-obsidian mb-3">What type of putter do you game?</h3>
                <div className="flex flex-wrap gap-2">
                  {PUTTER_TYPES.map((p) => (
                    <PillButton key={p} label={p} active={putterType === p} onClick={() => setPutterType(putterType === p ? "" : p)} />
                  ))}
                </div>
              </div>

              {/* Brand Interest */}
              <div className="mb-10">
                <h3 className="text-sm font-medium text-obsidian mb-3">Brands you like (pick a few)</h3>
                <div className="flex flex-wrap gap-2">
                  {BRAND_INTEREST.map((b) => (
                    <PillButton key={b} label={b} active={brands.includes(b)} onClick={() => toggleBrand(b)} />
                  ))}
                </div>
              </div>

              <StepNav onBack={() => goTo(3)} onNext={() => goTo(5)} onSkip={() => goTo(5)} />
            </div>
          )}

          {/* ═══════ STEP 5: PLAN SELECTION ═══════ */}
          {step === 5 && (
            <div className={animClass}>
              <span className="inline-flex items-center gap-2 text-xs tracking-[0.3em] uppercase text-sage font-medium mb-4">
                <span className="w-6 h-px bg-sage/50" />
                Your Membership
                <span className="w-6 h-px bg-sage/50" />
              </span>

              <h1 className="font-serif text-3xl text-obsidian leading-tight mb-3">
                Choose your plan.
              </h1>
              <p className="text-sm text-charcoal/45 leading-relaxed mb-8">
                Your new membership takes effect at your next scheduled renewal. Change or cancel anytime.
              </p>

              <div className="space-y-4">
                {/* Reserve Member (Recommended) */}
                <div className="relative">
                  <div className="absolute -top-3 left-6 z-20">
                    <span className="inline-block bg-sage text-bone text-[10px] tracking-[0.2em] uppercase font-semibold px-3 py-1 rounded-full shadow-sm">
                      Recommended
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedPlan("member")}
                    className={`w-full text-left rounded-2xl overflow-hidden relative transition-all duration-300 cursor-pointer ${
                      selectedPlan === "member"
                        ? "ring-2 ring-forest shadow-lg shadow-forest/15"
                        : "ring-1 ring-sage/20 hover:ring-forest/40"
                    }`}
                  >
                    <div className="bg-forest p-6 relative">
                      <span className="text-[11px] tracking-[0.25em] uppercase text-sage font-medium">
                        Reserve Member
                      </span>
                      <div className="mt-2 mb-1">
                        <span className="font-serif text-2xl text-bone">$249</span>
                        <span className="text-bone/45 text-sm ml-1">/quarter</span>
                      </div>
                      <p className="text-xs text-bone/40 mb-4">
                        Curated boxes, concierge access, and the full Reserve experience.
                      </p>
                      <div className="border-t border-bone/10 pt-4">
                        <ul className="space-y-2">
                          <FeatureItem text="Everything in Access" light />
                          <FeatureItem text="Curated member boxes" light />
                          <FeatureItem text="Personalized fit profile" light />
                          <FeatureItem text="Priority release access" light />
                          <FeatureItem text="Concierge booking support" light />
                          <FeatureItem text="Invite-only events" light />
                        </ul>
                      </div>
                      {selectedPlan === "member" && (
                        <div className="absolute top-5 right-5">
                          <CheckCircle className="text-sage" />
                        </div>
                      )}
                    </div>
                  </button>
                </div>

                {/* Reserve Access */}
                <button
                  onClick={() => setSelectedPlan("access")}
                  className={`w-full text-left rounded-2xl p-6 transition-all duration-300 cursor-pointer border ${
                    selectedPlan === "access"
                      ? "border-forest ring-2 ring-forest bg-cream shadow-lg shadow-forest/10"
                      : "border-taupe/20 bg-cream hover:border-forest/40"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[11px] tracking-[0.25em] uppercase text-forest font-medium">
                        Reserve Access
                      </span>
                      <div className="mt-2 mb-4">
                        <span className="font-serif text-2xl text-obsidian">$99</span>
                        <span className="text-charcoal/40 text-sm ml-1">/year</span>
                      </div>
                    </div>
                    {selectedPlan === "access" && <CheckCircle className="text-forest" />}
                  </div>
                  <div className="border-t border-taupe/12 pt-4">
                    <ul className="space-y-2">
                      <FeatureItem text="Reserve pricing unlocked" />
                      <FeatureItem text="Early access to drops" />
                      <FeatureItem text="Free 2-day shipping" />
                      <FeatureItem text="Partner benefit access" />
                    </ul>
                  </div>
                </button>

                {/* Keep Legacy */}
                <button
                  onClick={() => setSelectedPlan("legacy")}
                  className={`w-full text-left rounded-2xl p-6 transition-all duration-300 cursor-pointer border ${
                    selectedPlan === "legacy"
                      ? "border-forest ring-2 ring-forest bg-cream shadow-lg shadow-forest/10"
                      : "border-taupe/20 bg-cream hover:border-forest/40"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[11px] tracking-[0.25em] uppercase text-charcoal/50 font-medium">
                        Keep Current Plan
                      </span>
                      <div className="mt-2">
                        <span className="text-sm text-charcoal/55 leading-relaxed">
                          Continue with your existing legacy subscription at the same rate. No changes to your billing.
                        </span>
                      </div>
                    </div>
                    {selectedPlan === "legacy" && <CheckCircle className="text-forest" />}
                  </div>
                </button>
              </div>

              {/* Nav */}
              <div className="flex items-center justify-between mt-10">
                <button
                  onClick={() => goTo(4)}
                  className="text-sm text-charcoal/40 hover:text-charcoal/60 transition-colors duration-300 cursor-pointer flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  </svg>
                  Back
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={!selectedPlan || isSubmitting}
                  className={`h-12 px-10 rounded-xl text-sm font-medium tracking-wider uppercase transition-all duration-300 btn-press ${
                    selectedPlan && !isSubmitting
                      ? "bg-forest text-bone hover:bg-forest-dark cursor-pointer"
                      : "bg-taupe/25 text-charcoal/30 cursor-not-allowed"
                  }`}
                >
                  {isSubmitting ? "Saving…" : "Confirm"}
                </button>
              </div>
            </div>
          )}

          {/* ═══════ STEP 6: CONFIRMATION ═══════ */}
          {step === 6 && (
            <div className="animate-fade-up text-center pt-8">
              {/* Checkmark */}
              <div className="mx-auto w-16 h-16 rounded-full bg-forest/10 flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <h1 className="font-serif text-3xl text-obsidian leading-tight mb-3">
                You&rsquo;re all set.
              </h1>
              <p className="text-sm text-charcoal/55 leading-relaxed mb-8 max-w-xs mx-auto">
                Thanks for updating your profile.
                {selectedPlan === "legacy"
                  ? " Your current plan will continue as is."
                  : " Your new membership will take effect at your next renewal date."}
              </p>

              {/* Summary card */}
              <div className="bg-cream rounded-2xl p-6 border border-taupe/20 text-left mb-8">
                <h3 className="text-xs tracking-[0.2em] uppercase text-sage font-medium mb-4">Summary</h3>
                <div className="space-y-3 text-sm">
                  {email && (
                    <div className="flex justify-between">
                      <span className="text-charcoal/50">Email</span>
                      <span className="text-obsidian font-medium">{email.trim().toLowerCase()}</span>
                    </div>
                  )}
                  {gender && (
                    <div className="flex justify-between">
                      <span className="text-charcoal/50">Shopping for</span>
                      <span className="text-obsidian font-medium">{gender}</span>
                    </div>
                  )}
                  {shirtSize && (
                    <div className="flex justify-between">
                      <span className="text-charcoal/50">Shirt</span>
                      <span className="text-obsidian font-medium">{shirtSize}</span>
                    </div>
                  )}
                  {gloveHand && (
                    <div className="flex justify-between">
                      <span className="text-charcoal/50">Glove</span>
                      <span className="text-obsidian font-medium">{gloveHand}{gloveSize ? ` / ${gloveSize}` : ""}</span>
                    </div>
                  )}
                  {waistSize && (
                    <div className="flex justify-between">
                      <span className="text-charcoal/50">Waist</span>
                      <span className="text-obsidian font-medium">{waistSize}</span>
                    </div>
                  )}
                  {pantsInseam && (
                    <div className="flex justify-between">
                      <span className="text-charcoal/50">Pants inseam</span>
                      <span className="text-obsidian font-medium">{pantsInseam}</span>
                    </div>
                  )}
                  {shortsInseam && (
                    <div className="flex justify-between">
                      <span className="text-charcoal/50">Shorts inseam</span>
                      <span className="text-obsidian font-medium">{shortsInseam}</span>
                    </div>
                  )}
                  {shoeSize && (
                    <div className="flex justify-between">
                      <span className="text-charcoal/50">Shoe</span>
                      <span className="text-obsidian font-medium">{shoeSize}</span>
                    </div>
                  )}
                  <div className="border-t border-taupe/15 pt-3">
                    <div className="flex justify-between">
                      <span className="text-charcoal/50">Membership</span>
                      <span className="text-obsidian font-medium">
                        {selectedPlan === "member" && "Reserve Member"}
                        {selectedPlan === "access" && "Reserve Access"}
                        {selectedPlan === "legacy" && "Current Plan (No Change)"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* CTA */}
              <a
                href="/login"
                className="inline-flex h-12 px-10 items-center justify-center rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-all duration-300 btn-press"
              >
                Log In &amp; Browse the Clubhouse
              </a>
              <p className="text-xs text-charcoal/35 mt-4">
                Explore the new member experience, shop drops, and connect with the community.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/* ═══════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════ */

function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-6">
      {Array.from({ length: total }, (_, i) => i + 1).map((dot) => (
        <div key={dot} className="flex items-center">
          <div
            className={`w-2 h-2 rounded-full transition-all duration-500 ${
              current >= dot ? "bg-forest" : "bg-taupe/30"
            }`}
          />
          {dot < total && (
            <div className="w-8 h-px mx-1">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  current > dot ? "bg-forest" : "bg-taupe/20"
                }`}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function StepNav({
  onBack,
  onNext,
  onSkip,
  nextLabel,
}: {
  onBack: () => void;
  onNext: () => void;
  onSkip?: () => void;
  nextLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <button
        onClick={onBack}
        className="text-sm text-charcoal/40 hover:text-charcoal/60 transition-colors duration-300 cursor-pointer flex items-center gap-1.5"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Back
      </button>
      <div className="flex items-center gap-4">
        {onSkip && (
          <button
            onClick={onSkip}
            className="text-sm text-charcoal/40 hover:text-charcoal/60 transition-colors duration-300 cursor-pointer"
          >
            Skip
          </button>
        )}
        <button
          onClick={onNext}
          className="h-11 px-8 rounded-xl text-sm font-medium tracking-wider uppercase transition-all duration-300 cursor-pointer btn-press bg-forest text-bone hover:bg-forest-dark"
        >
          {nextLabel || "Next"}
        </button>
      </div>
    </div>
  );
}

function FeatureItem({ text, light }: { text: string; light?: boolean }) {
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

function CheckCircle({ className }: { className?: string }) {
  return (
    <svg className={`w-6 h-6 shrink-0 ${className || ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
