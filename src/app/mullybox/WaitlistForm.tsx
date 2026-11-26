"use client";
import { useState } from "react";
import { trackEvent } from "@/lib/tracking";
import { signalVisitorIdentified } from "@/lib/visitorIdentified";
import { MULLYBOX_WAITLIST_CONSENT, MULLYBOX_WAITLIST_SOURCE } from "@/lib/shopSignup";

function distinctId(): string | undefined {
  try {
    const ph = (window as unknown as { posthog?: { get_distinct_id?: () => string } }).posthog;
    return ph?.get_distinct_id?.() || undefined;
  } catch {
    return undefined;
  }
}

/** Same endpoint, honeypot and consent pattern as JoinForm, with its own source. */
export function WaitlistForm() {
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "busy") return;
    const form = new FormData(e.currentTarget);
    setStatus("busy");
    try {
      const response = await fetch("/api/editorial/drop-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"), hp: form.get("company"),
          source: MULLYBOX_WAITLIST_SOURCE, consent: form.get("consent") === "on", distinctId: distinctId(),
        }),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error("Signup failed");
      void trackEvent("newsletter_signup", {
        email: String(form.get("email") ?? "").trim().toLowerCase() || undefined,
        properties: { source: MULLYBOX_WAITLIST_SOURCE },
      });
      signalVisitorIdentified();
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }
  if (status === "done") {
    return (
      <div className="mt-7 rounded-xl border border-[#22e1d0]/40 bg-[#0c0a1c]/70 px-5 py-4" role="status">
        <p className="font-semibold text-white">You&apos;re on the list.</p>
        <p className="mt-1 text-sm text-[#f5f1e8]/75">We&apos;ll email you the moment Mullybox 2.0 is live.</p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="mt-6" data-source={MULLYBOX_WAITLIST_SOURCE}>
      <label htmlFor="mbw-email" className="sr-only">Email address</label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="mbw-email" name="email" type="email" autoComplete="email" maxLength={254}
          placeholder="you@example.com" required
          className="min-h-12 w-full flex-1 rounded-lg border border-[#6b5f8f] bg-[#0c0a1c] px-4 text-base text-[#f5f1e8] placeholder:text-[#f5f1e8]/40 focus:border-[#22e1d0] focus:outline-none focus:ring-2 focus:ring-[#22e1d0]/30"
        />
        <button
          type="submit" disabled={status === "busy"}
          className="min-h-12 rounded-lg bg-[#ecc767] px-6 text-sm font-bold uppercase tracking-[.1em] text-[#17120a] shadow-[0_8px_24px_rgba(236,199,103,.25)] transition hover:brightness-105 disabled:opacity-70"
        >
          {status === "busy" ? "Saving…" : "Email me when it's live"}
        </button>
      </div>
      <label className="mt-4 flex items-start gap-3 text-[13px] leading-snug text-[#f5f1e8]/70">
        <input name="consent" type="checkbox" required className="mt-0.5 h-5 w-5 shrink-0 accent-[#ecc767]" />
        <span>{MULLYBOX_WAITLIST_CONSENT} <a className="underline underline-offset-2 hover:text-white" href="/policies/privacy">Privacy policy</a>.</span>
      </label>
      <div className="sr-only" aria-hidden="true">
        <label>Company<input name="company" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {status === "error" && <p role="alert" className="mt-3 text-sm text-[#ff3ea5]">We couldn&apos;t save your email. Please try again.</p>}
    </form>
  );
}
