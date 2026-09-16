"use client";

import { useEffect, useState, type FormEvent } from "react";
import { MullyWordmark } from "./MullyWordmark";

const COOKIE_NAME = "mully_shop_gate_v1";
const CORRECT_PASSWORD = "mullyshop";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=")[1]) : null;
}

function writeCookie(name: string, value: string, days = 30) {
  if (typeof document === "undefined") return;
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

/**
 * "Under Construction" gate for /shop. Not real auth — a soft-launch
 * curtain so we can iterate on the shop while it's linked from the main
 * site's nav. Password is `mullyshop` and is remembered in a 30-day
 * cookie so a returning user doesn't see the modal again.
 *
 * The gate mounts client-side, so first paint always shows the shop —
 * the modal appears on hydration if the cookie is missing. That's the
 * right trade-off: search crawlers and no-JS agents still see the page,
 * and a merged-but-work-in-progress /shop won't 404 real customers
 * clicking a link.
 */
export function ShopPasswordGate({ accent }: { accent: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const passed = readCookie(COOKIE_NAME) === "1";
    if (!passed) setOpen(true);
  }, []);

  // Prevent scroll while the modal is open.
  useEffect(() => {
    if (!mounted) return;
    document.documentElement.style.overflow = open ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open, mounted]);

  if (!open || !mounted) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (value.trim().toLowerCase() === CORRECT_PASSWORD) {
      writeCookie(COOKIE_NAME, "1");
      setOpen(false);
      return;
    }
    setError("That's not it. Try again.");
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-charcoal/95 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shop-gate-title"
    >
      <div className="w-full max-w-md border border-white/10 bg-cream p-8 shadow-2xl sm:p-10">
        <div className="mb-8 flex items-center justify-between">
          <MullyWordmark accent={accent} className="text-2xl" />
          <span
            className="border px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.25em]"
            style={{ color: accent, borderColor: accent }}
          >
            Preview
          </span>
        </div>

        <h2
          id="shop-gate-title"
          className="font-serif text-3xl leading-tight tracking-tight text-charcoal sm:text-4xl"
        >
          The shop's still coming together.
        </h2>
        <p className="mt-3 text-sm text-charcoal/60">
          A soft launch for friends of Mully. Enter the password to take a look.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-charcoal/50">
              Password
            </span>
            <input
              type="password"
              autoComplete="off"
              autoFocus
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              className="mt-2 block w-full border border-charcoal/20 bg-white px-3 py-3 font-mono text-sm text-charcoal outline-none transition-colors focus:border-charcoal"
              style={{
                caretColor: accent,
              }}
            />
          </label>
          {error && (
            <p className="text-xs" style={{ color: accent }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-cream transition-opacity hover:opacity-90"
            style={{ backgroundColor: accent }}
          >
            Enter
          </button>
        </form>

        <p className="mt-6 text-[10px] font-mono uppercase tracking-[0.2em] text-charcoal/40">
          Or head back to <a href="/" className="underline underline-offset-2 hover:text-charcoal">mymully.com</a>
        </p>
      </div>
    </div>
  );
}
