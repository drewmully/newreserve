"use client";
/**
 * Take a Shot signup modal: landing > email (consent) > phone (SMS consent,
 * 3 shots) > game. Ported from the staged loader. The game module and its
 * CSS load only after the shopper taps "Take a Shot". The server decides
 * every result and issues the code; this component never makes one up.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { EMAIL_CONSENT, SMS_CONSENT } from "@/lib/shopSignup";
import { saveShopReward } from "@/lib/shopRewards";
import { getClientAnonymousId } from "@/lib/tracking";
import { KEYS, markSignedUp, writeValue, type TriggerType } from "@/lib/takeAShot/popupRules";
import { fetchReserveQuarterPrice, renewalLine } from "@/lib/takeAShot/reservePrice";
import { popupContext, trackEmailSubmitted, trackPopup } from "@/lib/takeAShot/popupTracking";
import { CODE_TERMS, FLOOR_PERCENT, RING_TIERS, SHOTS } from "@/lib/takeAShot/config";
import { MullyWordmark } from "../MullyWordmark";
import { SIGNUP_DISMISS_KEY } from "../ShopSignupPopup";
import "./take-a-shot.css";

type Claim = { code: string; pct: number; won: boolean; expiresAt: string };
type Session = { sid: string; pin: number; winds: { mph: number; dirDeg: number }[]; shots: number; floor: number; results: unknown[] };
type Step = "landing" | "email" | "phone" | "existing" | "game";
type GameModule = { mount: (root: HTMLElement, opts: Record<string, unknown>) => () => void };

const RING_COLORS = ["#E8B33F", "#E2677A", "#F2A65A", "#F4D86B", "#7FC8E8"];
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

let gamePromise: Promise<GameModule> | null = null;
function loadGame(): Promise<GameModule> {
  if (!gamePromise) {
    gamePromise = import("@/lib/takeAShot/game/game.js") as unknown as Promise<GameModule>;
    gamePromise.catch(() => { gamePromise = null; });
  }
  return gamePromise;
}

class ApiError extends Error {
  constructor(message: string, readonly code = "") { super(message); }
}
/** How long to wait for a Turnstile token before asking the player to retry. */
const TURNSTILE_WAIT_MS = 20_000;
async function api<T>(route: string, payload: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/take-a-shot/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: getClientAnonymousId(), phId: posthogDistinctId(), page: window.location.pathname, ...payload }),
    });
  } catch { throw new ApiError("Could not reach Mully. Check your connection."); }
  const json = await res.json().catch(() => ({ status: "error", error: "Something went wrong. Try again." }));
  if (json.status === "error" || !res.ok) {
    throw new ApiError(json.error && json.error.length < 120 && /\s/.test(json.error) ? json.error : "Something went wrong. Try again.",
      typeof json.code === "string" ? json.code : "");
  }
  return json as T;
}

/** posthog-js distinct id, sent with the signup so Klaviyo profiles join the PostHog funnel. */
function posthogDistinctId(): string | undefined {
  try {
    const id = (window as unknown as { posthog?: { get_distinct_id?: () => string } }).posthog?.get_distinct_id?.();
    return typeof id === "string" && id.length <= 200 ? id : undefined;
  } catch { return undefined; }
}

function remember(days: number) {
  try {
    const until = Date.now() + days * 86_400_000;
    const prev = Number(localStorage.getItem(SIGNUP_DISMISS_KEY)) || 0;
    localStorage.setItem(SIGNUP_DISMISS_KEY, String(Math.max(prev, until)));
  } catch { /* private browsing */ }
}

function formatPhone(raw: string): string {
  if (raw.trim().startsWith("+") && !raw.trim().startsWith("+1")) return raw;
  let d = raw.replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length > 6) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length > 3) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return d.length ? `(${d}` : "";
}

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; reset: (id?: string) => void; remove?: (id?: string) => void };
  }
}

function RingsArt() {
  const rings = [...RING_TIERS].reverse();
  return <svg className="tas__art" viewBox="0 0 240 240" aria-hidden="true">
    <circle cx="120" cy="120" r="116" fill="#8DB862" />
    {rings.map((t, i) => <circle key={t.ft} cx="120" cy="120" r={t.ft * 4.6 + 6} fill={RING_COLORS[rings.length - 1 - i]} stroke="#fff" strokeWidth="2" />)}
    <line x1="120" y1="120" x2="120" y2="54" stroke="#2B2018" strokeWidth="3" />
    <path d="M120 54 L152 64 L120 74 Z" fill="#8A2432" />
    <circle cx="120" cy="120" r="5" fill="#2B2018" />
  </svg>;
}

export function TakeAShotModal({ openSignal, trigger = "manual", onClosed }: { openSignal: number; trigger?: TriggerType; onClosed?: () => void }) {
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const turnstileBox = useRef<HTMLDivElement>(null);
  const turnstileToken = useRef<string>("");
  const turnstileWidget = useRef<string | undefined>(undefined);
  /** Bumped whenever a fresh token arrives, so a waiting submit can continue. */
  const [tokenSeq, setTokenSeq] = useState(0);
  /** A submit that is waiting for the Turnstile token ("Checking…"). */
  const [waiting, setWaiting] = useState<"" | "phone" | "one">("");
  const unmountGame = useRef<(() => void) | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [step, setStep] = useState<Step>("landing");
  const [email, setEmail] = useState("");
  const [emailOk, setEmailOk] = useState(false);
  const [phone, setPhone] = useState("");
  const [smsOk, setSmsOk] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "email" | "phone" | "one">("");
  const [existing, setExisting] = useState<{ claim: Claim | null } | null>(null);
  const [played, setPlayed] = useState(false);
  const pendingGame = useRef<{ game: GameModule; session: Session; withPhone: boolean } | null>(null);
  /** Every event carries the trigger that opened this modal and the current step. */
  const ctx = useRef({ trigger, step });
  /** Live quarterly Reserve price for the renewal line under every code. */
  const [quarterPrice, setQuarterPrice] = useState<string | null>(null);
  const termsRef = useRef<{ terms: string }>({ terms: `${CODE_TERMS.short} ${renewalLine(null)}` });
  useEffect(() => { termsRef.current.terms = `${CODE_TERMS.short} ${renewalLine(quarterPrice)}`; }, [quarterPrice]);
  useEffect(() => { ctx.current.step = step; }, [step]);
  const track = useCallback((name: string, properties: Record<string, unknown> = {}) => {
    trackPopup(name, ctx.current.trigger, ctx.current.step, properties);
  }, []);

  const close = useCallback(() => {
    if (!dialog.current?.open) return;
    remember(played ? 365 : 14);
    track("popup_close", { played });
    if (!played) writeValue(KEYS.closedUnplayed, String(Date.now()));
    dialog.current.close();
    window.dispatchEvent(new Event("mully:tas-closed"));
  }, [played, track]);

  useEffect(() => {
    if (!openSignal || !dialog.current || dialog.current.open) return;
    previousFocus.current = document.activeElement as HTMLElement;
    ctx.current.trigger = trigger;
    dialog.current.showModal();
    track("popup_view");
    void fetchReserveQuarterPrice().then((p) => { if (p) setQuarterPrice(p); });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a new open request
  }, [openSignal]);
  // Close on navigation only; the first run is the mount that just opened it.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (dialog.current?.open) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on navigation
  }, [pathname]);
  useEffect(() => () => { unmountGame.current?.(); }, []);
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>("[data-step-focus]")?.focus({ preventScroll: true });
  }, [step]);

  // Turnstile (only when a site key is configured): rendered visibly as soon as
  // the phone step mounts, so the check runs while the player types and any
  // checkbox is on screen before they tap Play.
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || step !== "phone" || !turnstileBox.current) return;
    const box = turnstileBox.current;
    let cancelled = false;
    const render = () => {
      if (cancelled || !window.turnstile || box.childElementCount) return;
      turnstileWidget.current = window.turnstile.render(box, {
        sitekey: TURNSTILE_SITE_KEY, appearance: "always", size: "flexible", action: "take-a-shot",
        callback: (t: string) => { turnstileToken.current = t; setTokenSeq((n) => n + 1); },
        "expired-callback": () => { turnstileToken.current = ""; },
        "error-callback": () => { turnstileToken.current = ""; },
      });
    };
    if (window.turnstile) render();
    else if (!document.getElementById("cf-turnstile")) {
      const s = document.createElement("script");
      s.id = "cf-turnstile";
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    } else document.getElementById("cf-turnstile")!.addEventListener("load", render);
    return () => {
      cancelled = true;
      if (turnstileWidget.current && window.turnstile?.remove) window.turnstile.remove(turnstileWidget.current);
      turnstileWidget.current = undefined;
      turnstileToken.current = "";
    };
  }, [step]);

  // A tap before the token arrived waits here, then submits by itself.
  useEffect(() => {
    if (!waiting) return;
    if (turnstileToken.current) {
      const withPhone = waiting === "phone";
      setWaiting("");
      void startGame(withPhone, true);
      return;
    }
    const timer = window.setTimeout(() => {
      setWaiting("");
      setError("We could not finish the robot check. Complete the check above, then tap again.");
    }, TURNSTILE_WAIT_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startGame reads current state
  }, [waiting, tokenSeq]);

  function resetTurnstile() {
    turnstileToken.current = "";
    if (window.turnstile) window.turnstile.reset(turnstileWidget.current);
  }

  // Mount the game once the stage is visible.
  useEffect(() => {
    const pending = pendingGame.current;
    if (step !== "game" || !pending || !stage.current) return;
    pendingGame.current = null;
    const { game, session, withPhone } = pending;
    unmountGame.current?.();
    const opts: Record<string, unknown> = {
      shots: session.shots, session,
      lead: { smsConsent: withPhone },
      backend: {
        shot: (b: { shot: number; target: { x: number; y: number }; e: number }) => api("shot", { sid: session.sid, ...b }),
        claim: () => api<{ status: string }>("claim", { sid: session.sid }),
      },
      emit: (type: string, detail: Record<string, unknown>) => {
        if (type === "shot") track("take_a_shot_shot", { shot: detail.shot, pct: detail.pct, surf: detail.surf, feet: detail.feet });
        else if (type === "claim") track("take_a_shot_claim", { pct: detail.pct, won: detail.won, shots: detail.shots, pending: detail.pending });
      },
      onReward: (reward: { code: string; percent: number; expiresAt: string }) => saveShopReward(reward),
      onClose: close,
    };
    // The game reads opts.terms when it shows the code, so keep it live.
    Object.defineProperty(opts, "terms", { enumerable: true, get: () => termsRef.current.terms });
    unmountGame.current = game.mount(stage.current, opts);
  }, [step, close, track]);

  function start() {
    track("take_a_shot_start");
    void loadGame().catch(() => {});
    setError("");
    setStep("email");
  }

  async function submitEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const company = new FormData(event.currentTarget).get("company");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setError("Enter a valid email."); return; }
    if (!emailOk) { setError("Check the box so we can send your code."); return; }
    setBusy("email"); setError("");
    try {
      const r = await api<{ status: string; claim?: Claim | null }>("check", { email, company });
      track("take_a_shot_email_submitted");
      if (r.status === "existing") { setExisting({ claim: r.claim ?? null }); setStep("existing"); }
      else setStep("phone");
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setBusy(""); }
  }

  /** `resumed`: called by the waiting effect once the token arrived. */
  async function startGame(withPhone: boolean, resumed = false) {
    if (busy || (waiting && !resumed)) return;
    setError("");
    if (withPhone) {
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 10) { setError(digits.length ? "Use a valid phone number, including your country code outside the US." : `Enter your phone, or play with ${SHOTS.email} shot.`); return; }
      if (!smsOk) { setError("Check the text box to get 3 shots."); return; }
    }
    // No token yet: show "Checking…" and submit once Turnstile finishes.
    if (TURNSTILE_SITE_KEY && !turnstileToken.current) { setWaiting(withPhone ? "phone" : "one"); return; }
    setBusy(withPhone ? "phone" : "one");
    try {
      const [game, r] = await Promise.all([
        loadGame(),
        api<{ status: string; session?: Session; claim?: Claim | null }>("session", {
          email, emailConsent: true,
          phone: withPhone ? phone : null, smsConsent: withPhone && smsOk,
          turnstileToken: turnstileToken.current || undefined,
        }),
      ]);
      if (withPhone) track("take_a_shot_phone_submitted");
      if (r.status === "existing" || !r.session) { setExisting({ claim: r.claim ?? null }); setStep("existing"); return; }
      setPlayed(true);
      remember(365);
      markSignedUp("take-a-shot");
      trackEmailSubmitted("take-a-shot", popupContext(ctx.current.trigger, "session"));
      pendingGame.current = { game, session: r.session, withPhone };
      setStep("game");
    } catch (e) {
      // Tokens are single use, so any failed session needs a fresh one. Inputs stay as typed.
      if (TURNSTILE_SITE_KEY) resetTurnstile();
      if (e instanceof ApiError && e.code === "turnstile_failed") setError("Please complete the check above, then tap again.");
      else setError(e instanceof Error ? e.message : "Please try again.");
    } finally { setBusy(""); }
  }

  const floorTxt = `${FLOOR_PERCENT.email}% just for playing`;
  const claim = existing?.claim;
  return <dialog ref={dialog} className="tas" aria-labelledby="tas-title"
    onCancel={(e) => { e.preventDefault(); close(); }}
    onClose={() => { previousFocus.current?.focus({ preventScroll: true }); onClosed?.(); }}
    onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div className="tas__modal">
      <button className="tas__close" type="button" aria-label="Close" onClick={close}>×</button>
      <section className="tas__gate" hidden={step === "game"}>
        {step === "landing" && <div className="tas__step tas__land">
          <MullyWordmark accent="#B08558" />
          <RingsArt />
          <h2 className="tas__h1" id="tas-title" tabIndex={-1} data-step-focus>Take a shot.</h2>
          <p className="tas__sub">One par 3 over water. The closer you land, the bigger the discount.</p>
          <div className="tas__tiers">
            {RING_TIERS.map((t, i) => <span key={t.ft} style={{ background: RING_COLORS[i] }}>{t.pct}%</span>)}
            <span className="tas__tier-floor">{floorTxt}</span>
          </div>
          <button className="tas__btn" type="button" onClick={start}>Take a Shot</button>
          <button className="tas__link" type="button" onClick={close}>No thanks</button>
        </div>}
        {step === "email" && <form className="tas__step" onSubmit={submitEmail} noValidate>
          <div className="tas__progress"><i className="on" /><i /><i /></div>
          <MullyWordmark accent="#B08558" />
          <h2 className="tas__h2" id="tas-title" tabIndex={-1} data-step-focus>Where should we send your code?</h2>
          <p className="tas__sub">The hole is loading while you type.</p>
          <label className="tas__field"><span className="tas__label">Email</span>
            <input className="tas__input" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com"
              maxLength={254} value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} required />
          </label>
          <label className="tas__check"><input type="checkbox" checked={emailOk} onChange={(e) => { setEmailOk(e.target.checked); setError(""); }} />
            <span>{EMAIL_CONSENT} <a href="/policies/privacy" target="_blank" rel="noopener noreferrer">Privacy</a></span>
          </label>
          <div className="tas__trap" aria-hidden="true"><label>Company<input name="company" autoComplete="off" tabIndex={-1} /></label></div>
          {error && <p className="tas__err" role="alert">{error}</p>}
          <button className="tas__btn" type="submit" disabled={busy === "email"}>{busy === "email" ? <><span className="tas__spin" />Checking</> : "Next"}</button>
          <p className="tas__fine">One code per person. Best shot counts. No purchase or Reserve subscription required.</p>
        </form>}
        {step === "phone" && <form className="tas__step" onSubmit={(e) => { e.preventDefault(); void startGame(true); }} noValidate>
          <div className="tas__progress"><i className="on" /><i className="on" /><i /></div>
          <MullyWordmark accent="#B08558" />
          <h2 className="tas__h2" id="tas-title" tabIndex={-1} data-step-focus>Want {SHOTS.phone} shots?</h2>
          <div className="tas__perk"><b>+{SHOTS.phone - SHOTS.email}</b><span>Add your phone for {SHOTS.phone - SHOTS.email} extra shots, and you get at least {FLOOR_PERCENT.phone}% off even if you miss.</span></div>
          <label className="tas__field"><span className="tas__label">Mobile number</span>
            <input className="tas__input" type="tel" inputMode="tel" autoComplete="tel" placeholder="(555) 555-0123" maxLength={35}
              value={phone} onChange={(e) => { setPhone(formatPhone(e.target.value)); setError(""); }} />
          </label>
          <label className="tas__check"><input type="checkbox" checked={smsOk} onChange={(e) => { setSmsOk(e.target.checked); setError(""); }} />
            <span>{SMS_CONSENT} <a href="/policies/privacy" target="_blank" rel="noopener noreferrer">Privacy</a> · <a href="/policies/terms" target="_blank" rel="noopener noreferrer">Terms</a></span>
          </label>
          <div ref={turnstileBox} className="tas__turnstile" />
          {error && <p className="tas__err" role="alert">{error}</p>}
          <button className="tas__btn" type="submit" disabled={Boolean(busy || waiting)}>
            {waiting === "phone" ? <><span className="tas__spin" />Checking…</> : busy === "phone" ? <><span className="tas__spin" />Loading the hole</> : `Get ${SHOTS.phone} shots`}
          </button>
          <button className="tas__link" type="button" disabled={Boolean(busy || waiting)} onClick={() => void startGame(false)}>
            {waiting === "one" ? "Checking…" : busy === "one" ? "Loading the hole…" : `Play with ${SHOTS.email} shot (${FLOOR_PERCENT.email}% min)`}
          </button>
        </form>}
        {step === "existing" && <div className="tas__step">
          <MullyWordmark accent="#B08558" />
          <h2 className="tas__h2" id="tas-title" tabIndex={-1} data-step-focus>You already took your shot.</h2>
          {claim ? <>
            <p className="tas__sub">One game per person. Your code is still good for {claim.pct}% off until {new Date(claim.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}. {CODE_TERMS.short} {renewalLine(quarterPrice)}</p>
            <div className="tas__code"><span>{claim.code}</span>
              <button className="tas__copy" type="button" onClick={(e) => { const b = e.currentTarget; void navigator.clipboard?.writeText(claim.code).then(() => { b.textContent = "Copied"; }); }}>Copy</button>
            </div>
          </> : <p className="tas__sub">One game per person. We sent your code to the email you played with.</p>}
          <button className="tas__btn" type="button" onClick={() => { if (claim) saveShopReward({ code: claim.code, percent: claim.pct, expiresAt: claim.expiresAt }); close(); }}>Keep shopping</button>
        </div>}
      </section>
      <div className="tas__stage" ref={stage} hidden={step !== "game"} />
    </div>
  </dialog>;
}
