"use client";

/**
 * Consult LP launcher — opens a two-phase modal for /lp/consult visitors:
 *
 *   Phase A: "Step 0" onboarding screen. Name + phone + TCPA-compliant
 *            consent checkbox + a small Martine intro card. This is the
 *            screen we optimize the Meta campaign against — the `Lead`
 *            standard event fires the moment the visitor completes this
 *            step (client-side fbq mirror + server-side CAPI via
 *            /api/consult).
 *
 *   Phase B: The standard style quiz (<QuizModal source="lp_consult">),
 *            which then completes into the reveal + checkout flow that
 *            /lp/subscription uses today.
 *
 * We keep the existing shared QuizModal untouched so we do NOT put the
 * subscription funnel at risk while shipping this. The consult flow is
 * additive: a phone-capture screen in front of the same quiz component.
 */

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { QuizModal } from "./QuizModal";
import { trackEvent, getClientAnonymousId } from "@/lib/tracking";
import { captureAttributionFromUrl } from "@/lib/attribution";

// ---- Constants ------------------------------------------------------------

/**
 * The exact consent text the visitor agrees to when they tick the box.
 *
 * TCPA-compliant checklist per the sources Drew cited:
 *   1. Explicit consent — "I agree to receive text messages from Mully…"
 *   2. Message frequency — "up to ~4 messages/month"
 *   3. Fee disclosure — "Msg & data rates may apply."
 *   4. Opt-out — "Reply STOP to cancel."
 *   5. Links to Privacy Policy + Terms of Service (rendered adjacent).
 *
 * Kept verbatim as CONSENT_TEXT so the exact string we ship to the SMS
 * agent as the audit-trail record matches what the visitor actually saw.
 */
const CONSENT_TEXT =
  "I agree to receive text messages from Mully at the number above, including from our head stylist Martine, about my membership, orders, and fit. Message frequency varies (typically up to ~4 messages/month). Msg & data rates may apply. Reply STOP to cancel or HELP for help. Consent is not a condition of any purchase.";

// Route names must match actual pages under src/app/policies/. See
// next build output for the canonical list.
const PRIVACY_URL = "/policies/privacy";
const TERMS_URL = "/policies/terms";

// ---- Types ----------------------------------------------------------------

export interface ConsultOnboardingLauncherProps {
  /** Visual style of the trigger button. */
  variant?: "primary-large" | "primary-pill";
  /** CTA label override. */
  label?: string;
  /** Analytics source identifier. */
  source?: string;
  className?: string;
}

// ---- Launcher (renders trigger button + overlay) --------------------------

export function ConsultOnboardingLauncher({
  variant = "primary-large",
  label,
  source = "lp_consult",
  className,
}: ConsultOnboardingLauncherProps) {
  const [open, setOpen] = useState(false);

  const buttonClass = (() => {
    switch (variant) {
      case "primary-large":
        return "w-full bg-ember hover:bg-ember/90 text-bone py-3.5 rounded-md text-sm font-medium tracking-wide transition cursor-pointer";
      case "primary-pill":
        return "bg-ember hover:bg-ember/90 text-bone py-3.5 px-10 rounded-md text-sm font-medium tracking-wide transition cursor-pointer";
    }
  })();

  const openModal = useCallback(() => {
    trackEvent(
      "quiz_started",
      { properties: { source } },
      { includeAuth: false }
    ).catch(() => {});
    setOpen(true);
  }, [source]);

  useEffect(() => {
    if (!open) return;
    // Lock scroll + expose a signal the mobile sticky CTA (and any other
    // sibling elements that would visually collide with the fullscreen
    // modal) can read via CSS. See ConsultLPClient sticky footer, which
    // hides itself while [data-consult-open="true"] is set on <html>.
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
        onClick={openModal}
        className={[buttonClass, className].filter(Boolean).join(" ")}
      >
        {label ?? "Start · 60 seconds"}
      </button>
      {open && (
        <ConsultOnboardingOverlay
          source={source}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ---- Overlay (Step 0 phone screen, then hands off to QuizModal) -----------

interface ConsultOnboardingOverlayProps {
  source: string;
  onClose: () => void;
}

function ConsultOnboardingOverlay({
  source,
  onClose,
}: ConsultOnboardingOverlayProps) {
  const [phase, setPhase] = useState<"phone" | "quiz">("phone");
  const [firstName, setFirstName] = useState("");
  const [phoneE164, setPhoneE164] = useState<string | null>(null);

  useEffect(() => {
    // Standard PostHog LP view event (we already fire lp_consult_view via the
    // page useEffect; this is the modal-open equivalent).
    trackEvent("lp_consult_modal_view", {
      properties: { source },
    }).catch(() => {});
    captureAttributionFromUrl();
  }, [source]);

  // Render the overlay via a portal to <body> so it escapes any ancestor
  // that establishes a containing block for position:fixed (e.g. the mobile
  // sticky footer uses backdrop-filter: blur, which traps fixed descendants
  // inside a ~72px strip below the viewport). Guarded for SSR.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-bone overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Get started"
    >
      <div className="min-h-screen flex flex-col">
        <header className="sticky top-0 z-10 bg-bone/95 backdrop-blur border-b border-forest/10">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="text-[11px] tracking-[0.28em] uppercase text-forest">
              Mully Reserve
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-charcoal/60 hover:text-charcoal text-2xl leading-none cursor-pointer"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </header>

        <div className="flex-1">
          {phase === "phone" ? (
            <ConsultStep0
              onSuccess={(name, phone) => {
                setFirstName(name);
                setPhoneE164(phone);
                setPhase("quiz");
              }}
            />
          ) : (
            // Once phone is captured we hand off to the existing shared
            // QuizModal, seeded with the first name and E.164 phone we just
            // collected. QuizModal uses the phone to POST quiz answers to
            // the sms-agent enrich endpoint so Martine's SendBlue profile
            // reflects the visitor's style profile before she replies.
            // QuizModal manages its own state, persistence, and terminal
            // navigation (reveal + checkout).
            <QuizModal
              source={source}
              onClose={onClose}
              seedFirstName={firstName}
              seedPhone={phoneE164}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---- Step 0: name + phone + consent + Martine intro -----------------------

interface ConsultStep0Props {
  // We pass BOTH the first name (used to seed the quiz greeting) and the
  // E.164 phone (used to reconcile the visitor's quiz answers back to the
  // SendBlue contact record when the quiz completes).
  onSuccess: (firstName: string, phoneE164: string) => void;
}

// US-only for now — matches the Meta targeting on the ad set. We
// intentionally do NOT accept a country code in the input to reduce
// cognitive friction; the API prefixes +1 server-side.
function formatUSPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function ConsultStep0({ onSuccess }: ConsultStep0Props) {
  const [firstName, setFirstName] = useState("");
  const [phoneDisplay, setPhoneDisplay] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittedRef = useRef(false);

  const digits = phoneDisplay.replace(/\D/g, "");
  const nameValid = firstName.trim().length >= 1;
  const phoneValid = digits.length === 10 && /^[2-9]/.test(digits);
  const canSubmit = nameValid && phoneValid && consent && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittedRef.current) return;
    setError(null);
    if (!canSubmit) {
      if (!nameValid) setError("What should Martine call you?");
      else if (!phoneValid)
        setError("Enter a valid 10-digit US mobile number.");
      else if (!consent) setError("Please acknowledge the consent box to continue.");
      return;
    }

    submittedRef.current = true;
    setSubmitting(true);

    // We POST to /api/consult with a 15s hard cap. The endpoint enrolls the
    // visitor into the SMS agent (~1s) and defers Shopify sync. If we time
    // out anyway, the server has almost certainly still enrolled the
    // visitor via next/after — proceed optimistically.
    const controller = new AbortController();
    const abortTimer = window.setTimeout(() => controller.abort(), 15000);
    try {
      // Forward the visitor's PostHog anon_id so the server-side
      // `consult_submit` event lands on the SAME PostHog person as the
      // client's page_view / quiz_started events. Without this the server
      // event uses `phone_<last4>` as its distinct_id and the LP funnel
      // can't stitch phase-1 completion into the sequence.
      const anonymousId =
        typeof window !== "undefined" ? getClientAnonymousId() : null;
      const res = await fetch("/api/consult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: `+1${digits}`,
          first_name: firstName.trim(),
          source: "lp_consult_v2",
          consent_text: CONSENT_TEXT,
          landing_url:
            typeof window !== "undefined" ? window.location.href : null,
          anonymous_id: anonymousId,
        }),
        signal: controller.signal,
      });
      window.clearTimeout(abortTimer);

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `http_${res.status}`);
      }

      // Fire the Meta `Lead` standard event NOW — this is the moment that
      // matters for optimization, before the quiz. `trackEvent` routes
      // through /api/analytics/track which mirrors to Meta CAPI with a
      // shared event_id for automatic dedup against the client fbq mirror.
      trackEvent("lp_consult_submit", {
        phone: `+1${digits}`,
        properties: {
          phone_last4: digits.slice(-4),
          first_name_provided: true,
          source: "lp_consult_v2",
        },
      });

      onSuccess(firstName.trim(), `+1${digits}`);
    } catch (err) {
      window.clearTimeout(abortTimer);
      if (err instanceof Error && err.name === "AbortError") {
        // Server-side enrollment is deferred but reliable — proceed.
        trackEvent("lp_consult_submit", {
          phone: `+1${digits}`,
          properties: {
            phone_last4: digits.slice(-4),
            first_name_provided: true,
            timed_out: true,
            source: "lp_consult_v2",
          },
        });
        onSuccess(firstName.trim(), `+1${digits}`);
        return;
      }
      submittedRef.current = false;
      setSubmitting(false);
      setError(
        err instanceof Error
          ? "We couldn't reach the server. Try once more."
          : "Something went wrong. Try once more."
      );
    }
  }

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* ── Martine intro card ────────────────────────────────────────── */}
      <div className="flex items-start gap-4 rounded-lg border border-forest/15 bg-white p-4 sm:p-5">
        <div className="relative h-16 w-16 sm:h-20 sm:w-20 shrink-0 rounded-full overflow-hidden bg-bone-dark/40 border border-forest/10">
          <Image
            src="/team/martine-round.webp"
            alt="Martine Jordan, Mully head stylist"
            fill
            sizes="80px"
            className="object-cover"
          />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] tracking-[0.22em] uppercase text-ember mb-1">
            Meet your stylist
          </div>
          <div className="font-serif text-lg sm:text-xl text-forest leading-snug">
            Martine may text you to dial in your fit and style.
          </div>
          <p className="text-sm text-charcoal/75 mt-2 leading-relaxed">
            She works with every Reserve member on sizing, favorite brands, and
            what to send next. Ticking the box below lets her reach out.
          </p>
        </div>
      </div>

      {/* ── Step-0 form ───────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
        <div>
          <label
            htmlFor="consult-first-name"
            className="block text-[11px] tracking-[0.22em] uppercase text-charcoal/70 mb-2"
          >
            First name
          </label>
          <input
            id="consult-first-name"
            type="text"
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full rounded-md border border-forest/25 bg-white px-4 py-3 text-base text-charcoal placeholder:text-charcoal/40 focus:outline-none focus:ring-2 focus:ring-forest/40"
            placeholder="Drew"
            required
          />
        </div>

        <div>
          <label
            htmlFor="consult-phone"
            className="block text-[11px] tracking-[0.22em] uppercase text-charcoal/70 mb-2"
          >
            Mobile number
          </label>
          <input
            id="consult-phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            value={phoneDisplay}
            onChange={(e) => setPhoneDisplay(formatUSPhone(e.target.value))}
            className="w-full rounded-md border border-forest/25 bg-white px-4 py-3 text-base text-charcoal placeholder:text-charcoal/40 focus:outline-none focus:ring-2 focus:ring-forest/40"
            placeholder="(313) 555-1234"
            required
          />
          <p className="mt-2 text-[11px] text-charcoal/55">
            US mobile numbers only. We text — we don&rsquo;t call.
          </p>
        </div>

        {/* Required TCPA consent checkbox. `required` on the input +
            `canSubmit` gate on the button both enforce this; the button
            stays disabled until it's checked. */}
        <label className="flex items-start gap-3 rounded-md border border-forest/15 bg-bone-dark/20 p-3 sm:p-4 cursor-pointer">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 rounded border-forest/30 text-forest focus:ring-forest/40 cursor-pointer"
            required
          />
          <span className="text-xs sm:text-[13px] leading-relaxed text-charcoal/85">
            {CONSENT_TEXT}{" "}
            <a
              href={PRIVACY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-forest"
            >
              Privacy Policy
            </a>
            {" · "}
            <a
              href={TERMS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-forest"
            >
              Terms of Service
            </a>
            .
          </span>
        </label>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-md bg-ember py-3.5 text-sm font-medium tracking-wide text-bone transition hover:bg-ember/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "One moment…" : "Continue · Build my edit"}
        </button>

        <p className="text-center text-[11px] tracking-[0.18em] uppercase text-charcoal/50">
          Then a 60-second style quiz
        </p>
      </form>
    </div>
  );
}
