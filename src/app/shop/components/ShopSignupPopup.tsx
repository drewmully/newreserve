"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useMembership } from "@/app/context/MembershipContext";
import { SHOP_INTERESTS, EMAIL_CONSENT, SMS_CONSENT } from "@/lib/shopSignup";
import { MullyWordmark } from "./MullyWordmark";
import { saveShopReward, type ShopReward } from "@/lib/shopRewards";
import "./shop-signup.css";

const STORAGE = "mully_shop_signup_v1";
/** Session flag: the visitor has started buying (outfit builder, sizes, bag). */
export const PURCHASE_INTENT_KEY = "mully_purchase_intent_v1";
/** Areas where a tap means the visitor is shopping, not browsing. */
const PURCHASE_INTENT_SELECTOR = "#outfit, [data-purchase-intent]";
function hasPurchaseIntent() {
  try { return sessionStorage.getItem(PURCHASE_INTENT_KEY) === "1"; } catch { return false; }
}
function markPurchaseIntent() {
  try { sessionStorage.setItem(PURCHASE_INTENT_KEY, "1"); } catch { /* storage unavailable */ }
}
type Step = "interest" | "email" | "sms" | "done";
export function ShopSignupPopup() {
  const pathname = usePathname();
  const { cartOpen, cartCount } = useMembership();
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const cartOpenRef = useRef(cartOpen);
  const cartCountRef = useRef(cartCount);
  const fired = useRef(false);
  const [step, setStep] = useState<Step>("interest");
  const [interest, setInterest] = useState("");
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [reward, setReward] = useState<ShopReward | null>(null);
  cartOpenRef.current = cartOpen;
  cartCountRef.current = cartCount;

  function remember(days: number) {
    try { localStorage.setItem(STORAGE, String(Date.now() + days * 86400_000)); } catch { /* private browsing */ }
  }
  function close() {
    remember(step === "sms" || step === "done" ? 365 : 14);
    dialog.current?.close();
  }
  useEffect(() => {
    if (pathname !== "/shop" && pathname !== "/") return;
    const started = Date.now();
    let interacted = false;
    let dismissedUntil = 0;
    try { dismissedUntil = Number(localStorage.getItem(STORAGE)) || 0; } catch { /* storage unavailable */ }
    function blocked(manual = false) {
      const active = document.activeElement;
      const gate = document.getElementById("shop-gate-title");
      // Hold the popup for anyone clearly buying: an item in the bag, or any
      // tap/focus inside the outfit builder this session (sizes, review, add).
      // Explicit "sign up" clicks still open it.
      return cartOpenRef.current || (!manual && (cartCountRef.current > 0 || hasPurchaseIntent())) ||
        document.visibilityState !== "visible" ||
        Boolean(gate) || Boolean(document.querySelector("dialog[open]")) ||
        document.body.dataset.shopBuilderInView === "true" ||
        Boolean(active?.matches("input,textarea,select,[contenteditable=true]"));
    }
    function show(manual = false) {
      if ((!manual && (fired.current || Date.now() < dismissedUntil)) || blocked(manual)) return;
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
    function interaction(event?: Event) {
      interacted = true;
      const target = event?.target;
      if (target instanceof Element && target.closest(PURCHASE_INTENT_SELECTOR)) markPurchaseIntent();
    }
    function exit(event: MouseEvent) {
      if (event.clientY <= 0 && matchMedia("(pointer:fine)").matches && Date.now() - started >= 15_000 && interacted) show();
    }
    function manual() { show(true); }
    // A timer alone never interrupts a passive visitor. Require interaction,
    // suppress during shopping tasks, and stop after a single impression.
    const timer = window.setInterval(() => {
      if (Date.now() - started >= 45_000 && interacted) show();
    }, 3000);
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("pointerdown", interaction, { passive: true });
    document.addEventListener("focusin", interaction);
    document.addEventListener("mouseout", exit);
    window.addEventListener("mully:open-signup", manual);
    return () => {
      clearInterval(timer);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("pointerdown", interaction);
      document.removeEventListener("focusin", interaction);
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
      if (!response.ok || !result.ok || (step === "email" && !result.receipt)) {
        throw new Error(result.error === "invalid_phone_or_receipt"
          ? "Use a valid phone number, including your country code outside the US."
          : result.error === "expired_receipt" ? "This step expired. Close this window and keep browsing; your email was saved."
          : "We couldn’t save that just now. Please try again.");
      }
      remember(365);
      if (result.reward) { setReward(result.reward); saveShopReward(result.reward); }
      if (step === "email") { setReceipt(result.receipt); setStep("sms"); }
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
        <h2 id="signup-heading" tabIndex={-1} data-step-focus>{step === "interest" ? "Good finds.\nYour kind." : step === "email" ? "Your edit. 10% off." : step === "sms" ? "Make it 15%?" : "Good taste. Rewarded."}</h2>
        {step === "interest" ? <>
          <p>What catches your eye? Choose your edit, then join our email list for 10% off.</p>
          <div className="shop-signup__choices">
            {SHOP_INTERESTS.map(item => <button key={item.id} onClick={() => { setInterest(item.id); setStep("email"); }}>
              <span>{item.label}<small>{item.note}</small></span><span aria-hidden="true">↗</span>
            </button>)}
          </div>
          <button className="shop-signup__skip" onClick={close}>Just browsing</button>
        </> : step === "done" ? <>
          <p>{reward ? `${reward.percent}% off your purchase. Your code is saved for this browser and will be added to your bag.` : "Your preferences are saved."}</p>
          {reward && <p className="shop-signup__reward"><strong>{reward.code}</strong><span>Enter at checkout on another device.</span></p>}
          <p className="shop-signup__fine">One use per customer on one-time merchandise. No expiry. Cannot be combined with other offers. Shopify applies the best eligible discount.</p>
          <button className="shop-signup__submit" onClick={close}>Back to the edit ↗</button>
        </> : <form key={step} onSubmit={submit}>
          <p>{step === "email" ? "Considered picks, new arrivals and 10% off your purchase. Join our email list below." : "Your 10% is yours. Sign up for occasional texts to upgrade to 15%, or keep your email reward."}</p>
          {step === "sms" && reward && <p className="shop-signup__reward"><strong>{reward.code}</strong><span>{reward.percent}% off, already saved.</span></p>}
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
          <button className="shop-signup__submit" disabled={busy}>{busy ? "Saving…" : step === "email" ? "Get 10% off ↗" : "Upgrade to 15% ↗"}</button>
          <button className="shop-signup__skip" type="button" onClick={step === "sms" ? () => { setStep("done"); setError(""); } : close}>
            {step === "sms" ? "Keep my 10%" : "Not right now"}
          </button>
          <p className="shop-signup__fine">No purchase or Reserve subscription required.</p>
        </form>}
      </div>
      <figure className="shop-signup__visual">
        <img src="/shop/hero-fall-2026.jpg" alt="A quiet afternoon on the golf course" loading="lazy" />
        <figcaption>On the course.<br />Beyond the round.<span>The Mully edit</span></figcaption>
      </figure>
    </div>
  </dialog>;
}
