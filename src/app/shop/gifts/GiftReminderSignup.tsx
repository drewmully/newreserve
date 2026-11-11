"use client";

/**
 * "Get gift shipping cutoff reminders" capture. Posts to the existing
 * /api/shop/signup route (email stage, source "gift-reminders", interest
 * "gifts"), which stores consent in Firestore and syncs to Klaviyo through
 * the "Mully Site Signup" event. No Klaviyo onsite forms: the headless site
 * doesn't load Klaviyo's script.
 *
 * On success it fires PostHog email_submitted { source: "gift_guide", tier }.
 * The route itself sends no PostHog event, so this is the only one.
 */

import { useId, useState } from "react";
import { trackEvent } from "@/lib/tracking";
import { EMAIL_CONSENT } from "@/lib/shopSignup";

type Status = "idle" | "busy" | "done" | "error";

export function GiftReminderSignup({
  tier,
  placement,
  orderBy,
  restockBy,
}: {
  tier: string;
  placement: string;
  /** Pre-formatted labels from GIFT_SHIP_BY, rendered on the server. */
  orderBy: string;
  restockBy: string;
}) {
  const id = useId();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "busy") return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    setStatus("busy");
    setError("");
    try {
      const response = await fetch("/api/shop/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "email",
          source: "gift-reminders",
          interest: "gifts",
          email,
          consent: form.get("consent") === "on",
          company: form.get("company"),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(
          result.error === "invalid_email_or_interest"
            ? "That email doesn't look right. Check it and try again."
            : result.error === "rate_limited"
              ? "Too many tries. Give it a few minutes."
              : "We couldn't save that just now. Please try again.",
        );
      }
      void trackEvent("email_submitted", {
        email,
        properties: { source: "gift_guide", tier, placement, signup_source: "gift-reminders" },
      });
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
      setStatus("error");
    }
  }

  return (
    <section className="gg-remind" aria-labelledby={`${id}-h`}>
      <div className="gg-remind__copy">
        <p className="gg-kicker">Christmas cutoffs</p>
        <h2 id={`${id}-h`} className="gg-remind__title">Get gift shipping cutoff reminders</h2>
        <p>
          We email you before {restockBy}, the last day for Restocking pieces, and again before {orderBy}, the last day for
          in-stock pieces.
        </p>
      </div>
      {status === "done" ? (
        <p className="gg-remind__done" role="status">You&apos;re on the list. We&apos;ll email you before the cutoffs.</p>
      ) : (
        <form className="gg-remind__form" onSubmit={submit} noValidate={false}>
          <div className="gg-remind__row">
            <label htmlFor={`${id}-email`} className="sr-only">Email address</label>
            <input
              id={`${id}-email`}
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              placeholder="Email address"
              maxLength={254}
            />
            <button type="submit" disabled={status === "busy"} data-gg-remind={placement}>
              {status === "busy" ? "Saving" : "Remind me"}
            </button>
          </div>
          <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" className="gg-remind__hp" />
          <label className="gg-remind__consent">
            <input name="consent" type="checkbox" required />
            <span>
              {EMAIL_CONSENT} <a href="/policies/privacy" target="_blank" rel="noopener noreferrer">Privacy</a>
            </span>
          </label>
          {error && <p className="gg-remind__error" role="alert">{error}</p>}
        </form>
      )}
    </section>
  );
}
