"use client";
import { useEffect, useState } from "react";
import { EMAIL_CONSENT } from "@/lib/shopSignup";
import { saveShopRewardCode } from "@/lib/shopCartRewards";
import type { SignupReward } from "@/lib/shopSignupReward";
import { trackEvent } from "@/lib/tracking";

export function ShopNewsletter() {
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [reward, setReward] = useState<SignupReward | null>(null);
  const [receipt, setReceipt] = useState("");
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{code: string; percent?: number}>).detail;
      if (detail?.percent === 15) setReward(current => current?.code === detail.code ? {...current, percent: 15} : current);
    };
    window.addEventListener("mully:shop-reward", update);
    return () => window.removeEventListener("mully:shop-reward", update);
  }, []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "busy") return;
    const form = new FormData(e.currentTarget);
    setStatus("busy");
    try {
      const response = await fetch("/api/shop/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "email", interest: "everything",
          email: form.get("email"), company: form.get("company"),
          source: "shop-newsletter", consent: form.get("consent") === "on",
        }),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true || !result.reward || !result.receipt) throw new Error("Signup failed");
      setReward(result.reward);
      setReceipt(result.receipt);
      if (!result.reward.redeemed) saveShopRewardCode(result.reward.code, result.reward.percent);
      void trackEvent("email_submitted", { properties: { source: "shop-newsletter" } });
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
          <p className="lede">Sign up for 10% off your whole order. Add texts for 15% off.</p>
          <button className="shop-newsletter__personalize" type="button" onClick={() => window.dispatchEvent(new Event("mully:open-signup"))}>Make it more personal ↗</button>
        </div>
        {status === "done" ? (
          <div className="shop-newsletter__success" role="status">
            <h3>{reward?.redeemed ? "You’re on the list." : `Your ${reward?.percent}% is ready.`}</h3>
            <p>{reward?.redeemed ? "Your one-time signup reward has already been used." : <><strong style={{overflowWrap:"anywhere"}}>{reward?.code}</strong><br />Saved to your bag. The better eligible offer applies, never both.</>}</p>
            {reward?.percent === 10 && !reward.redeemed && <button className="btn btn--accent" onClick={() => window.dispatchEvent(new CustomEvent("mully:open-signup", {detail:{receipt,reward}}))}>Add texts for 15% off</button>}
          </div>
        ) : (
          <form onSubmit={submit} className="shop-newsletter__form">
            <label htmlFor="shop-email">Email address</label>
            <div className="shop-newsletter__fields">
              <input id="shop-email" name="email" type="email" autoComplete="email" maxLength={254} placeholder="you@example.com" required />
              <button className="btn btn--accent" disabled={status === "busy"}>{status === "busy" ? "Preparing…" : "Get 10% off"}</button>
            </div>
            <label className="shop-newsletter__consent">
              <input name="consent" type="checkbox" required />
              <span>{EMAIL_CONSENT} <a href="/policies/privacy">Privacy policy</a>.</span>
            </label>
            <div className="sr" aria-hidden="true">
              <label>Company<input name="company" tabIndex={-1} autoComplete="off" /></label>
            </div>
            {status === "error" && <p role="alert">We couldn’t prepare your signup code. Please try again.</p>}
            <p className="shop-newsletter__consent">One use. Excludes shipping, taxes, gift cards and subscriptions. Cannot combine with BOGO15 or other discounts.</p>
          </form>
        )}
      </div>
    </section>
  );
}
