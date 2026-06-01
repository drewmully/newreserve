"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * StarterKitOnboarding
 *
 * Multi-step modal triggered by "Apply for a founding kit" CTAs.
 *
 * Steps:
 *   1. Club basics       (club name, contact, phone, email, city/state)
 *   2. Your club         (bays, member count, staffing, current merch)
 *   3. Your members      (demographic, brands worn)
 *   4. Your storefront   (optional logo upload, accent color, storefront preference)
 *   5. Confirm & pay     (review → POST /checkout → window.location to Shopify)
 *
 * Every "Continue" click POSTs to /api/simulatorclubs/apply with the current
 * step number. The server upserts by email so partial leads are captured even
 * if the user bails after step 1.
 *
 * Use the parent controller via the `open` and `onClose` props.
 */

const BRAND_OPTIONS = [
  "Rhone",
  "Greyson",
  "Quiet Golf",
  "Lululemon",
  "Peter Millar",
  "TravisMathew",
  "Patagonia",
  "Other",
] as const;

const MEMBER_COUNT_OPTIONS = [
  { value: "under_50", label: "Under 50" },
  { value: "50_to_150", label: "50 to 150" },
  { value: "150_to_300", label: "150 to 300" },
  { value: "300_plus", label: "300 plus" },
];

const STAFFING_OPTIONS = [
  { value: "staffed", label: "Staffed" },
  { value: "self_serve", label: "Self-serve" },
  { value: "hybrid", label: "Hybrid" },
];

const CURRENT_MERCH_OPTIONS = [
  { value: "none", label: "None" },
  { value: "hats_logo", label: "Hats and logo items only" },
  { value: "curated", label: "Small curated selection" },
];

const DEMO_OPTIONS = [
  { value: "young_professionals", label: "Young professionals" },
  { value: "mixed_age", label: "Mixed age" },
  { value: "40_plus", label: "40 plus" },
  { value: "corporate", label: "Corporate" },
];

const ACCENT_COLORS = [
  { value: "forest_green", label: "Forest green", swatch: "#1F3D2B" },
  { value: "charcoal", label: "Charcoal", swatch: "#2A2A2A" },
  { value: "navy", label: "Navy", swatch: "#1A2A44" },
  { value: "white", label: "White", swatch: "#F5F1E8" },
  { value: "black", label: "Black", swatch: "#0A0A0A" },
];

interface FormState {
  // Step 1
  clubName: string;
  contactName: string;
  contactTitle: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  // Step 2
  bayCount: string;
  locationCount: string;
  memberCountRange: string;
  staffingType: string;
  currentMerch: string;
  // Step 3
  memberDemographic: string;
  brandsWorn: string[];
  // Step 4
  logoUrl: string;
  logoFileName: string;
  accentColor: string;
  wantsStorefront: "" | "yes" | "not_yet";
  clubWebsite: string;
  emailListSize: string;
}

const INITIAL_FORM: FormState = {
  clubName: "",
  contactName: "",
  contactTitle: "",
  phone: "",
  email: "",
  city: "",
  state: "",
  bayCount: "",
  locationCount: "1",
  memberCountRange: "",
  staffingType: "",
  currentMerch: "",
  memberDemographic: "",
  brandsWorn: [],
  logoUrl: "",
  logoFileName: "",
  accentColor: "",
  wantsStorefront: "",
  clubWebsite: "",
  emailListSize: "",
};

const STEP_LABELS = [
  "Club basics",
  "Your club",
  "Your members",
  "Your storefront",
  "Confirm and pay",
] as const;

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function StarterKitOnboarding({ open, onClose }: Props) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [applicationId, setApplicationId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const dialogRef = useRef<HTMLDivElement>(null);

  // Lock body scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear field error as soon as the user starts entering a value
    setFieldErrors((prev) => {
      if (!prev[key as string]) return prev;
      const next = { ...prev };
      delete next[key as string];
      return next;
    });
  }, []);

  const toggleBrand = useCallback((brand: string) => {
    setForm((prev) => {
      const exists = prev.brandsWorn.includes(brand);
      return {
        ...prev,
        brandsWorn: exists
          ? prev.brandsWorn.filter((b) => b !== brand)
          : [...prev.brandsWorn, brand],
      };
    });
  }, []);

  /** Build the JSON payload for /api/simulatorclubs/apply at a given step. */
  const buildApplyPayload = useCallback(
    (currentStep: number): Record<string, unknown> => {
      const base: Record<string, unknown> = {
        email: form.email,
        step: currentStep,
      };
      if (currentStep >= 1) {
        Object.assign(base, {
          clubName: form.clubName,
          contactName: form.contactName,
          contactTitle: form.contactTitle,
          phone: form.phone,
          city: form.city,
          state: form.state,
        });
      }
      if (currentStep >= 2) {
        Object.assign(base, {
          bayCount: form.bayCount,
          locationCount: form.locationCount,
          memberCountRange: form.memberCountRange,
          staffingType: form.staffingType,
          currentMerch: form.currentMerch,
        });
      }
      if (currentStep >= 3) {
        Object.assign(base, {
          memberDemographic: form.memberDemographic,
          brandsWorn: form.brandsWorn,
        });
      }
      if (currentStep >= 4) {
        Object.assign(base, {
          logoUrl: form.logoUrl,
          accentColor: form.accentColor,
          wantsStorefront: form.wantsStorefront === "yes",
          clubWebsite: form.clubWebsite,
          emailListSize: form.emailListSize,
        });
      }
      return base;
    },
    [form]
  );

  const persistStep = useCallback(
    async (currentStep: number) => {
      const res = await fetch("/api/simulatorclubs/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildApplyPayload(currentStep)),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Save failed (HTTP ${res.status})`);
      }
      const data = await res.json();
      if (typeof data.id === "number") {
        setApplicationId(data.id);
      }
      return data;
    },
    [buildApplyPayload]
  );

  /**
   * Validate the current step. Returns a map of fieldKey -> human-friendly error
   * message. Empty object means the step is valid and the user can continue.
   */
  const validateStep = useCallback(
    (currentStep: number): Record<string, string> => {
      const errs: Record<string, string> = {};
      const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

      if (currentStep === 1) {
        if (!form.clubName.trim()) errs.clubName = "Add your club name.";
        if (!form.contactName.trim()) errs.contactName = "Tell us who you are.";
        if (!form.phone.trim()) errs.phone = "Add a phone number so we can call.";
        if (!form.email.trim()) errs.email = "Add your email.";
        else if (!isEmail(form.email)) errs.email = "That email does not look right.";
        if (!form.city.trim()) errs.city = "Add your city.";
        if (!form.state.trim()) errs.state = "Add your state.";
      }
      if (currentStep === 2) {
        if (!form.bayCount) errs.bayCount = "How many simulator bays do you have?";
        const loc = parseInt(form.locationCount, 10);
        if (!form.locationCount || !Number.isFinite(loc) || loc < 1) {
          errs.locationCount = "How many locations are you ordering for?";
        } else if (loc > 25) {
          errs.locationCount = "For 25 or more locations, email drew@mymully.com so we can set you up directly.";
        }
        if (!form.memberCountRange) errs.memberCountRange = "Pick a member count range.";
        if (!form.staffingType) errs.staffingType = "Pick how the club is staffed.";
        if (!form.currentMerch) errs.currentMerch = "Pick what you sell today.";
      }
      if (currentStep === 3) {
        if (!form.memberDemographic)
          errs.memberDemographic = "Pick the closest match for your members.";
      }
      if (currentStep === 4) {
        if (!form.accentColor) errs.accentColor = "Pick an accent color.";
        if (!form.wantsStorefront)
          errs.wantsStorefront = "Let us know if you want the online storefront.";
      }
      return errs;
    },
    [form]
  );

  // For disabling the Continue button visual state (no error surfacing until click)
  const stepValid = useMemo(
    () => Object.keys(validateStep(step)).length === 0,
    [step, validateStep]
  );

  const handleContinue = useCallback(async () => {
    if (submitting) return;
    const errs = validateStep(step);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setError("Please complete the highlighted fields before continuing.");
      return;
    }
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      await persistStep(step);
      setStep((s) => Math.min(5, s + 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }, [step, submitting, persistStep, validateStep]);

  const handleBack = useCallback(() => {
    setError(null);
    setFieldErrors({});
    setStep((s) => Math.max(1, s - 1));
  }, []);

  const handleLogoUpload = useCallback(
    async (file: File) => {
      if (!form.email.trim()) {
        setError("Please complete step 1 first so we know who you are.");
        return;
      }
      setError(null);
      setUploadingLogo(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("email", form.email);
        const res = await fetch("/api/simulatorclubs/upload-logo", {
          method: "POST",
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Upload failed");
        setForm((prev) => ({
          ...prev,
          logoUrl: data.url,
          logoFileName: file.name,
        }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setUploadingLogo(false);
      }
    },
    [form.email]
  );

  const handleSubmitFinal = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      // 1. Persist step 5 first (without checkout URL).
      await persistStep(5);

      // 2. Ask the server to create the Shopify cart and return the URL.
      const res = await fetch("/api/simulatorclubs/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          applicationId,
          clubName: form.clubName,
          locationCount: parseInt(form.locationCount, 10) || 1,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not start checkout.");

      // 3. Save the checkout URL on the Supabase row.
      await fetch("/api/simulatorclubs/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          step: 5,
          shopifyCheckoutUrl: data.checkoutUrl,
        }),
      });

      // 4. Send the buyer to Shopify.
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }, [form.email, form.clubName, applicationId, persistStep]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Apply for a Mully Starter Kit"
      className="fixed inset-0 z-[100] flex items-stretch md:items-center justify-center bg-charcoal/80 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="relative w-full md:max-w-2xl bg-bone md:my-8 md:rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 md:px-8 py-5 border-b border-taupe/15">
          <div>
            <p className="text-[10px] tracking-[0.32em] uppercase text-sage font-medium">
              Step {step} of 5
            </p>
            <h2 className="font-serif text-xl md:text-2xl text-forest mt-1">
              {STEP_LABELS[step - 1]}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center text-charcoal/60 hover:bg-cream hover:text-charcoal transition-colors"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-cream">
          <div
            className="h-full bg-forest transition-all duration-300"
            style={{ width: `${(step / 5) * 100}%` }}
          />
        </div>

        {/* Body */}
        <div className="px-6 md:px-8 py-7 md:py-9 flex-1 overflow-y-auto">
          {step === 1 && (
            <Step1 form={form} update={update} errors={fieldErrors} />
          )}
          {step === 2 && (
            <Step2 form={form} update={update} errors={fieldErrors} />
          )}
          {step === 3 && (
            <Step3
              form={form}
              update={update}
              toggleBrand={toggleBrand}
              errors={fieldErrors}
            />
          )}
          {step === 4 && (
            <Step4
              form={form}
              update={update}
              uploadingLogo={uploadingLogo}
              onLogoSelect={handleLogoUpload}
              errors={fieldErrors}
            />
          )}
          {step === 5 && <Step5 form={form} />}

          {error ? (
            <p className="mt-5 text-sm text-ember bg-ember/10 border border-ember/30 rounded-lg px-4 py-3">
              {error}
            </p>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-6 md:px-8 py-5 border-t border-taupe/15 bg-cream flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
          <button
            type="button"
            onClick={step === 1 ? onClose : handleBack}
            disabled={submitting}
            className="text-sm text-charcoal/60 hover:text-forest tracking-wider uppercase disabled:opacity-50"
          >
            {step === 1 ? "Cancel" : "← Back"}
          </button>
          {step < 5 ? (
            <button
              type="button"
              onClick={handleContinue}
              disabled={submitting}
              aria-disabled={!stepValid}
              className={`inline-flex items-center justify-center h-11 px-7 rounded-xl text-sm font-medium tracking-wider uppercase transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                stepValid
                  ? "bg-forest text-bone hover:bg-forest-dark"
                  : "bg-forest/55 text-bone hover:bg-forest"
              }`}
            >
              {submitting ? "Saving…" : "Continue"}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmitFinal}
              disabled={submitting}
              className="inline-flex items-center justify-center h-11 px-7 rounded-xl bg-ember text-forest-dark text-sm font-semibold tracking-wider uppercase hover:bg-ember/90 transition-colors disabled:opacity-50"
            >
              {submitting ? "Starting checkout…" : "Confirm and continue to checkout"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-[11px] tracking-[0.24em] uppercase text-sage font-medium mb-2">
      {children}
      {required ? <span className="text-ember ml-1">*</span> : null}
    </label>
  );
}

const inputCls =
  "w-full h-11 px-3.5 rounded-lg bg-bone border border-taupe/30 text-sm text-charcoal placeholder:text-charcoal/35 focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest/30 transition-colors";
const selectCls =
  "w-full h-11 px-3 rounded-lg bg-bone border border-taupe/30 text-sm text-charcoal focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest/30 transition-colors";
const errorInputCls =
  "w-full h-11 px-3.5 rounded-lg bg-ember/5 border border-ember/60 text-sm text-charcoal placeholder:text-charcoal/35 focus:border-ember focus:outline-none focus:ring-1 focus:ring-ember/30 transition-colors";
const errorSelectCls =
  "w-full h-11 px-3 rounded-lg bg-ember/5 border border-ember/60 text-sm text-charcoal focus:border-ember focus:outline-none focus:ring-1 focus:ring-ember/30 transition-colors";

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <p className="text-[11px] text-ember mt-1.5 leading-snug">{msg}</p>
  );
}

const cn = (base: string, err: string, hasError: boolean) =>
  hasError ? err : base;

function Step1({
  form,
  update,
  errors,
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-charcoal/65 leading-relaxed">
        Two-minute application. We will call within one business day to confirm
        your kit details before anything ships.
      </p>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <Label required>Club name</Label>
          <input
            className={cn(inputCls, errorInputCls, !!errors.clubName)}
            value={form.clubName}
            onChange={(e) => update("clubName", e.target.value)}
            placeholder="The Bay Club"
          />
          <FieldError msg={errors.clubName} />
        </div>
        <div>
          <Label required>Your name</Label>
          <input
            className={cn(inputCls, errorInputCls, !!errors.contactName)}
            value={form.contactName}
            onChange={(e) => update("contactName", e.target.value)}
            placeholder="Jordan Smith"
          />
          <FieldError msg={errors.contactName} />
        </div>
        <div>
          <Label>Title</Label>
          <input
            className={inputCls}
            value={form.contactTitle}
            onChange={(e) => update("contactTitle", e.target.value)}
            placeholder="General Manager"
          />
        </div>
        <div>
          <Label required>Phone</Label>
          <input
            type="tel"
            className={cn(inputCls, errorInputCls, !!errors.phone)}
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            placeholder="(555) 555-5555"
          />
          {errors.phone ? (
            <FieldError msg={errors.phone} />
          ) : (
            <p className="text-[11px] text-charcoal/45 mt-1.5 leading-relaxed">
              We will call to confirm your kit details.
            </p>
          )}
        </div>
        <div className="sm:col-span-2">
          <Label required>Email</Label>
          <input
            type="email"
            className={cn(inputCls, errorInputCls, !!errors.email)}
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            placeholder="you@yourclub.com"
            autoComplete="email"
          />
          <FieldError msg={errors.email} />
        </div>
        <div>
          <Label required>City</Label>
          <input
            className={cn(inputCls, errorInputCls, !!errors.city)}
            value={form.city}
            onChange={(e) => update("city", e.target.value)}
            placeholder="Detroit"
          />
          <FieldError msg={errors.city} />
        </div>
        <div>
          <Label required>State</Label>
          <input
            className={cn(inputCls, errorInputCls, !!errors.state)}
            value={form.state}
            onChange={(e) => update("state", e.target.value)}
            placeholder="MI"
          />
          <FieldError msg={errors.state} />
        </div>
      </div>
    </div>
  );
}

function Step2({
  form,
  update,
  errors,
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <Label required>Number of simulator bays</Label>
          <input
            type="number"
            min={1}
            className={cn(inputCls, errorInputCls, !!errors.bayCount)}
            value={form.bayCount}
            onChange={(e) => update("bayCount", e.target.value)}
            placeholder="4"
          />
          <FieldError msg={errors.bayCount} />
        </div>
        <div>
          <Label required>Number of locations</Label>
          <input
            type="number"
            min={1}
            max={25}
            step={1}
            className={cn(inputCls, errorInputCls, !!errors.locationCount)}
            value={form.locationCount}
            onChange={(e) => update("locationCount", e.target.value)}
            placeholder="1"
          />
          <p className="mt-1.5 text-[11px] text-charcoal/55 leading-relaxed">
            One kit per location. All kits ship to one address; you distribute internally.
          </p>
          <FieldError msg={errors.locationCount} />
        </div>
        <div>
          <Label required>Approximate member count</Label>
          <select
            className={cn(selectCls, errorSelectCls, !!errors.memberCountRange)}
            value={form.memberCountRange}
            onChange={(e) => update("memberCountRange", e.target.value)}
          >
            <option value="">Select one…</option>
            {MEMBER_COUNT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <FieldError msg={errors.memberCountRange} />
        </div>
        <div>
          <Label required>Is your club staffed or self-serve?</Label>
          <select
            className={cn(selectCls, errorSelectCls, !!errors.staffingType)}
            value={form.staffingType}
            onChange={(e) => update("staffingType", e.target.value)}
          >
            <option value="">Select one…</option>
            {STAFFING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <FieldError msg={errors.staffingType} />
        </div>
        <div>
          <Label required>Do you currently sell any merchandise?</Label>
          <select
            className={cn(selectCls, errorSelectCls, !!errors.currentMerch)}
            value={form.currentMerch}
            onChange={(e) => update("currentMerch", e.target.value)}
          >
            <option value="">Select one…</option>
            {CURRENT_MERCH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <FieldError msg={errors.currentMerch} />
        </div>
      </div>
    </div>
  );
}

function Step3({
  form,
  update,
  toggleBrand,
  errors,
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  toggleBrand: (brand: string) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="space-y-7">
      <p className="text-sm text-charcoal/65 leading-relaxed">
        Two quick questions to help us tune your starter assortment to the people walking through your bays.
      </p>

      <div>
        <Label required>Primary member demographic</Label>
        <select
          className={cn(selectCls, errorSelectCls, !!errors.memberDemographic)}
          value={form.memberDemographic}
          onChange={(e) => update("memberDemographic", e.target.value)}
        >
          <option value="">Select one…</option>
          {DEMO_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <FieldError msg={errors.memberDemographic} />
      </div>

      <div>
        <Label>What brands do your members already wear?</Label>
        <p className="text-[11px] text-charcoal/55 mb-3 leading-relaxed">
          Select all that apply. Helps us tune the assortment to their taste. Optional.
        </p>
        <div className="flex flex-wrap gap-2">
          {BRAND_OPTIONS.map((brand) => {
            const active = form.brandsWorn.includes(brand);
            return (
              <button
                key={brand}
                type="button"
                onClick={() => toggleBrand(brand)}
                className={`px-3.5 py-2 rounded-lg text-xs tracking-wider transition-colors ${
                  active
                    ? "bg-forest text-bone border border-forest"
                    : "bg-bone text-charcoal/70 border border-taupe/30 hover:border-forest/40 hover:text-forest"
                }`}
              >
                {brand}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Step4({
  form,
  update,
  uploadingLogo,
  onLogoSelect,
  errors,
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  uploadingLogo: boolean;
  onLogoSelect: (file: File) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="space-y-7">
      <div>
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <Label>Club logo</Label>
          <span className="text-[10px] tracking-[0.24em] uppercase text-charcoal/50">
            Optional
          </span>
        </div>
        <p className="text-[11px] text-charcoal/55 mb-3 leading-relaxed">
          Used for your laser-cut signage. Skip this if you would rather send it to us later by email. PNG, JPG, WebP, or SVG. Max 5 MB.
        </p>
        <label className="flex items-center justify-between gap-4 h-14 px-4 rounded-lg border border-dashed border-taupe/40 hover:border-forest/40 hover:bg-cream cursor-pointer transition-colors">
          <span className="text-sm text-charcoal/70 truncate">
            {uploadingLogo
              ? "Uploading…"
              : form.logoFileName
              ? form.logoFileName
              : "Choose a file"}
          </span>
          <span className="text-xs tracking-wider uppercase text-forest font-medium shrink-0">
            {form.logoUrl ? "Replace" : "Upload"}
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onLogoSelect(f);
            }}
          />
        </label>
        {form.logoUrl ? (
          <p className="text-[11px] text-forest mt-2">✓ Logo saved to your application.</p>
        ) : null}
      </div>

      <div>
        <Label required>Preferred accent color for signage</Label>
        <div
          className={`grid grid-cols-5 gap-2 ${
            errors.accentColor ? "p-2 -m-2 rounded-lg bg-ember/5" : ""
          }`}
        >
          {ACCENT_COLORS.map((c) => {
            const active = form.accentColor === c.value;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => update("accentColor", c.value)}
                className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-colors ${
                  active
                    ? "border-forest bg-cream"
                    : "border-taupe/25 hover:border-forest/40"
                }`}
                aria-pressed={active}
              >
                <span
                  className="w-8 h-8 rounded-full border border-taupe/25"
                  style={{ backgroundColor: c.swatch }}
                />
                <span className="text-[10px] tracking-wider uppercase text-charcoal/75 text-center leading-tight">
                  {c.label}
                </span>
              </button>
            );
          })}
        </div>
        <FieldError msg={errors.accentColor} />
      </div>

      <div>
        <Label required>Do you want us to set up your online storefront?</Label>
        <p className="text-[11px] text-charcoal/55 mb-3 leading-relaxed">
          Branded online store, dropshipped from Mully. You earn 25% commission on every sale.
        </p>
        <div
          className={`grid sm:grid-cols-2 gap-2 ${
            errors.wantsStorefront ? "p-2 -m-2 rounded-lg bg-ember/5" : ""
          }`}
        >
          {[
            { value: "yes", label: "Yes, set it up" },
            { value: "not_yet", label: "Not yet" },
          ].map((o) => {
            const active = form.wantsStorefront === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => update("wantsStorefront", o.value as "yes" | "not_yet")}
                className={`h-11 px-4 rounded-lg text-sm tracking-wider transition-colors ${
                  active
                    ? "bg-forest text-bone border border-forest"
                    : "bg-bone text-charcoal/70 border border-taupe/30 hover:border-forest/40 hover:text-forest"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <FieldError msg={errors.wantsStorefront} />
      </div>

      {form.wantsStorefront === "yes" ? (
        <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-taupe/15">
          <div>
            <Label>Club website</Label>
            <input
              type="url"
              className={inputCls}
              value={form.clubWebsite}
              onChange={(e) => update("clubWebsite", e.target.value)}
              placeholder="https://yourclub.com"
            />
          </div>
          <div>
            <Label>Member email list size</Label>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={form.emailListSize}
              onChange={(e) => update("emailListSize", e.target.value)}
              placeholder="250"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Step5({ form }: { form: FormState }) {
  const locations = Math.max(1, parseInt(form.locationCount, 10) || 1);
  const firstQuarterTotal = locations * 2000;
  const rows: Array<[string, string]> = [
    ["Club", form.clubName || "-"],
    ["Contact", `${form.contactName}${form.contactTitle ? `, ${form.contactTitle}` : ""}`],
    ["Phone", form.phone || "-"],
    ["Email", form.email || "-"],
    ["Location", `${form.city}, ${form.state}`],
    ["Locations / kits", String(locations)],
    ["Simulator bays", form.bayCount || "-"],
    [
      "Member count",
      MEMBER_COUNT_OPTIONS.find((o) => o.value === form.memberCountRange)?.label || "-",
    ],
    [
      "Staffing",
      STAFFING_OPTIONS.find((o) => o.value === form.staffingType)?.label || "-",
    ],
    [
      "Demographic",
      DEMO_OPTIONS.find((o) => o.value === form.memberDemographic)?.label || "-",
    ],
    [
      "Brands worn",
      form.brandsWorn.length ? form.brandsWorn.join(", ") : "-",
    ],
    [
      "Accent color",
      ACCENT_COLORS.find((c) => c.value === form.accentColor)?.label || "-",
    ],
    ["Online storefront", form.wantsStorefront === "yes" ? "Yes" : "Not yet"],
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-forest text-bone p-6">
        <p className="text-[10px] tracking-[0.32em] uppercase text-ember font-medium mb-3">
          Your Q1 order
        </p>
        <p className="font-serif text-2xl md:text-3xl leading-tight mb-2">
          {locations === 1
            ? "1 kit, ships in 1 to 2 weeks"
            : `${locations} kits, ship in 1 to 2 weeks`}
        </p>
        <p className="text-sm text-bone/75 leading-relaxed">
          {locations === 1 ? (
            <>Quarterly billing of $2,000 begins at shipment. Cancel anytime.</>
          ) : (
            <>
              {locations} × $2,000 = ${firstQuarterTotal.toLocaleString()} billed at shipment, then
              every quarter. All kits ship to one address. Cancel anytime.
            </>
          )}
        </p>
      </div>

      <dl className="rounded-xl border border-taupe/20 bg-cream divide-y divide-taupe/15 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-start justify-between gap-4 px-4 py-3">
            <dt className="text-[11px] tracking-[0.24em] uppercase text-sage font-medium">{k}</dt>
            <dd className="text-charcoal text-right">{v}</dd>
          </div>
        ))}
      </dl>

      <p className="text-[11px] text-charcoal/55 leading-relaxed">
        Next: secure your kit through Shopify checkout. We will email a receipt
        and call within one business day to walk through next steps.
      </p>
    </div>
  );
}
