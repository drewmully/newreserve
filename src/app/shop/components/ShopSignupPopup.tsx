"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useMembership } from "@/app/context/MembershipContext";
import { SHOP_INTERESTS, EMAIL_CONSENT, SMS_CONSENT } from "@/lib/shopSignup";
import { MullyWordmark } from "./MullyWordmark";
import { saveShopRewardCode } from "@/lib/shopCartRewards";
import type { SignupReward } from "@/lib/shopSignupReward";
import "./shop-signup.css";

const STORAGE = "mully_shop_signup_v1";
type Step = "interest" | "email" | "sms" | "done";
export function ShopSignupPopup() {
  const pathname = usePathname();
  const { cartOpen } = useMembership();
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const cartOpenRef = useRef(cartOpen);
  const fired = useRef(false);
  const [step, setStep] = useState<Step>("interest");
  const [interest, setInterest] = useState("");
  const [receipt, setReceipt] = useState("");
  const [reward, setReward] = useState<SignupReward | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  cartOpenRef.current = cartOpen;

  function remember(days: number) {
    try { localStorage.setItem(STORAGE, String(Date.now() + days * 86400_000)); } catch { /* private browsing */ }
  }
  function close() {
    remember(step === "sms" || step === "done" ? 365 : 14);
    dialog.current?.close();
  }
  useEffect(() => {
    if (pathname !== "/shop") return;
    const started = Date.now();
    let interacted = false;
    let dismissedUntil = 0;
    try { dismissedUntil = Number(localStorage.getItem(STORAGE)) || 0; } catch { /* storage unavailable */ }
    function blocked() {
      const active = document.activeElement;
      const gate = document.getElementById("shop-gate-title");
      return cartOpenRef.current || document.visibilityState !== "visible" ||
        Boolean(gate) || Boolean(document.querySelector("dialog[open]")) ||
        document.body.dataset.shopBuilderInView === "true" ||
        Boolean(active?.matches("input,textarea,select,[contenteditable=true]"));
    }
    function show(manual = false) {
      if ((!manual && (fired.current || Date.now() < dismissedUntil)) || blocked()) return;
      fired.current = true;
      previousFocus.current = document.activeElement as HTMLElement;
      setOpen(true);
      dialog.current?.showModal();
    }
    function scroll() {
      interacted = true;
      const travel = document.documentElement.scrollHeight - innerHeight;
      if (Date.now() - started >= 15_000 && travel > 0 && scrollY / travel >= .3) show();
    }
    function interaction() { interacted = true; }
    function exit(event: MouseEvent) {
      if (event.clientY <= 0 && matchMedia("(pointer:fine)").matches && Date.now() - started >= 15_000 && interacted) show();
    }
    function manual(event: Event) {
      const detail = (event as CustomEvent<{receipt?: string; reward?: SignupReward}>).detail;
      if (detail?.receipt && /^[a-f0-9]{64}$/.test(detail.receipt) && detail.reward?.code) {
        setReceipt(detail.receipt);
        setReward(detail.reward);
        setInterest("everything");
        setStep("sms");
      }
      show(true);
    }
    // A timer alone never interrupts a passive visitor. Require interaction,
    // suppress during shopping tasks, and stop after a single impression.
    const timer = window.setInterval(() => {
      if (Date.now() - started >= 45_000 && interacted) show();
    }, 3000);
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("pointerdown", interaction, { passive: true });
    document.addEventListener("mouseout", exit);
    window.addEventListener("mully:open-signup", manual);
    return () => {
      clearInterval(timer);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("pointerdown", interaction);
      document.removeEventListener("mouseout", exit);
      window.removeEventListener("mully:open-signup", manual);
    };
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = old; };
  }, [open]);
  useEffect(() => {
    if (open) dialog.current?.querySelector<HTMLElement>("[data-step-focus]")?.focus({ preventScroll: true });
  }, [step, open]);
  useEffect(() => { dialog.current?.close(); setOpen(false); }, [pathname]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/shop/signup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: step, interest, receipt, email: form.get("email"),
          phone: form.get("phone"), consent: form.get("consent") === "on",
          company: form.get("company"),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok || !result.reward || (step === "email" && !result.receipt)) {
        throw new Error(result.error === "invalid_phone_or_receipt"
          ? "Use a valid phone number, including your country code outside the US."
          : result.error === "expired_receipt" ? "This step expired. Close this window and keep browsing; your email was saved."
          : result.error === "reward_unavailable" ? "Your preferences are saved, but we couldn’t prepare your code. Please try again."
          : "We couldn’t save that just now. Please try again.");
      }
      setReward(result.reward);
      if (!result.reward.redeemed) saveShopRewardCode(result.reward.code, result.reward.percent);
      remember(365);
      if (step === "email") {
        setReceipt(result.receipt);
        setStep(result.reward.percent === 15 || result.reward.redeemed ? "done" : "sms");
      }
      else setStep("done");
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="shop-signup" aria-labelledby="signup-heading"
    onCancel={close}
    onClose={() => { setOpen(false); previousFocus.current?.focus({ preventScroll: true }); }}
    onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); } }}>
    <div className="shop-signup__layout">
      <div className="shop-signup__content">
        <div className="shop-signup__top"><MullyWordmark accent="#4A3528" /><button type="button" aria-label="Close signup" onClick={close}>×</button></div>
        <p className="shop-signup__eyebrow">{step === "interest" ? "A more personal edit" : step === "email" ? "01 / The email edit" : step === "sms" ? "02 / Texts, if you like" : "You’re on the list"}</p>
        <h2 id="signup-heading" tabIndex={-1} data-step-focus>{step === "interest" ? "Good finds.\nYour kind." : step === "email" ? "Your edit. 10% off." : step === "sms" ? "Make it 15%." : reward?.redeemed ? "You’re on the list." : `Your ${reward?.percent ?? 10}% is ready.`}</h2>
        {step === "interest" ? <>
          <p>Get 10% off your whole order with email signup. Add texts for 15% off. What catches your eye?</p>
          <div className="shop-signup__choices">
            {SHOP_INTERESTS.map(item => <button key={item.id} onClick={() => { setInterest(item.id); setStep("email"); }}>
              <span>{item.label}<small>{item.note}</small></span><span aria-hidden="true">↗</span>
            </button>)}
          </div>
          <button className="shop-signup__skip" onClick={close}>Just browsing</button>
        </> : step === "done" ? <>
          <p>{reward?.redeemed ? "Your preferences are saved. Your one-time signup reward has already been used." : "Your one-time code is saved to your bag. The better eligible offer applies, never both."}</p>
          {reward && !reward.redeemed && <p className="shop-signup__reward"><strong>{reward.code}</strong><br />{reward.percent}% off your whole order.</p>}
          <p className="shop-signup__fine">One use. Excludes shipping, taxes, gift cards and subscriptions. Cannot combine with BOGO15 or other discounts.</p>
          <button className="shop-signup__submit" onClick={close}>Back to the edit ↗</button>
        </> : <form key={step} onSubmit={submit}>
          <p>{step === "email" ? "Sign up for considered picks and get a one-time code for 10% off your whole order." : reward?.redeemed ? "Your email is saved. Your signup reward has already been used. Text updates are still optional." : "Your 10% code is ready. Add your number and agree to text updates to upgrade the same code to 15% off your whole order."}</p>
          {step === "sms" && reward && !reward.redeemed && <p className="shop-signup__reward"><strong>{reward.code}</strong><br />{reward.percent}% off, saved to your bag.</p>}
          <label className="shop-signup__input-label">{step === "email" ? "Email address" : "Mobile number (optional)"}
            <input name={step === "email" ? "email" : "phone"} type={step === "email" ? "email" : "tel"}
              autoComplete={step === "email" ? "email" : "tel"} inputMode={step === "email" ? "email" : "tel"}
              placeholder={step === "email" ? "you@example.com" : "+1 (555) 555-0123"} maxLength={step === "email" ? 254 : 35} required />
          </label>
          <label className="shop-signup__consent"><input name="consent" type="checkbox" required />
            <span>{step === "email" ? EMAIL_CONSENT : SMS_CONSENT} <a href="/policies/privacy" target="_blank" rel="noopener noreferrer">Privacy</a>{step === "sms" && <> · <a href="/policies/terms" target="_blank" rel="noopener noreferrer">Terms</a></>}</span>
          </label>
          <div className="shop-signup__trap" aria-hidden="true"><label>Company<input name="company" autoComplete="off" tabIndex={-1} /></label></div>
          {error && <p className="shop-signup__error" role="alert">{error}</p>}
          <button className="shop-signup__submit" disabled={busy}>{busy ? "Preparing your code…" : step === "email" ? "Get 10% off ↗" : "Get 15% off ↗"}</button>
          <button className="shop-signup__skip" type="button" onClick={step === "sms" ? () => { setStep("done"); setError(""); } : close}>
            {step === "sms" ? "Keep my 10%" : "Not right now"}
          </button>
          <p className="shop-signup__fine">One use on your whole order. Excludes shipping, taxes, gift cards and subscriptions. Offers don’t stack; the better eligible discount applies. No purchase required to sign up.</p>
        </form>}
      </div>
      <figure className="shop-signup__visual">
        <img src="/shop/hero-fall-2026.jpg" alt="A quiet afternoon on the golf course" loading="lazy" />
        <figcaption>On the course.<br />Beyond the round.<span>The Mully edit</span></figcaption>
      </figure>
    </div>
  </dialog>;
}
