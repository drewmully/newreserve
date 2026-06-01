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
 *   3. Your members      (size breakdown, demographic, brands worn)
 *   4. Your storefront   (logo upload, accent color, storefront preference)
 *   5. Confirm & pay     (review → POST /checkout → window.location to Shopify)
 *
 * Every "Continue" click POSTs to /api/simulatorclubs/apply with the current
 * step number. The server upserts by email so partial leads are captured even
 * if the user bails after step 1.
 *
 * Use the parent controller via the `open` and `onClose` props.
 */

type SizeBreakdown = Record<"XS" | "S" | "M" | "L" | "XL" | "XXL", number>;

const DEFAULT_SIZES: SizeBreakdown = {
  XS: 5,
  S: 15,
  M: 35,
  L: 30,
  XL: 12,
  XXL: 3,
};

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
  memberCountRange: string;
  staffingType: string;
  currentMerch: string;
  // Step 3
  sizeBreakdown: SizeBreakdown;
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
  memberCountRange: "",
  staffingType: "",
  currentMerch: "",
  sizeBreakdown: { ...DEFAULT_SIZES },
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
  }, []);

  const updateSize = useCallback((size: keyof SizeBreakdown, value: number) => {
    setForm((prev) => ({
      ...prev,
      sizeBreakdown: { ...prev.sizeBreakdown, [size]: value },
    }));
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

  const sizeTotal = useMemo(
    () => Object.values(form.sizeBreakdown).reduce((acc, n) => acc + n, 0),
    [form.sizeBreakdown]
  );

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
          memberCountRange: form.memberCountRange,
          staffingType: form.staffingType,
          currentMerch: form.currentMerch,
        });
      }
      if (currentStep >= 3) {
        Object.assign(base, {
          sizeBreakdown: form.sizeBreakdown,
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

  // Step validation - guards the Continue button
  const stepValid = useMemo(() => {
    switch (step) {
      case 1:
        return Boolean(
          form.clubName.trim() &&
            form.contactName.trim() &&
            form.phone.trim() &&
            form.email.trim() &&
            form.email.includes("@") &&
            form.city.trim() &&
            form.state.trim()
        );
      case 2:
        return Boolean(
          form.bayCount &&
            form.memberCountRange &&
            form.staffingType &&
            form.currentMerch
        );
      case 3:
        return Boolean(
          form.memberDemographic && sizeTotal >= 95 && sizeTotal <= 105
        );
      case 4:
        return Boolean(form.accentColor && form.wantsStorefront);
      case 5:
        return true;
      default:
        return false;
    }
  }, [step, form, sizeTotal]);

  const handleContinue = useCallback(async () => {
    if (!stepValid || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await persistStep(step);
      setStep((s) => Math.min(5, s + 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }, [step, stepValid, submitting, persistStep]);

  const handleBack = useCallback(() => {
    setError(null);
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
            <Step1 form={form} update={update} />
          )}
          {step === 2 && (
            <Step2 form={form} update={update} />
          )}
          {step === 3 && (
            <Step3
              form={form}
              update={update}
              updateSize={updateSize}
              toggleBrand={toggleBrand}
              sizeTotal={sizeTotal}
            />
          )}
          {step === 4 && (
            <Step4
              form={form}
              update={update}
              uploadingLogo={uploadingLogo}
              onLogoSelect={handleLogoUpload}
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
              disabled={!stepValid || submitting}
              className="inline-flex items-center justify-center h-11 px-7 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

function Step1({
  form,
  update,
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
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
            className={inputCls}
            value={form.clubName}
            onChange={(e) => update("clubName", e.target.value)}
            placeholder="The Bay Club"
          />
        </div>
        <div>
          <Label required>Your name</Label>
          <input
            className={inputCls}
            value={form.contactName}
            onChange={(e) => update("contactName", e.target.value)}
            placeholder="Jordan Smith"
          />
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
            className={inputCls}
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            placeholder="(555) 555-5555"
          />
          <p className="text-[11px] text-charcoal/45 mt-1.5 leading-relaxed">
            We will call to confirm your kit details.
          </p>
        </div>
        <div className="sm:col-span-2">
          <Label required>Email</Label>
          <input
            type="email"
            className={inputCls}
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            placeholder="you@yourclub.com"
            autoComplete="email"
          />
        </div>
        <div>
          <Label required>City</Label>
          <input
            className={inputCls}
            value={form.city}
            onChange={(e) => update("city", e.target.value)}
            placeholder="Detroit"
          />
        </div>
        <div>
          <Label required>State</Label>
          <input
            className={inputCls}
            value={form.state}
            onChange={(e) => update("state", e.target.value)}
            placeholder="MI"
          />
        </div>
      </div>
    </div>
  );
}

function Step2({
  form,
  update,
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <Label required>Number of simulator bays</Label>
          <input
            type="number"
            min={1}
            className={inputCls}
            value={form.bayCount}
            onChange={(e) => update("bayCount", e.target.value)}
            placeholder="4"
          />
        </div>
        <div>
          <Label required>Approximate member count</Label>
          <select
            className={selectCls}
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
        </div>
        <div>
          <Label required>Is your club staffed or self-serve?</Label>
          <select
            className={selectCls}
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
        </div>
        <div>
          <Label required>Do you currently sell any merchandise?</Label>
          <select
            className={selectCls}
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
        </div>
      </div>
    </div>
  );
}

function Step3({
  form,
  update,
  updateSize,
  toggleBrand,
  sizeTotal,
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  updateSize: (size: keyof SizeBreakdown, value: number) => void;
  toggleBrand: (brand: string) => void;
  sizeTotal: number;
}) {
  const sizes: (keyof SizeBreakdown)[] = ["XS", "S", "M", "L", "XL", "XXL"];
  const totalOk = sizeTotal >= 95 && sizeTotal <= 105;
  return (
    <div className="space-y-7">
      <div>
        <Label required>How do your members generally size?</Label>
        <p className="text-[11px] text-charcoal/55 mb-3 leading-relaxed">
          Move the sliders so the percentages sum to roughly 100%. We use this
          to size your first box.
        </p>
        <div className="space-y-3">
          {sizes.map((size) => (
            <div key={size} className="flex items-center gap-4">
              <span className="font-serif text-sm text-obsidian w-10 tabular-nums">{size}</span>
              <input
                type="range"
                min={0}
                max={70}
                step={1}
                value={form.sizeBreakdown[size]}
                onChange={(e) => updateSize(size, Number(e.target.value))}
                className="flex-1 accent-forest cursor-pointer"
                aria-label={`${size} percentage`}
              />
              <span className="text-sm text-charcoal tabular-nums w-12 text-right">
                {form.sizeBreakdown[size]}%
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between text-[11px]">
          <span className="text-charcoal/55">Total</span>
          <span
            className={`tabular-nums font-medium ${
              totalOk ? "text-forest" : "text-ember"
            }`}
          >
            {sizeTotal}% {totalOk ? "✓" : "(aim for ~100%)"}
          </span>
        </div>
      </div>

      <div>
        <Label required>Primary member demographic</Label>
        <select
          className={selectCls}
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
      </div>

      <div>
        <Label>What brands do your members already wear?</Label>
        <p className="text-[11px] text-charcoal/55 mb-3 leading-relaxed">
          Select all that apply. Helps us tune the box to their taste.
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
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  uploadingLogo: boolean;
  onLogoSelect: (file: File) => void;
}) {
  return (
    <div className="space-y-7">
      <div>
        <Label>Club logo</Label>
        <p className="text-[11px] text-charcoal/55 mb-3 leading-relaxed">
          We use this for your laser-cut signage and the "Powered by Mully" acrylic.
          PNG, JPG, WebP, or SVG. Max 5 MB.
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
        <div className="grid grid-cols-5 gap-2">
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
      </div>

      <div>
        <Label required>Do you want us to set up your online storefront?</Label>
        <p className="text-[11px] text-charcoal/55 mb-3 leading-relaxed">
          Branded online store, dropshipped from Mully. You earn 25% commission on every sale.
        </p>
        <div className="grid sm:grid-cols-2 gap-2">
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
  const rows: Array<[string, string]> = [
    ["Club", form.clubName || "-"],
    ["Contact", `${form.contactName}${form.contactTitle ? `, ${form.contactTitle}` : ""}`],
    ["Phone", form.phone || "-"],
    ["Email", form.email || "-"],
    ["Location", `${form.city}, ${form.state}`],
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
          Your Q1 kit
        </p>
        <p className="font-serif text-2xl md:text-3xl leading-tight mb-2">
          Ships in 1 to 2 weeks
        </p>
        <p className="text-sm text-bone/75 leading-relaxed">
          Quarterly billing of $2,000 begins at shipment. Cancel anytime.
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
