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

export default function DropWatchBar() {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [email, setEmail] = useState("");
  const [hp, setHp] = useState(""); // honeypot
  const inputRef = useRef<HTMLInputElement | null>(null);
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
      setStatus("success");
      writeState("signed");
      window.setTimeout(() => setVisible(false), 2200);
    } catch (err) {
      console.error("[DropWatchBar] submit failed", err);
      setStatus("error");
    }
  };

  const shellClass = useMemo(() => {
    const base =
      "fixed left-1/2 -translate-x-1/2 z-40 " +
      "bottom-3 md:bottom-5 " +
      "w-[calc(100%-1.5rem)] md:w-auto md:max-w-[560px] " +
      "px-4 py-3 md:px-5 md:py-3 " +
      "bg-forest/95 text-bone " +
      "backdrop-blur-sm " +
      "shadow-[0_12px_40px_rgba(0,0,0,0.28)] " +
      "border border-bone/10 " +
      "rounded-full " +
      "transition-all duration-500 ease-out";
    if (!visible) {
      return `${base} opacity-0 translate-y-4 pointer-events-none`;
    }
    return `${base} opacity-100 translate-y-0`;
  }, [visible]);

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
