"use client";

/**
 * Style quiz — the top-of-funnel pre-checkout component for Mully Reserve.
 *
 * 6 steps, image cards, ONE question per screen, mobile-first, no scroll
 * tax on each step. After step 6, the email gate is gated by an explicit
 * consent checkbox. On completion → redirect to /lp/reserve/reveal/{profileId}.
 *
 * Persistence model:
 *   - Step 1 answer creates the profile via /api/quiz/start; the response
 *     profileId is stored in localStorage so reloads can resume.
 *   - Each subsequent answer is saved via /api/quiz/step (fire-and-forget).
 *   - Step 6 (email gate) calls /api/quiz/complete and routes to /reveal.
 *   - If the user navigates away mid-quiz, a sendBeacon to /api/quiz/abandon
 *     fires for the drop-off funnel in PostHog.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { trackEvent } from "@/lib/tracking";
import { captureAttributionFromUrl } from "@/lib/attribution";

// ─── Types (mirror server-side enums; kept inline to avoid client/server import) ──

type StyleBucket = "classic" | "modern" | "bold" | "quiet";
type FitPreference = "tailored" | "regular" | "relaxed";
type CategoryPref =
  | "polos"
  | "layers"
  | "shorts_pants"
  | "outerwear"
  | "accessories";
type PlayFrequency = "weekly_plus" | "weekly" | "monthly" | "occasional";

interface QuizAnswers {
  golfStyle: StyleBucket | null;
  categoryPrefs: CategoryPref[];
  fit: FitPreference | null;
  topSize: string | null;
  bottomSize: string | null;
  favoriteBrands: string[];
  playFrequency: PlayFrequency | null;
  email: string;
  consent: boolean;
  firstName: string;
}

// ─── Step definitions (visual-first, minimal copy) ────────────────────────────

interface StyleCard {
  value: StyleBucket;
  label: string;
  blurb: string;
  imageSrc: string;
}

const STYLE_CARDS: StyleCard[] = [
  {
    value: "classic",
    label: "Classic",
    blurb: "Timeless. Polo, chinos, sharp.",
    imageSrc: "/lp/quiz/style-classic.jpg",
  },
  {
    value: "modern",
    label: "Modern",
    blurb: "Tech fabrics. Athletic cut.",
    imageSrc: "/lp/quiz/style-modern.jpg",
  },
  {
    value: "bold",
    label: "Bold",
    blurb: "Color, pattern, statement.",
    imageSrc: "/lp/quiz/style-bold.jpg",
  },
  {
    value: "quiet",
    label: "Quiet",
    blurb: "Understated. Better fabrics.",
    imageSrc: "/lp/quiz/style-quiet.jpg",
  },
];

const CATEGORY_CARDS: Array<{
  value: CategoryPref;
  label: string;
  icon: string;
}> = [
  { value: "polos", label: "Polos & shirts", icon: "👔" },
  { value: "layers", label: "Layers & 1/4 zips", icon: "🧥" },
  { value: "shorts_pants", label: "Shorts & pants", icon: "👖" },
  { value: "outerwear", label: "Outerwear", icon: "🧥" },
  { value: "accessories", label: "Hats & accessories", icon: "🧢" },
];

const FIT_CARDS: Array<{ value: FitPreference; label: string; blurb: string }> = [
  { value: "tailored", label: "Tailored", blurb: "Slimmer through chest and waist." },
  { value: "regular", label: "Regular", blurb: "Standard fit. Not boxy, not slim." },
  { value: "relaxed", label: "Relaxed", blurb: "Room to move. Looser through body." },
];

const TOP_SIZES = ["S", "M", "L", "XL", "XXL"];
const WAIST_SIZES = ["30", "32", "34", "36", "38", "40", "42"];

const BRAND_CHIPS = [
  "Greyson",
  "Rhone",
  "Quiet Golf",
  "Lululemon",
  "Peter Millar",
  "Linksoul",
  "Bonobos",
  "Vuori",
  "Holderness & Bourne",
  "Polo Ralph Lauren",
  "Nike Golf",
  "Adidas",
];

const PLAY_CARDS: Array<{ value: PlayFrequency; label: string }> = [
  { value: "weekly_plus", label: "Multiple times a week" },
  { value: "weekly", label: "About once a week" },
  { value: "monthly", label: "A few times a month" },
  { value: "occasional", label: "Now and then" },
];

const QUIZ_STORAGE_KEY = "mully_quiz_profileId";
const QUIZ_ANSWERS_KEY = "mully_quiz_answers";
const TOTAL_STEPS = 7; // 6 quiz steps + email gate (we display 0/7 → 7/7)

// ─── Component ────────────────────────────────────────────────────────────────

export interface QuizModalProps {
  /** Optional analytics context for the LP that mounted it. */
  source?: string;
  /** Called when the visitor explicitly closes the quiz before completing. */
  onClose?: () => void;
}

export function QuizModal({ source = "lp_subscription", onClose }: QuizModalProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<QuizAnswers>({
    golfStyle: null,
    categoryPrefs: [],
    fit: null,
    topSize: null,
    bottomSize: null,
    favoriteBrands: [],
    playFrequency: null,
    email: "",
    consent: false,
    firstName: "",
  });

  // Restore on mount.
  useEffect(() => {
    captureAttributionFromUrl();
    try {
      const cachedAnswers = localStorage.getItem(QUIZ_ANSWERS_KEY);
      if (cachedAnswers) {
        const parsed = JSON.parse(cachedAnswers) as Partial<QuizAnswers>;
        setAnswers((a) => ({ ...a, ...parsed }));
      }
      const cachedId = localStorage.getItem(QUIZ_STORAGE_KEY);
      if (cachedId) setProfileId(cachedId);
    } catch {
      // Storage may be disabled — that's fine, quiz still works.
    }
    trackEvent(
      "quiz_view",
      { properties: { source } },
      { includeAuth: false }
    ).catch(() => {});
  }, [source]);

  // Persist answers locally on every change so a reload mid-quiz doesn't lose work.
  useEffect(() => {
    try {
      localStorage.setItem(QUIZ_ANSWERS_KEY, JSON.stringify(answers));
    } catch {}
  }, [answers]);

  // Abandon beacon on unload.
  const profileIdRef = useRef<string | null>(null);
  profileIdRef.current = profileId;
  const stepRef = useRef(step);
  stepRef.current = step;

  useEffect(() => {
    function handleUnload() {
      const pid = profileIdRef.current;
      if (!pid) return;
      if (stepRef.current >= TOTAL_STEPS - 1) return; // already completed
      try {
        const blob = new Blob(
          [JSON.stringify({ profileId: pid, step: stepRef.current, reason: "unload" })],
          { type: "application/json" }
        );
        navigator.sendBeacon("/api/quiz/abandon", blob);
      } catch {}
    }
    window.addEventListener("pagehide", handleUnload);
    return () => window.removeEventListener("pagehide", handleUnload);
  }, []);

  // ─── API helpers ────────────────────────────────────────────────────────────

  const startQuiz = useCallback(
    async (firstAnswer: StyleBucket) => {
      const utm = readUtmFromStorage();
      const res = await fetch("/api/quiz/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          styleBucket: firstAnswer,
          utm,
          referrer: document.referrer || null,
          landingPath: window.location.pathname + window.location.search,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "start_failed");
      }
      const data = (await res.json()) as { profileId: string };
      try {
        localStorage.setItem(QUIZ_STORAGE_KEY, data.profileId);
      } catch {}
      return data.profileId;
    },
    []
  );

  const saveStep = useCallback(
    async (
      pid: string,
      stepIndex: number,
      patch: Partial<QuizAnswers>
    ): Promise<void> => {
      const apiAnswer: Record<string, unknown> = {};
      if (patch.golfStyle !== undefined) apiAnswer.golfStyle = patch.golfStyle;
      if (patch.categoryPrefs !== undefined)
        apiAnswer.categoryPrefs = patch.categoryPrefs;
      if (patch.fit !== undefined) apiAnswer.fit = patch.fit;
      if (patch.topSize !== undefined) apiAnswer.topSize = patch.topSize;
      if (patch.bottomSize !== undefined) apiAnswer.bottomSize = patch.bottomSize;
      if (patch.favoriteBrands !== undefined)
        apiAnswer.favoriteBrands = patch.favoriteBrands;
      if (patch.playFrequency !== undefined)
        apiAnswer.playFrequency = patch.playFrequency;

      // Empty patches (just navigation) skip the API call.
      if (Object.keys(apiAnswer).length === 0) return;

      const res = await fetch("/api/quiz/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: pid, step: stepIndex, answer: apiAnswer }),
      });
      if (!res.ok) {
        // Step save failures are non-fatal — we keep state locally and the
        // user can continue. Log so we see them in dev/console.
        // eslint-disable-next-line no-console
        console.warn("[quiz] step save failed", await res.text().catch(() => ""));
      }
    },
    []
  );

  // ─── Step advancement ───────────────────────────────────────────────────────

  const advanceFromStyle = useCallback(
    async (bucket: StyleBucket) => {
      setError(null);
      setSubmitting(true);
      const patch = { golfStyle: bucket };
      setAnswers((a) => ({ ...a, ...patch }));
      try {
        let pid = profileId;
        if (!pid) {
          pid = await startQuiz(bucket);
          setProfileId(pid);
        } else {
          await saveStep(pid, 0, patch);
        }
        trackEvent(
          "quiz_step_completed",
          {
            properties: { step: 0, styleBucket: bucket, source, profileId: pid },
          },
          { includeAuth: false }
        ).catch(() => {});
        setStep(1);
      } catch (e) {
        setError(
          e instanceof Error
            ? "We couldn't start your edit just now. Try once more."
            : "Something went wrong. Try once more."
        );
      } finally {
        setSubmitting(false);
      }
    },
    [profileId, saveStep, source, startQuiz]
  );

  const goNext = useCallback(
    async (patch: Partial<QuizAnswers>) => {
      setError(null);
      const merged = { ...answers, ...patch };
      setAnswers(merged);
      const pid = profileId;
      if (pid) {
        setSubmitting(true);
        try {
          await saveStep(pid, step, patch);
          trackEvent(
            "quiz_step_completed",
            {
              properties: {
                step,
                source,
                profileId: pid,
                fields: Object.keys(patch),
              },
            },
            { includeAuth: false }
          ).catch(() => {});
        } finally {
          setSubmitting(false);
        }
      }
      setStep((s) => s + 1);
    },
    [answers, profileId, saveStep, source, step]
  );

  const submitEmail = useCallback(async () => {
    setError(null);
    if (!profileId) {
      setError("Looks like the quiz reset. Refresh and try again.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answers.email)) {
      setError("Please enter a valid email.");
      return;
    }
    if (!answers.consent) {
      setError("Tick the consent box to see your edit.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/quiz/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId,
          email: answers.email,
          consent: answers.consent,
          firstName: answers.firstName || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "complete_failed");
      }
      trackEvent(
        "quiz_completed",
        {
          email: answers.email,
          properties: { source, profileId, styleBucket: answers.golfStyle },
        },
        { includeAuth: false }
      ).catch(() => {});
      try {
        localStorage.removeItem(QUIZ_ANSWERS_KEY);
      } catch {}
      router.push(`/lp/reserve/reveal/${profileId}`);
    } catch (e) {
      setError(
        e instanceof Error
          ? "We couldn't save that just now. One more try."
          : "Something went wrong. Try once more."
      );
      setSubmitting(false);
    }
  }, [answers, profileId, router, source]);

  // ─── Progress bar ───────────────────────────────────────────────────────────

  const progressPct = useMemo(
    () => Math.min(100, Math.round(((step + 1) / TOTAL_STEPS) * 100)),
    [step]
  );

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto w-full max-w-2xl px-4 sm:px-6">
      <header className="mb-6 flex items-center justify-between">
        <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
          Build your Reserve edit
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-zinc-500 hover:text-zinc-900"
          >
            Close
          </button>
        )}
      </header>

      <div className="mb-8 h-1 w-full overflow-hidden rounded-full bg-zinc-200">
        <div
          className="h-1 bg-zinc-900 transition-[width] duration-300 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {step === 0 && (
        <StepStyle
          submitting={submitting}
          selected={answers.golfStyle}
          onSelect={advanceFromStyle}
        />
      )}

      {step === 1 && (
        <StepCategories
          submitting={submitting}
          selected={answers.categoryPrefs}
          onChange={(v) => setAnswers((a) => ({ ...a, categoryPrefs: v }))}
          onNext={() => goNext({ categoryPrefs: answers.categoryPrefs })}
        />
      )}

      {step === 2 && (
        <StepFit
          submitting={submitting}
          selected={answers.fit}
          onSelect={(fit) => goNext({ fit })}
        />
      )}

      {step === 3 && (
        <StepTopSize
          submitting={submitting}
          selected={answers.topSize}
          onSelect={(topSize) => goNext({ topSize })}
        />
      )}

      {step === 4 && (
        <StepWaistSize
          submitting={submitting}
          selected={answers.bottomSize}
          onSelect={(bottomSize) => goNext({ bottomSize })}
        />
      )}

      {step === 5 && (
        <StepBrands
          submitting={submitting}
          selected={answers.favoriteBrands}
          onChange={(v) => setAnswers((a) => ({ ...a, favoriteBrands: v }))}
          onNext={() =>
            goNext({
              favoriteBrands: answers.favoriteBrands,
              // playFrequency is optional — we default it here and let the user
              // skip the question to keep the quiz under 60s.
              playFrequency: answers.playFrequency,
            })
          }
        />
      )}

      {step === 6 && (
        <StepEmailGate
          submitting={submitting}
          email={answers.email}
          firstName={answers.firstName}
          consent={answers.consent}
          onChangeEmail={(email) => setAnswers((a) => ({ ...a, email }))}
          onChangeName={(firstName) => setAnswers((a) => ({ ...a, firstName }))}
          onChangeConsent={(consent) => setAnswers((a) => ({ ...a, consent }))}
          onSubmit={submitEmail}
        />
      )}

      {error && (
        <p className="mt-6 text-center text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Individual steps ─────────────────────────────────────────────────────────

function StepStyle({
  submitting,
  selected,
  onSelect,
}: {
  submitting: boolean;
  selected: StyleBucket | null;
  onSelect: (v: StyleBucket) => void;
}) {
  return (
    <section>
      <h2 className="mb-1 text-3xl font-medium tracking-tight text-zinc-900 sm:text-4xl">
        Which one looks like you?
      </h2>
      <p className="mb-6 text-sm text-zinc-500">Pick the closest.</p>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {STYLE_CARDS.map((card) => (
          <button
            key={card.value}
            type="button"
            onClick={() => onSelect(card.value)}
            disabled={submitting}
            className={[
              "group relative overflow-hidden rounded-xl border bg-white text-left transition",
              "hover:border-zinc-900 hover:shadow-lg",
              "disabled:cursor-not-allowed disabled:opacity-60",
              selected === card.value
                ? "border-zinc-900 ring-2 ring-zinc-900"
                : "border-zinc-200",
            ].join(" ")}
          >
            <div className="relative aspect-[4/5] w-full bg-zinc-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={card.imageSrc}
                alt={card.label}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
            <div className="px-4 py-3">
              <div className="text-base font-medium text-zinc-900">{card.label}</div>
              <div className="text-xs text-zinc-500">{card.blurb}</div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function StepCategories({
  submitting,
  selected,
  onChange,
  onNext,
}: {
  submitting: boolean;
  selected: CategoryPref[];
  onChange: (v: CategoryPref[]) => void;
  onNext: () => void;
}) {
  function toggle(v: CategoryPref) {
    if (selected.includes(v)) onChange(selected.filter((x) => x !== v));
    else onChange([...selected, v]);
  }
  return (
    <section>
      <h2 className="mb-1 text-3xl font-medium tracking-tight text-zinc-900 sm:text-4xl">
        What do you reach for most?
      </h2>
      <p className="mb-6 text-sm text-zinc-500">Pick a few — we'll weight your edit accordingly.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {CATEGORY_CARDS.map((c) => {
          const isOn = selected.includes(c.value);
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => toggle(c.value)}
              className={[
                "rounded-xl border px-4 py-5 text-left transition",
                "hover:border-zinc-900",
                isOn
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-200 bg-white text-zinc-900",
              ].join(" ")}
            >
              <div className="text-2xl">{c.icon}</div>
              <div className="mt-2 text-sm font-medium">{c.label}</div>
            </button>
          );
        })}
      </div>
      <PrimaryButton onClick={onNext} disabled={submitting || selected.length === 0}>
        Continue
      </PrimaryButton>
    </section>
  );
}

function StepFit({
  submitting,
  selected,
  onSelect,
}: {
  submitting: boolean;
  selected: FitPreference | null;
  onSelect: (v: FitPreference) => void;
}) {
  return (
    <section>
      <h2 className="mb-1 text-3xl font-medium tracking-tight text-zinc-900 sm:text-4xl">
        How do you like your fit?
      </h2>
      <p className="mb-6 text-sm text-zinc-500">Sizing's confirmed after checkout — this just sets the baseline.</p>
      <div className="grid gap-3">
        {FIT_CARDS.map((f) => (
          <button
            key={f.value}
            type="button"
            disabled={submitting}
            onClick={() => onSelect(f.value)}
            className={[
              "rounded-xl border bg-white px-5 py-4 text-left transition hover:border-zinc-900",
              "disabled:cursor-not-allowed disabled:opacity-60",
              selected === f.value ? "border-zinc-900 ring-2 ring-zinc-900" : "border-zinc-200",
            ].join(" ")}
          >
            <div className="text-lg font-medium text-zinc-900">{f.label}</div>
            <div className="text-sm text-zinc-500">{f.blurb}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

function StepTopSize({
  submitting,
  selected,
  onSelect,
}: {
  submitting: boolean;
  selected: string | null;
  onSelect: (v: string) => void;
}) {
  return (
    <section>
      <h2 className="mb-1 text-3xl font-medium tracking-tight text-zinc-900 sm:text-4xl">
        Your top size?
      </h2>
      <p className="mb-6 text-sm text-zinc-500">Closest is fine. We'll dial it in after checkout.</p>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {TOP_SIZES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={submitting}
            onClick={() => onSelect(s)}
            className={[
              "rounded-xl border bg-white py-5 text-center text-lg font-medium transition hover:border-zinc-900",
              "disabled:cursor-not-allowed disabled:opacity-60",
              selected === s ? "border-zinc-900 ring-2 ring-zinc-900" : "border-zinc-200",
            ].join(" ")}
          >
            {s}
          </button>
        ))}
      </div>
    </section>
  );
}

function StepWaistSize({
  submitting,
  selected,
  onSelect,
}: {
  submitting: boolean;
  selected: string | null;
  onSelect: (v: string) => void;
}) {
  return (
    <section>
      <h2 className="mb-1 text-3xl font-medium tracking-tight text-zinc-900 sm:text-4xl">
        Your waist?
      </h2>
      <p className="mb-6 text-sm text-zinc-500">Closest inch is fine.</p>
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-7">
        {WAIST_SIZES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={submitting}
            onClick={() => onSelect(s)}
            className={[
              "rounded-xl border bg-white py-5 text-center text-lg font-medium transition hover:border-zinc-900",
              "disabled:cursor-not-allowed disabled:opacity-60",
              selected === s ? "border-zinc-900 ring-2 ring-zinc-900" : "border-zinc-200",
            ].join(" ")}
          >
            {s}
          </button>
        ))}
      </div>
    </section>
  );
}

function StepBrands({
  submitting,
  selected,
  onChange,
  onNext,
}: {
  submitting: boolean;
  selected: string[];
  onChange: (v: string[]) => void;
  onNext: () => void;
}) {
  function toggle(b: string) {
    if (selected.includes(b)) onChange(selected.filter((x) => x !== b));
    else onChange([...selected, b]);
  }
  return (
    <section>
      <h2 className="mb-1 text-3xl font-medium tracking-tight text-zinc-900 sm:text-4xl">
        Brands you like?
      </h2>
      <p className="mb-6 text-sm text-zinc-500">Optional. Helps us prioritize.</p>
      <div className="flex flex-wrap gap-2">
        {BRAND_CHIPS.map((b) => {
          const isOn = selected.includes(b);
          return (
            <button
              key={b}
              type="button"
              onClick={() => toggle(b)}
              className={[
                "rounded-full border px-4 py-2 text-sm transition",
                isOn
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-900",
              ].join(" ")}
            >
              {b}
            </button>
          );
        })}
      </div>
      <PrimaryButton onClick={onNext} disabled={submitting}>
        Continue
      </PrimaryButton>
    </section>
  );
}

function StepEmailGate({
  submitting,
  email,
  firstName,
  consent,
  onChangeEmail,
  onChangeName,
  onChangeConsent,
  onSubmit,
}: {
  submitting: boolean;
  email: string;
  firstName: string;
  consent: boolean;
  onChangeEmail: (v: string) => void;
  onChangeName: (v: string) => void;
  onChangeConsent: (v: boolean) => void;
  onSubmit: () => void;
}) {
  return (
    <section>
      <h2 className="mb-1 text-3xl font-medium tracking-tight text-zinc-900 sm:text-4xl">
        Where do we send your edit?
      </h2>
      <p className="mb-6 text-sm text-zinc-500">
        We'll show you the four pieces and the welcome-gift rangefinder on the next screen.
      </p>
      <div className="grid gap-3">
        <input
          type="text"
          autoComplete="given-name"
          value={firstName}
          onChange={(e) => onChangeName(e.target.value)}
          placeholder="First name (optional)"
          className="rounded-xl border border-zinc-200 bg-white px-5 py-4 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
        />
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => onChangeEmail(e.target.value)}
          placeholder="you@email.com"
          required
          className="rounded-xl border border-zinc-200 bg-white px-5 py-4 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
        />
        <label className="mt-1 flex items-start gap-3 text-sm text-zinc-600">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => onChangeConsent(e.target.checked)}
            className="mt-1 h-4 w-4 accent-zinc-900"
          />
          <span>
            Send me my Reserve edit and occasional emails from Drew. Unsubscribe anytime.
          </span>
        </label>
      </div>
      <PrimaryButton onClick={onSubmit} disabled={submitting}>
        {submitting ? "Building your edit…" : "See my edit"}
      </PrimaryButton>
      <p className="mt-4 text-center text-xs text-zinc-400">
        No charge to see your edit. Free welcome gift if you join.
      </p>
    </section>
  );
}

// ─── Small UI bits ────────────────────────────────────────────────────────────

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="w-full rounded-xl bg-zinc-900 py-4 text-base font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
      >
        {children}
      </button>
    </div>
  );
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function readUtmFromStorage(): Record<string, string | null> {
  try {
    const raw = localStorage.getItem("mully_attr");
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string | null>;
    return {
      source: parsed.utm_source ?? null,
      medium: parsed.utm_medium ?? null,
      campaign: parsed.utm_campaign ?? null,
      content: parsed.utm_content ?? null,
      term: parsed.utm_term ?? null,
      gclid: parsed.gclid ?? null,
    };
  } catch {
    return {};
  }
}
