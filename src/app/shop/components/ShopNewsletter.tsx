"use client";
import { useState } from "react";

export function ShopNewsletter() {
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
          source: "shop-newsletter", consent: form.get("consent") === "on",
        }),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error("Signup failed");
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }
  return (
    <section className="sec shop-newsletter" id="shop-newsletter">
      <div className="wrap shop-newsletter__in">
        <div>
          <h2 className="h2">The next edit, in your inbox.</h2>
          <p className="lede">New arrivals and good finds. Nothing extra.</p>
        </div>
        {status === "done" ? (
          <div className="shop-newsletter__success" role="status">
            <h3>You’re on the list.</h3>
            <p>Look out for the next Mully edit. No subscription purchase required.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="shop-newsletter__form">
            <label htmlFor="shop-email">Email address</label>
            <div className="shop-newsletter__fields">
              <input id="shop-email" name="email" type="email" autoComplete="email" maxLength={254} placeholder="you@example.com" required />
              <button className="btn btn--accent" disabled={status === "busy"}>{status === "busy" ? "Joining…" : "Get the edit"}</button>
            </div>
            <label className="shop-newsletter__consent">
              <input name="consent" type="checkbox" required />
              <span>I’d like emails from Mully. Unsubscribe anytime. <a href="/policies/privacy">Privacy policy</a>.</span>
            </label>
            <div className="sr" aria-hidden="true">
              <label>Company<input name="company" tabIndex={-1} autoComplete="off" /></label>
            </div>
            {status === "error" && <p role="alert">We couldn’t save your email. Please try again.</p>}
          </form>
        )}
      </div>
    </section>
  );
}
