"use client";

/**
 * Style quiz — top-of-funnel pre-checkout component for Mully Reserve.
 *
 * 6 steps (0-5), ONE question per screen, mobile-first.
 * Brand palette throughout: bone bg, forest primary, ember accent, charcoal body.
 * Step 1 (categories) uses brand-matched SVG icons, NOT emoji.
 * Style cards are contained — no oversized images.
 *
 * Persistence model:
 *   - Step 0 answer creates the profile via /api/quiz/start; the response
 *     profileId is stored in localStorage so reloads can resume.
 *   - Each subsequent answer is saved via /api/quiz/step (fire-and-forget).
 *   - Step 5 (brands + play frequency) finishes the quiz and routes
 *     directly to /lp/reserve/reveal/{profileId}. No email is collected at
 *     the quiz stage — the reveal page (RevealBrick) is the next surface.
 *     Email is captured later during Shopify checkout.
 *   - If the user navigates away mid-quiz, a sendBeacon to /api/quiz/abandon
 *     fires for the drop-off funnel in PostHog.
 *
 * Tracking allowlist events fired here:
 *   quiz_view, quiz_step_completed, quiz_email_captured, quiz_completed.
 *   (quiz_started is fired by QuizLauncher; quiz_abandoned by the server.)
 */

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { trackEvent, getClientAnonymousId } from "@/lib/tracking";
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

// ─── Brand-matched SVG icons for the category step ────────────────────────────

function PoloIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M11 5l-6 3 2 6 3-1v14h16V13l3 1 2-6-6-3-3 3-2-1-2 1-2-1-2 1-3-3z" />
      <path d="M16 6v4" />
      <path d="M14 6l2 3 2-3" />
    </svg>
  );
}

function LayerIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M9 5l-5 4 3 6 2-1v14h14V14l2 1 3-6-5-4-3 3h-2v22" />
      <path d="M16 8v18" />
      <path d="M16 11l1 1" />
      <path d="M16 16l1 1" />
    </svg>
  );
}

function PantsIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M7 4h18l-1 8-2 16h-5l-1-13h-1l-1 13H9L7 12z" />
      <path d="M7 4h18" />
    </svg>
  );
}

function OuterwearIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M10 4L4 8l3 7 3-1v14h12V14l3 1 3-7-6-4-3 3h-6z" />
      <path d="M16 7v20" />
      <circle cx="16" cy="13" r=".6" fill="currentColor" />
      <circle cx="16" cy="18" r=".6" fill="currentColor" />
      <circle cx="16" cy="23" r=".6" fill="currentColor" />
    </svg>
  );
}

function HatIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M6 20c0-6 4.5-10 10-10s10 4 10 10" />
      <path d="M3 20h26" />
      <path d="M6 20l5-2 5 1 5-1 5 2" />
    </svg>
  );
}

const CATEGORY_CARDS: Array<{
  value: CategoryPref;
  label: string;
  Icon: (p: { className?: string }) => ReactNode;
}> = [
  { value: "polos", label: "Polos & shirts", Icon: PoloIcon },
  { value: "layers", label: "Layers & 1/4 zips", Icon: LayerIcon },
  { value: "shorts_pants", label: "Shorts & pants", Icon: PantsIcon },
  { value: "outerwear", label: "Outerwear", Icon: OuterwearIcon },
  { value: "accessories", label: "Hats & accessories", Icon: HatIcon },
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
const TOTAL_STEPS = 6;

// ─── Component ────────────────────────────────────────────────────────────────

export interface QuizModalProps {
  source?: string;
  onClose?: () => void;
  /**
   * When present, seeds the visitor's first name into the quiz's answer
   * state without changing any step order. Used by the /lp/consult flow
   * where we collect name+phone in a Step 0 before opening the quiz, so
   * the quiz doesn't need to ask for name again. Purely additive — the
   * /lp/subscription flow leaves this undefined and behaves exactly as
   * before.
   */
  seedFirstName?: string;
  /**
   * E.164 phone captured in Step 0 of the /lp/consult onboarding.
   * Threaded through so the quiz can POST the visitor's answers to the
   * sms-agent enrich endpoint (via /api/consult/enrich) once they finish
   * the quiz. This is what makes Martine's SendBlue dashboard show the
   * visitor's style profile alongside her name.
   *
   * The standard /lp/subscription flow leaves this undefined and skips
   * the enrich call entirely, matching prior behavior.
   */
  seedPhone?: string | null;
}

export function QuizModal({
  source = "lp_subscription",
  onClose,
  seedFirstName,
  seedPhone,
}: QuizModalProps) {
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
    firstName: seedFirstName ?? "",
  });

  // Restore on mount.
  useEffect(() => {
    captureAttributionFromUrl();
    try {
      const cachedAnswers = localStorage.getItem(QUIZ_ANSWERS_KEY);
      if (cachedAnswers) {
        const parsed = JSON.parse(cachedAnswers) as Partial<QuizAnswers>;
        setAnswers((a) => ({
          ...a,
          ...parsed,
          // A fresh consult onboarding session (seedFirstName provided) must
          // win over any stale localStorage firstName from a previous quiz
          // run — otherwise a visitor who quizzed anonymously last week
          // and now enters a different name in Step 0 would silently get
          // the old one.
          firstName: seedFirstName ?? parsed.firstName ?? a.firstName,
        }));
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
    // seedFirstName is only read on initial mount — the parent Consult
    // launcher never changes it after the phone step. Listing it here to
    // satisfy exhaustive-deps without introducing re-runs in practice.
  }, [source, seedFirstName]);

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
      if (stepRef.current >= TOTAL_STEPS - 1) return;
      try {
        const blob = new Blob(
          [JSON.stringify({
            profileId: pid,
            step: stepRef.current,
            reason: "unload",
            client_anonymous_id: getClientAnonymousId(),
          })],
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
          client_anonymous_id: getClientAnonymousId(),
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

      if (Object.keys(apiAnswer).length === 0) return;

      const res = await fetch("/api/quiz/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: pid, step: stepIndex, answer: apiAnswer }),
      });
      if (!res.ok) {
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

  /**
   * Finishes the quiz WITHOUT an email gate. As of 2026-07-09 the reveal
   * brick is the winning post-quiz surface and we route straight there.
   * Email is captured downstream at Shopify checkout.
   *
   * We still fire `quiz_completed` on the client so PostHog / GA4 / Meta all
   * see the funnel finish, and we clear the localStorage answers to prevent
   * stale replay.
   */
  const finishQuiz = useCallback(async () => {
    setError(null);
    if (!profileId) {
      setError("Looks like the quiz reset. Refresh and try again.");
      return;
    }
    setSubmitting(true);
    try {
      trackEvent(
        "quiz_completed",
        {
          properties: {
            source,
            profileId,
            styleBucket: answers.golfStyle,
            variant: "no_email_gate",
          },
        },
        { includeAuth: false }
      ).catch(() => {});

      // Enrich Martine's SendBlue profile with the completed quiz answers
      // if we know who this visitor is (came from the /lp/consult flow
      // and provided phone in Step 0). Fire-and-forget with a short abort
      // timeout so we never block the reveal navigation on a laggy
      // sms-agent — the enrich endpoint is idempotent and can be safely
      // retried later if needed.
      if (seedPhone) {
        const ctrl = new AbortController();
        const t = window.setTimeout(() => ctrl.abort(), 4000);
        void fetch("/api/consult/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: seedPhone,
            answers: {
              style: answers.golfStyle,
              categories: answers.categoryPrefs,
              fit: answers.fit,
              top_size: answers.topSize,
              bottom_size: answers.bottomSize,
              favorite_brands: answers.favoriteBrands,
              play_frequency: answers.playFrequency,
              style_profile_id: profileId,
            },
          }),
          signal: ctrl.signal,
          keepalive: true, // survive the router.push() navigation
        })
          .catch(() => {})
          .finally(() => window.clearTimeout(t));
      }

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
  }, [
    answers.bottomSize,
    answers.categoryPrefs,
    answers.favoriteBrands,
    answers.fit,
    answers.golfStyle,
    answers.playFrequency,
    answers.topSize,
    profileId,
    router,
    seedPhone,
    source,
  ]);

  // ─── Progress bar ───────────────────────────────────────────────────────────

  const progressPct = useMemo(
    () => Math.min(100, Math.round(((step + 1) / TOTAL_STEPS) * 100)),
    [step]
  );

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto w-full max-w-2xl px-4 sm:px-6">
      <header className="mb-3 flex items-center justify-between sm:mb-6">
        <div className="text-[11px] uppercase tracking-[0.22em] text-ember/90">
          Build your Reserve edit
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs uppercase tracking-[0.18em] text-charcoal/55 hover:text-forest transition"
          >
            Close
          </button>
        )}
      </header>

      <div className="mb-4 h-[3px] w-full overflow-hidden rounded-full bg-forest/10 sm:mb-8">
        <div
          className="h-full bg-ember transition-[width] duration-300 ease-out"
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
          play={answers.playFrequency}
          onChange={(v) => setAnswers((a) => ({ ...a, favoriteBrands: v }))}
          onChangePlay={(v) => setAnswers((a) => ({ ...a, playFrequency: v }))}
          onNext={async () => {
            // Persist the final step's answers, then jump straight to the
            // reveal brick. No email gate as of 2026-07-09.
            const patch = {
              favoriteBrands: answers.favoriteBrands,
              playFrequency: answers.playFrequency,
            };
            setAnswers((a) => ({ ...a, ...patch }));
            if (profileId) {
              setSubmitting(true);
              try {
                await saveStep(profileId, 5, patch);
                trackEvent(
                  "quiz_step_completed",
                  {
                    properties: {
                      step: 5,
                      source,
                      profileId,
                      fields: Object.keys(patch),
                    },
                  },
                  { includeAuth: false }
                ).catch(() => {});
              } finally {
                setSubmitting(false);
              }
            }
            await finishQuiz();
          }}
        />
      )}

      {error && (
        <p className="mt-6 text-center text-sm text-red-700" role="alert">
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
  // Compact crop ratios so the four cards fit a single mobile viewport.
  // 4:5 on phones (slightly portrait, all four visible above the fold);
  // 3:4 on sm+ where there's more vertical room.
  return (
    <section>
      <h2 className="mb-1 font-serif text-2xl text-forest sm:text-4xl leading-tight">
        Which one looks like you?
      </h2>
      <p className="mb-4 text-sm text-charcoal/65 sm:mb-6">Pick the closest.</p>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {STYLE_CARDS.map((card) => (
          <button
            key={card.value}
            type="button"
            onClick={() => onSelect(card.value)}
            disabled={submitting}
            className={[
              "group relative overflow-hidden rounded-md border bg-bone text-left transition",
              "hover:border-forest hover:shadow-md",
              "disabled:cursor-not-allowed disabled:opacity-60",
              selected === card.value
                ? "border-forest ring-2 ring-forest"
                : "border-forest/15",
            ].join(" ")}
          >
            <div className="relative aspect-[4/5] w-full bg-bone-dark/40 sm:aspect-[3/4]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={card.imageSrc}
                alt={card.label}
                className="h-full w-full object-cover"
                loading="eager"
              />
            </div>
            <div className="px-3 py-2 sm:px-4 sm:py-3">
              <div className="font-serif text-base text-forest sm:text-lg">
                {card.label}
              </div>
              <div className="text-[11px] text-charcoal/60 mt-0.5 leading-snug sm:text-xs">
                {card.blurb}
              </div>
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
      <h2 className="mb-1 font-serif text-3xl text-forest sm:text-4xl leading-tight">
        What do you reach for most?
      </h2>
      <p className="mb-6 text-sm text-charcoal/65">
        Pick a few — we'll weight your edit accordingly.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {CATEGORY_CARDS.map((c) => {
          const isOn = selected.includes(c.value);
          const Icon = c.Icon;
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => toggle(c.value)}
              className={[
                "rounded-md border px-4 py-5 text-left transition",
                "hover:border-forest",
                isOn
                  ? "border-forest bg-forest text-bone"
                  : "border-forest/15 bg-bone text-forest",
              ].join(" ")}
            >
              <Icon className={`h-8 w-8 ${isOn ? "text-ember" : "text-forest/85"}`} />
              <div className="mt-3 text-sm font-medium">{c.label}</div>
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
      <h2 className="mb-1 font-serif text-3xl text-forest sm:text-4xl leading-tight">
        How do you like your fit?
      </h2>
      <p className="mb-6 text-sm text-charcoal/65">
        Sizing's confirmed after checkout — this just sets the baseline.
      </p>
      <div className="grid gap-3">
        {FIT_CARDS.map((f) => (
          <button
            key={f.value}
            type="button"
            disabled={submitting}
            onClick={() => onSelect(f.value)}
            className={[
              "rounded-md border bg-bone px-5 py-4 text-left transition hover:border-forest",
              "disabled:cursor-not-allowed disabled:opacity-60",
              selected === f.value
                ? "border-forest ring-2 ring-forest"
                : "border-forest/15",
            ].join(" ")}
          >
            <div className="font-serif text-lg text-forest">{f.label}</div>
            <div className="text-sm text-charcoal/65">{f.blurb}</div>
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
      <h2 className="mb-1 font-serif text-3xl text-forest sm:text-4xl leading-tight">
        Your top size?
      </h2>
      <p className="mb-6 text-sm text-charcoal/65">
        Closest is fine. We'll dial it in after checkout.
      </p>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {TOP_SIZES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={submitting}
            onClick={() => onSelect(s)}
            className={[
              "rounded-md border bg-bone py-5 text-center font-serif text-lg text-forest transition hover:border-forest",
              "disabled:cursor-not-allowed disabled:opacity-60",
              selected === s
                ? "border-forest ring-2 ring-forest bg-forest text-bone"
                : "border-forest/15",
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
      <h2 className="mb-1 font-serif text-3xl text-forest sm:text-4xl leading-tight">
        Your waist?
      </h2>
      <p className="mb-6 text-sm text-charcoal/65">Closest inch is fine.</p>
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-7">
        {WAIST_SIZES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={submitting}
            onClick={() => onSelect(s)}
            className={[
              "rounded-md border bg-bone py-5 text-center font-serif text-lg text-forest transition hover:border-forest",
              "disabled:cursor-not-allowed disabled:opacity-60",
              selected === s
                ? "border-forest ring-2 ring-forest bg-forest text-bone"
                : "border-forest/15",
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
  play,
  onChange,
  onChangePlay,
  onNext,
}: {
  submitting: boolean;
  selected: string[];
  play: PlayFrequency | null;
  onChange: (v: string[]) => void;
  onChangePlay: (v: PlayFrequency) => void;
  onNext: () => void;
}) {
  function toggle(b: string) {
    if (selected.includes(b)) onChange(selected.filter((x) => x !== b));
    else onChange([...selected, b]);
  }
  return (
    <section>
      <h2 className="mb-1 font-serif text-3xl text-forest sm:text-4xl leading-tight">
        Brands you like?
      </h2>
      <p className="mb-6 text-sm text-charcoal/65">Optional. Helps us prioritize.</p>
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
                  ? "border-forest bg-forest text-bone"
                  : "border-forest/15 bg-bone text-charcoal hover:border-forest",
              ].join(" ")}
            >
              {b}
            </button>
          );
        })}
      </div>

      <div className="mt-8">
        <div className="text-[11px] tracking-[0.22em] uppercase text-ember/90 mb-3">
          How often do you play?
        </div>
        <div className="grid grid-cols-2 gap-2">
          {PLAY_CARDS.map((p) => {
            const isOn = play === p.value;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => onChangePlay(p.value)}
                className={[
                  "rounded-md border px-4 py-3 text-left text-sm transition",
                  isOn
                    ? "border-forest bg-forest text-bone"
                    : "border-forest/15 bg-bone text-charcoal hover:border-forest",
                ].join(" ")}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <PrimaryButton onClick={onNext} disabled={submitting}>
        Continue
      </PrimaryButton>
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
        className="w-full rounded-md bg-ember py-4 text-base font-medium text-bone transition hover:bg-ember/90 disabled:cursor-not-allowed disabled:opacity-60"
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
