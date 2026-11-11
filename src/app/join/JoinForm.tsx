"use client";
import { useState } from "react";
import { trackEvent } from "@/lib/tracking";
import type { JoinSource } from "@/lib/shopSignup";

function distinctId(): string | undefined {
  try {
    const ph = (window as unknown as { posthog?: { get_distinct_id?: () => string } }).posthog;
    return ph?.get_distinct_id?.() || undefined;
  } catch {
    return undefined;
  }
}

/** Mirrors ShopNewsletter: same endpoint, consent copy and honeypot. */
export function JoinForm({ source }: { source: JoinSource }) {
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
          source, consent: form.get("consent") === "on", distinctId: distinctId(),
        }),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error("Signup failed");
      void trackEvent("newsletter_signup", {
        email: String(form.get("email") ?? "").trim().toLowerCase() || undefined,
        properties: { source },
      });
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }
  if (status === "done") {
    return (
      <div className="mt-10 border-l-2 border-sage bg-bone px-5 py-6" role="status">
        <h2 className="font-serif text-2xl text-forest">You’re on the list.</h2>
        <p className="mt-2 text-charcoal/80">The next Mully Edit lands in your inbox soon.</p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="mt-10" data-source={source}>
      <label htmlFor="join-email" className="mb-2 block text-sm font-medium text-forest">Email address</label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="join-email" name="email" type="email" autoComplete="email" maxLength={254}
          placeholder="you@example.com" required
          className="min-h-12 w-full flex-1 rounded-none border border-forest/30 bg-white px-4 text-base text-charcoal placeholder:text-charcoal/40 focus:border-forest focus:outline-none focus:ring-2 focus:ring-sage/40"
        />
        <button
          type="submit" disabled={status === "busy"}
          className="min-h-12 bg-forest px-7 text-sm font-semibold uppercase tracking-[.12em] text-cream transition-colors hover:bg-forest-light disabled:opacity-70"
        >
          {status === "busy" ? "Joining…" : "Get the edit"}
        </button>
      </div>
      <label className="mt-4 flex items-start gap-3 text-sm leading-snug text-charcoal/80">
        <input name="consent" type="checkbox" required className="mt-0.5 h-5 w-5 shrink-0 accent-forest" />
        <span>I’d like emails from Mully. Unsubscribe anytime. <a className="underline underline-offset-2 hover:text-forest" href="/policies/privacy">Privacy policy</a>.</span>
      </label>
      <div className="sr-only" aria-hidden="true">
        <label>Company<input name="company" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {status === "error" && <p role="alert" className="mt-4 text-sm text-[#9B3D1F]">We couldn’t save your email. Please try again.</p>}
    </form>
  );
}
