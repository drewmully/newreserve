"use client";

/**
 * ConsultLPClient — mobile-first landing page for the Martine style-consult
 * opt-in flow. See page.tsx for the strategic overview.
 *
 * Structure top to bottom:
 *   1. Hero: headline + subhead + phone form (all above the fold on mobile)
 *   2. How it works: three-tile strip
 *   3. Meet Martine: photo + bio (trust)
 *   4. Reviews (Junip): existing ReviewsBlock component
 *   5. What membership unlocks: soft Reserve/Access mention + $50 credit
 *   6. FAQ: four items
 *   7. Footer with legal + privacy
 */

import { useEffect, useState } from "react";
import Image from "next/image";
import { trackEvent } from "@/lib/tracking";
import { captureAttributionFromUrl } from "@/lib/attribution";
import { GlassHeader } from "@/app/components/ClientComponents";
import { ReviewsBlock } from "../_shared/LPSections";

// Post-submit redirect: after we show the SuccessCard for a beat (so the
// visitor registers that Martine is about to text them), forward them to the
// subscription landing page so they can convert in the same session while
// they're still warm. utm params on the current URL are carried through so
// the subscription page's attribution capture picks up the same source.
const POST_SUBMIT_REDIRECT_PATH = "/lp/subscription";
const POST_SUBMIT_REDIRECT_DELAY_MS = 2500;

function buildRedirectUrl(): string {
  if (typeof window === "undefined") return POST_SUBMIT_REDIRECT_PATH;
  const current = new URL(window.location.href);
  const next = new URL(POST_SUBMIT_REDIRECT_PATH, window.location.origin);
  // Carry through marketing attribution + fbclid/gclid so downstream tracking
  // stays glued to the same visitor.
  const carry = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "fbclid",
    "gclid",
  ];
  for (const key of carry) {
    const v = current.searchParams.get(key);
    if (v) next.searchParams.set(key, v);
  }
  // Tag the entry so we can filter subscription-page visits that came from
  // the consult flow in analytics.
  next.searchParams.set("from", "consult");
  return next.pathname + next.search;
}

// Format a raw digit string into a US-style display like "(313) 555-1234"
// while keeping the underlying value simple to submit. We ship the raw
// digits + a country prefix to the API, which does E.164 normalization.
function formatUSPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7)
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

type Status = "idle" | "submitting" | "success" | "error";

export default function ConsultLPClient() {
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trackEvent("lp_consult_view");
    captureAttributionFromUrl();
  }, []);

  // Redirect to /lp/subscription after a short delay so the user reads the
  // success card first. Kept as a local function so both the happy path and
  // the 15s-abort path share the exact same behavior.
  function scheduleRedirect() {
    if (typeof window === "undefined") return;
    const dest = buildRedirectUrl();
    trackEvent("lp_consult_redirect_scheduled", {
      properties: { dest, delay_ms: POST_SUBMIT_REDIRECT_DELAY_MS },
    });
    window.setTimeout(() => {
      // Use replace so back-button doesn't bounce the visitor to the LP
      // (they've already submitted; there's nothing useful to go back to).
      window.location.replace(dest);
    }, POST_SUBMIT_REDIRECT_DELAY_MS);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) {
      setError("Please enter a valid US phone number.");
      return;
    }

    setStatus("submitting");
    // 15s client-side cap so a slow API can never leave the user staring
    // at a spinner forever. The server does the real work via next/after,
    // so any response we get after this cap doesn't change the outcome.
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch("/api/consult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          phone: `+1${digits}`,
          source: "lp_consult",
          consent_text:
            "By tapping Text me, you agree to receive texts from Mully at this number. Reply STOP to opt out. Msg and data rates may apply.",
          landing_url:
            typeof window !== "undefined" ? window.location.href : null,
        }),
      });
      if (!res.ok) {
        // Log the real reason for debugging but show the user a soft, human message.
        const data = await res.json().catch(() => ({}));
        // eslint-disable-next-line no-console
        console.error("[consult] submit failed", {
          status: res.status,
          body: data,
        });
        throw new Error(
          "Couldn't send that just now. Try again in a moment.",
        );
      }
      // Fire the Lead event with the full E.164 phone so server-side Meta
      // CAPI can hash it (ph) and get a strong match. phone is stripped by
      // trackEvent before it hits the client-side pixel (fbq call has no PII).
      trackEvent("lp_consult_submit", {
        phone: `+1${digits}`,
        properties: { phone_last4: digits.slice(-4) },
      });
      setStatus("success");
      scheduleRedirect();
    } catch (err) {
      clearTimeout(abortTimer);
      // If we hit the 15s cap, the server has almost certainly already
      // enrolled the visitor via next/after. Show the success card so
      // they check their phone (Martine's opener is on its way) instead
      // of an error that makes them try again and duplicate the enroll.
      const wasAborted =
        err instanceof DOMException && err.name === "AbortError";
      if (wasAborted) {
        trackEvent("lp_consult_submit_timeout", {
          phone_last4: digits.slice(-4),
        });
        // Server almost certainly enrolled; fire Lead so Meta still counts it.
        trackEvent("lp_consult_submit", {
          phone: `+1${digits}`,
          properties: {
            phone_last4: digits.slice(-4),
            timed_out: true,
          },
        });
        setStatus("success");
        scheduleRedirect();
        return;
      }
      const msg =
        err instanceof Error ? err.message : "Something went wrong.";
      setError(msg);
      setStatus("error");
      trackEvent("lp_consult_submit_error", { message: msg });
      return;
    }
    clearTimeout(abortTimer);
  }

  return (
    <div className="min-h-screen bg-bone text-charcoal">
      <GlassHeader />

      {/* ---------- HERO ---------- */}
      <section className="relative pt-28 pb-14 sm:pt-32 sm:pb-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2 md:gap-14">
            {/* Text + form column */}
            <div>
              <div className="mb-3 text-[11px] uppercase tracking-[0.28em] text-ember/80">
                A note from your stylist
              </div>
              <h1 className="font-serif text-4xl leading-[1.05] text-forest sm:text-5xl md:text-6xl">
                Get a free style consult from Martine.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-charcoal/85 sm:text-xl">
                Mully&rsquo;s head stylist will text you personally, build a
                profile of your bag, and hand-pick a few pieces worth looking
                at. No pressure.
              </p>

              {status !== "success" ? (
                <form
                  onSubmit={handleSubmit}
                  className="mt-7 max-w-md"
                  aria-label="Sign up for a style consult"
                >
                  <label
                    htmlFor="consult-phone"
                    className="block text-sm font-medium text-forest"
                  >
                    Your mobile number
                  </label>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input
                      id="consult-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel-national"
                      required
                      placeholder="(313) 555-1234"
                      value={phone}
                      onChange={(e) => setPhone(formatUSPhone(e.target.value))}
                      className="h-12 flex-1 rounded-md border border-forest/25 bg-white px-4 text-base text-charcoal placeholder:text-charcoal/40 focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20"
                      aria-invalid={!!error}
                      aria-describedby={error ? "consult-error" : undefined}
                      disabled={status === "submitting"}
                    />
                    <button
                      type="submit"
                      disabled={status === "submitting"}
                      className="h-12 rounded-md bg-forest px-6 text-base font-medium text-bone transition hover:bg-forest/90 focus:outline-none focus:ring-2 focus:ring-forest/40 disabled:opacity-60 sm:px-8"
                    >
                      {status === "submitting" ? "Sending…" : "Text me"}
                    </button>
                  </div>
                  {error ? (
                    <p
                      id="consult-error"
                      role="alert"
                      className="mt-3 text-sm text-ember"
                    >
                      {error}
                    </p>
                  ) : null}
                  <p className="mt-3 text-xs leading-relaxed text-charcoal/60">
                    By tapping <span className="font-medium">Text me</span>, you
                    agree to receive texts from Mully at this number, including
                    from an assistant working with Martine. Reply STOP to opt
                    out. Msg and data rates may apply. See our{" "}
                    <a
                      href="/policies/privacy"
                      className="underline underline-offset-2 hover:text-forest"
                    >
                      Privacy Policy
                    </a>
                    .
                  </p>
                  <p className="mt-4 text-sm font-medium text-forest">
                    $50 Pro Shop credit reserved for you as a Mully member.
                  </p>
                </form>
              ) : (
                <SuccessCard />
              )}
            </div>

            {/* Photo column — hero uses the working-at-the-rack shot (4:5) */}
            <div className="relative order-first md:order-none">
              <div className="relative aspect-[4/5] w-full overflow-hidden rounded-lg bg-forest/10">
                <Image
                  src="/founders/martine-hero.webp"
                  alt="Martine Jordan, head stylist at Mully, picking pieces from the styling rack"
                  fill
                  priority
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="object-cover"
                />
              </div>
              <p className="mt-3 text-center text-xs uppercase tracking-[0.24em] text-charcoal/60 sm:text-left">
                Martine Jordan &middot; Head Stylist, Mully
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- HOW IT WORKS ---------- */}
      <section className="border-y border-forest/10 bg-bone-dark/40 py-14 sm:py-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="mb-10 text-center">
            <div className="mb-2 text-[11px] uppercase tracking-[0.28em] text-ember/80">
              How it works
            </div>
            <h2 className="font-serif text-3xl text-forest sm:text-4xl">
              A real conversation, not a lead form.
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 sm:gap-8">
            {HOW_IT_WORKS.map((s) => (
              <div
                key={s.n}
                className="rounded-lg border border-forest/10 bg-white p-6 shadow-sm"
              >
                <div className="mb-3 font-serif text-3xl text-ember">
                  {s.n}
                </div>
                <h3 className="mb-2 font-serif text-xl text-forest">
                  {s.title}
                </h3>
                <p className="text-sm leading-relaxed text-charcoal/80">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- MEET MARTINE ---------- */}
      <section className="bg-bone py-16 sm:py-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <div className="mb-10 text-center sm:mb-14">
            <div className="mb-2 text-[11px] uppercase tracking-[0.28em] text-ember/80">
              Who you&rsquo;re texting with
            </div>
            <h2 className="font-serif text-3xl leading-[1.1] text-forest sm:text-4xl">
              Meet Martine.
            </h2>
          </div>
          <div className="grid grid-cols-1 items-center gap-8 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)] sm:gap-12">
            <div className="relative mx-auto aspect-square w-40 overflow-hidden rounded-full bg-forest/10 sm:mx-0 sm:w-full">
              <Image
                src="/founders/martine.webp"
                alt="Martine Jordan"
                fill
                sizes="(max-width: 640px) 160px, 40vw"
                className="object-cover"
              />
            </div>
            <div>
              <p className="text-lg leading-relaxed text-charcoal/85">
                Martine is Mully&rsquo;s head stylist. She builds every member
                profile by hand, size, glove hand, climate, and taste, and
                hand-picks each Reserve shipment from live inventory. Not an
                algorithm, not a drop-shipper, a real person who knows the
                brands.
              </p>
              <p className="mt-4 text-lg leading-relaxed text-charcoal/85">
                On text, she&rsquo;s your inside person at Mully. Ask her
                about a brand, a fit, or what to put in your bag next season.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- REVIEWS (Junip) ---------- */}
      <ReviewsBlock />

      {/* ---------- MEMBERSHIP UNLOCK ---------- */}
      <section className="bg-forest py-16 text-bone sm:py-24">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
          <div className="mb-3 text-[11px] uppercase tracking-[0.28em] text-ember/90">
            The rest of the club
          </div>
          <h2 className="font-serif text-3xl leading-tight sm:text-4xl">
            When you&rsquo;re in, your $50 Pro Shop credit is waiting.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-bone/85 sm:text-lg">
            Members get Martine year-round, member pricing on the Pro Shop,
            and insider access to drops. Reserve is $250 a quarter, a curated
            shipment built to your profile. Access is $99 a year, member
            pricing without the shipment. Martine will help you figure out
            which fits you.
          </p>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className="bg-bone py-16 sm:py-24">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="mb-10 text-center">
            <div className="mb-2 text-[11px] uppercase tracking-[0.28em] text-ember/80">
              Answered
            </div>
            <h2 className="font-serif text-3xl text-forest sm:text-4xl">
              A few questions people ask.
            </h2>
          </div>
          <div className="space-y-4">
            {FAQ.map((q) => (
              <details
                key={q.q}
                className="group rounded-lg border border-forest/10 bg-white p-5 open:shadow-sm"
              >
                <summary className="cursor-pointer list-none font-serif text-lg text-forest">
                  <span className="mr-2 inline-block text-ember">+</span>
                  {q.q}
                </summary>
                <p className="mt-3 text-base leading-relaxed text-charcoal/80">
                  {q.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- FOOTER ---------- */}
      <footer className="border-t border-forest/10 bg-bone-dark/60 py-10">
        <div className="mx-auto max-w-5xl px-4 text-center text-xs leading-relaxed text-charcoal/60 sm:px-6">
          <p>
            SMS from Mully is opt-in. Reply STOP to opt out, HELP for help. Msg
            frequency varies. Msg and data rates may apply.
          </p>
          <p className="mt-3">
            <a
              href="/policies/privacy"
              className="underline underline-offset-2 hover:text-forest"
            >
              Privacy
            </a>{" "}
            &middot;{" "}
            <a
              href="/policies/terms"
              className="underline underline-offset-2 hover:text-forest"
            >
              Terms
            </a>
          </p>
          <p className="mt-3">
            &copy; {new Date().getFullYear()} Mully. Detroit, MI.
          </p>
        </div>
      </footer>
    </div>
  );
}

// ---------- SubComponents ----------

function SuccessCard() {
  return (
    <div className="mt-7 max-w-md rounded-lg border border-forest/20 bg-white p-6">
      <div className="mb-3 flex items-center gap-3">
        <span
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-forest text-bone"
          aria-hidden="true"
        >
          &#10003;
        </span>
        <h2 className="font-serif text-xl text-forest">
          On its way. Check your phone.
        </h2>
      </div>
      <p className="text-sm leading-relaxed text-charcoal/80">
        Martine will text you in the next minute or two. Save her contact when
        it lands so her name shows on every message.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-charcoal/70">
        Taking you to your membership options now&hellip;
      </p>
    </div>
  );
}

// ---------- Static content ----------

const HOW_IT_WORKS = [
  {
    n: "01",
    title: "Drop your number",
    body: "One field, one tap. That&rsquo;s the whole form.",
  },
  {
    n: "02",
    title: "Martine texts you",
    body: "A short back and forth to build your profile: size, glove hand, taste.",
  },
  {
    n: "03",
    title: "Real recommendations",
    body: "She hand-picks pieces worth looking at, from live inventory. Not a blast.",
  },
];

const FAQ = [
  {
    q: "Is this a bot?",
    a: "Martine is real. She works with an assistant that helps route messages and keep her responsive. Anything sensitive goes straight to a person on the team.",
  },
  {
    q: "Do I have to become a member?",
    a: "No. The consult is free. If it lands for you, membership is there. If not, no pitch.",
  },
  {
    q: "What&rsquo;s the $50 Pro Shop credit?",
    a: "When you become a Reserve or Access member, we apply a $50 credit to your account to spend on the Pro Shop. It&rsquo;s a welcome, not a discount on the membership itself.",
  },
  {
    q: "What is Reserve, what is Access?",
    a: "Reserve is $250 a quarter: a curated shipment hand-picked to your profile plus member pricing on the Pro Shop. Access is $99 a year: the member pricing without the shipment. Martine will help you figure out which fits.",
  },
];
