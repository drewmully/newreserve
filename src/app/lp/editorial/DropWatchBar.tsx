"use client";

/**
 * DropWatchBar — floating footer on /lp/editorial.
 *
 * Design constraints (from the brief):
 *   • "Never miss a drop" copy, editorial voice, no em dashes
 *   • Not in your face. Delayed appearance so it doesn't hit on load.
 *   • Submitting shows "You're in." then removes itself entirely.
 *   • Dismissible via X; dismissal remembered so it doesn't nag.
 *
 * Trigger: appears once EITHER the user has scrolled past 40% of the page
 * OR they've been idle-viewing for 20 seconds, whichever comes first.
 * Never shows on the initial paint.
 *
 * Persistence (localStorage):
 *   mully_drop_bar_state = "signed" | "dismissed:<epoch_ms>"
 *   signed        → never show again on this browser
 *   dismissed:*   → hide for 30 days from that timestamp
 */

import { useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "mully_drop_bar_state";
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SHOW_AFTER_MS = 20_000;
const SHOW_AFTER_SCROLL_PCT = 0.4;

type PersistedState =
  | { kind: "signed" }
  | { kind: "dismissed"; at: number }
  | { kind: "fresh" };

function readState(): PersistedState {
  if (typeof window === "undefined") return { kind: "fresh" };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { kind: "fresh" };
    if (raw === "signed") return { kind: "signed" };
    if (raw.startsWith("dismissed:")) {
      const at = parseInt(raw.slice("dismissed:".length), 10);
      if (!Number.isNaN(at)) return { kind: "dismissed", at };
    }
    return { kind: "fresh" };
  } catch {
    return { kind: "fresh" };
  }
}

function writeState(state: "signed" | "dismissed") {
  if (typeof window === "undefined") return;
  try {
    const val =
      state === "signed" ? "signed" : `dismissed:${Date.now().toString()}`;
    window.localStorage.setItem(STORAGE_KEY, val);
  } catch {
    /* swallow */
  }
}

function getHomepageVariant(): string | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("mr_ab="));
  if (!raw) return null;
  const bucket = parseInt(raw.slice("mr_ab=".length), 10);
  if (Number.isNaN(bucket)) return null;
  return bucket < 50 ? "control" : "variant-a";
}

function getDistinctId(): string {
  // PostHog stores its distinct id on window if the browser SDK has booted.
  // Best-effort — fall back to a random string if not available.
  if (typeof window !== "undefined") {
    const anyWin = window as unknown as {
      posthog?: { get_distinct_id?: () => string };
    };
    const fn = anyWin.posthog?.get_distinct_id;
    if (typeof fn === "function") {
      try {
        return fn.call(anyWin.posthog);
      } catch {
        /* fall through */
      }
    }
  }
  return `anon-${Math.random().toString(36).slice(2, 12)}`;
}

type Status =
  | "idle" // showing email form
  | "submitting" // email in flight
  | "success" // "You're in." flash before stylist prompt
  | "error"
  | "stylist" // showing stylist opt-in form
  | "stylist-submitting"
  | "stylist-done" // final "Thanks." before hiding
  | "stylist-error";

export default function DropWatchBar() {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [optIn, setOptIn] = useState(true);
  const [hp, setHp] = useState(""); // honeypot
  const inputRef = useRef<HTMLInputElement | null>(null);
  const phoneRef = useRef<HTMLInputElement | null>(null);
  const shownRef = useRef(false);

  // ─── Decide whether we should ever appear ────────────────────────────
  useEffect(() => {
    const state = readState();
    if (state.kind === "signed") return;
    if (
      state.kind === "dismissed" &&
      Date.now() - state.at < DISMISS_TTL_MS
    ) {
      return;
    }

    let mounted = true;
    const reveal = () => {
      if (!mounted || shownRef.current) return;
      shownRef.current = true;
      setVisible(true);
    };

    const timer = window.setTimeout(reveal, SHOW_AFTER_MS);

    const onScroll = () => {
      const doc = document.documentElement;
      const total = doc.scrollHeight - window.innerHeight;
      if (total <= 0) return;
      const pct = window.scrollY / total;
      if (pct >= SHOW_AFTER_SCROLL_PCT) reveal();
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      mounted = false;
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const dismiss = () => {
    // If they dismiss mid-stylist flow, treat it as a decline so we still
    // record the choice against the Firestore row. Fire-and-forget.
    if (
      (status === "stylist" || status === "stylist-error") &&
      email
    ) {
      void fetch("/api/editorial/drop-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          stage: "stylist",
          stylistOptIn: false,
          variant: getHomepageVariant(),
          distinctId: getDistinctId(),
        }),
      }).catch(() => {
        /* swallow */
      });
    }
    writeState("dismissed");
    setVisible(false);
  };

  const submit = async (evt: React.FormEvent) => {
    evt.preventDefault();
    if (status === "submitting" || status === "success") return;
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setStatus("error");
      inputRef.current?.focus();
      return;
    }
    setStatus("submitting");
    try {
      const res = await fetch("/api/editorial/drop-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          hp,
          variant: getHomepageVariant(),
          distinctId: getDistinctId(),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Mark signed so the bar never re-opens on this browser, but keep
      // the bar visible while we prompt for the stylist follow-up.
      writeState("signed");
      setStatus("success");
      // Brief "You're in." flash, then swap into the stylist prompt.
      window.setTimeout(() => setStatus("stylist"), 1600);
    } catch (err) {
      console.error("[DropWatchBar] submit failed", err);
      setStatus("error");
    }
  };

  const submitStylist = async (evt: React.FormEvent) => {
    evt.preventDefault();
    if (status === "stylist-submitting") return;

    // If they didn't opt in, record the decline and close.
    if (!optIn) {
      setStatus("stylist-submitting");
      try {
        await fetch("/api/editorial/drop-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            stage: "stylist",
            stylistOptIn: false,
            variant: getHomepageVariant(),
            distinctId: getDistinctId(),
          }),
        });
      } catch {
        /* swallow */
      }
      setStatus("stylist-done");
      window.setTimeout(() => setVisible(false), 1600);
      return;
    }

    // Opted in: phone required.
    const digitCount = phone.replace(/\D/g, "").length;
    if (digitCount < 7) {
      setStatus("stylist-error");
      phoneRef.current?.focus();
      return;
    }

    setStatus("stylist-submitting");
    try {
      const res = await fetch("/api/editorial/drop-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          stage: "stylist",
          stylistOptIn: true,
          phone: phone.trim(),
          variant: getHomepageVariant(),
          distinctId: getDistinctId(),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("stylist-done");
      window.setTimeout(() => setVisible(false), 2000);
    } catch (err) {
      console.error("[DropWatchBar] stylist submit failed", err);
      setStatus("stylist-error");
    }
  };

  // Stylist stage needs more room, so we widen the pill + swap to rounded
  // corners instead of a fully rounded capsule.
  const inStylistStage =
    status === "stylist" ||
    status === "stylist-submitting" ||
    status === "stylist-error" ||
    status === "stylist-done";

  const shellClass = useMemo(() => {
    const base =
      "fixed left-1/2 -translate-x-1/2 z-40 " +
      "bottom-3 md:bottom-5 " +
      "px-4 py-3 md:px-5 md:py-3 " +
      "bg-forest/95 text-bone " +
      "backdrop-blur-sm " +
      "shadow-[0_12px_40px_rgba(0,0,0,0.28)] " +
      "border border-bone/10 " +
      "transition-all duration-500 ease-out";
    const shape = inStylistStage
      ? "w-[calc(100%-1.5rem)] md:w-auto md:max-w-[640px] rounded-2xl"
      : "w-[calc(100%-1.5rem)] md:w-auto md:max-w-[560px] rounded-full";
    if (!visible) {
      return `${base} ${shape} opacity-0 translate-y-4 pointer-events-none`;
    }
    return `${base} ${shape} opacity-100 translate-y-0`;
  }, [visible, inStylistStage]);

  return (
    <div
      className={shellClass}
      role="region"
      aria-label="Never miss a drop"
      aria-hidden={!visible}
    >
      {status === "success" ? (
        <div className="flex items-center justify-center gap-2 px-2">
          <span className="font-serif italic text-[15px] md:text-[16px]">
            You&apos;re in.
          </span>
        </div>
      ) : status === "stylist-done" ? (
        <div className="flex items-center justify-center gap-2 px-2">
          <span className="font-serif italic text-[15px] md:text-[16px]">
            Thanks. We&apos;ll be in touch.
          </span>
        </div>
      ) : inStylistStage ? (
        <form
          onSubmit={submitStylist}
          className="flex flex-col gap-2.5"
          noValidate
        >
          <div className="flex items-start gap-3">
            <label className="flex items-start gap-2.5 flex-1 cursor-pointer group/opt select-none">
              <input
                type="checkbox"
                checked={optIn}
                onChange={(e) => {
                  setOptIn(e.target.checked);
                  if (status === "stylist-error") setStatus("stylist");
                }}
                className="mt-[3px] w-3.5 h-3.5 accent-bone shrink-0 cursor-pointer"
                aria-label="Have a stylist reach out"
              />
              <span className="font-serif text-[14px] md:text-[15px] leading-snug text-bone/95">
                Have one of our stylists text me picks made for how I play and
                dress.
              </span>
            </label>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="shrink-0 w-6 h-6 flex items-center justify-center text-bone/50 hover:text-bone transition-colors -mr-1 -mt-0.5"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M1 1L9 9M9 1L1 9"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <div
            className={
              "flex items-center gap-2 md:gap-3 transition-opacity duration-300 " +
              (optIn ? "opacity-100" : "opacity-40 pointer-events-none")
            }
          >
            <input
              ref={phoneRef}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (status === "stylist-error") setStatus("stylist");
              }}
              placeholder="phone number"
              disabled={!optIn || status === "stylist-submitting"}
              className={
                "flex-1 min-w-0 bg-transparent " +
                "text-bone placeholder-bone/40 " +
                "text-[13px] md:text-[14px] " +
                "border-0 border-b border-bone/25 " +
                "focus:border-bone focus:outline-none " +
                "px-1 py-1 " +
                (status === "stylist-error" ? "border-ember" : "")
              }
              aria-invalid={status === "stylist-error"}
              aria-label="Phone number"
            />
            <button
              type="submit"
              disabled={status === "stylist-submitting"}
              className={
                "shrink-0 " +
                "text-[10px] md:text-[11px] tracking-[0.24em] uppercase font-medium " +
                "text-bone hover:text-bone/80 " +
                "px-3 py-1.5 " +
                "border border-bone/40 hover:border-bone " +
                "rounded-full " +
                "transition-colors duration-200 " +
                "disabled:opacity-50 disabled:cursor-not-allowed"
              }
            >
              {status === "stylist-submitting"
                ? "…"
                : optIn
                  ? "Send"
                  : "No thanks"}
            </button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={submit}
          className="flex items-center gap-2 md:gap-3"
          noValidate
        >
          <span
            className="hidden md:inline text-[10px] tracking-[0.28em] uppercase text-bone/70 shrink-0 pl-1"
          >
            Never miss a drop
          </span>
          <span
            className="md:hidden text-[9px] tracking-[0.24em] uppercase text-bone/70 shrink-0"
          >
            Never miss a drop
          </span>
          <input
            ref={inputRef}
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (status === "error") setStatus("idle");
            }}
            placeholder="your@email.com"
            className={
              "flex-1 min-w-0 bg-transparent " +
              "text-bone placeholder-bone/40 " +
              "text-[13px] md:text-[14px] " +
              "border-0 border-b border-bone/25 " +
              "focus:border-bone focus:outline-none " +
              "px-1 py-1 " +
              (status === "error" ? "border-ember" : "")
            }
            aria-invalid={status === "error"}
            aria-label="Email address"
            disabled={status === "submitting"}
          />
          {/* Honeypot: hidden from users, catches naive bots */}
          <input
            type="text"
            name="company"
            tabIndex={-1}
            autoComplete="off"
            value={hp}
            onChange={(e) => setHp(e.target.value)}
            className="absolute left-[-9999px] top-[-9999px] w-px h-px opacity-0"
            aria-hidden="true"
          />
          <button
            type="submit"
            disabled={status === "submitting"}
            className={
              "shrink-0 " +
              "text-[10px] md:text-[11px] tracking-[0.24em] uppercase font-medium " +
              "text-bone hover:text-bone/80 " +
              "px-3 py-1.5 " +
              "border border-bone/40 hover:border-bone " +
              "rounded-full " +
              "transition-colors duration-200 " +
              "disabled:opacity-50 disabled:cursor-not-allowed"
            }
          >
            {status === "submitting" ? "…" : "Join"}
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className={
              "shrink-0 w-6 h-6 flex items-center justify-center " +
              "text-bone/50 hover:text-bone " +
              "transition-colors duration-200 " +
              "-mr-1"
            }
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M1 1L9 9M9 1L1 9"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </form>
      )}
    </div>
  );
}
