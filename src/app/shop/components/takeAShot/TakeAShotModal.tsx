"use client";
/**
 * Take a Shot signup modal: landing > email (consent) > first shot > code
 * shown > phone ask (2 more shots, SMS consent) > game. The game module and
 * its CSS load only after the shopper taps "Take a Shot". The server decides
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
import { CODE_TERMS, FLOOR_PERCENT, MAX_PERCENT, PALETTE, RING_COLORS, RING_TIERS, SHOTS } from "@/lib/takeAShot/config";
import { MullyWordmark } from "../MullyWordmark";
import { SIGNUP_DISMISS_KEY } from "../ShopSignupPopup";
import "./take-a-shot.css";

type Claim = { code: string; pct: number; won: boolean; expiresAt: string };
type Session = { sid: string; pin: number; winds: { mph: number; dirDeg: number }[]; shots: number; floor: number; results: unknown[] };
type Step = "landing" | "email" | "existing" | "game" | "ask";
type GameHandle = (() => void) & { extend?: (session: Session) => void; finish?: (claim: Claim) => void };
type GameModule = { mount: (root: HTMLElement, opts: Record<string, unknown>) => GameHandle };
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
async function api<T>(route: string, payload: Record<string, unknown>, keepalive = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/take-a-shot/${route}`, {
      method: "POST", keepalive,
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

/** Landing art: the target in the Mully palette (deep green, olive, rings in sand/gold/cream, one accent). */
function RingsArt() {
  const rings = [...RING_TIERS].reverse();
  return <svg className="tas__art" viewBox="0 0 240 240" aria-hidden="true">
    <circle cx="120" cy="120" r="116" fill={PALETTE.deepGreen} />
    <circle cx="120" cy="120" r="108" fill={PALETTE.olive} />
    {rings.map((t, i) => <circle key={t.ft} cx="120" cy="120" r={t.ft * 4.6 + 6} fill={RING_COLORS[rings.length - 1 - i]} stroke={PALETTE.deepGreen} strokeOpacity=".35" strokeWidth="1.5" />)}
    <line x1="120" y1="120" x2="120" y2="54" stroke="#2B2018" strokeWidth="3" />
    <path d="M120 54 L152 64 L120 74 Z" fill={PALETTE.accent} />
    <circle cx="120" cy="120" r="5" fill="#2B2018" />
  </svg>;
}

/** Dimmed static preview of the hole for the empty half of the email step. */
function HolePreview() {
  return <div className="tas__preview" aria-hidden="true">
    <svg viewBox="0 0 320 210" preserveAspectRatio="xMidYMax slice">
      <rect width="320" height="210" fill="#5E9244" />
      <path d="M0 120 C70 96 120 140 190 118 S300 92 320 108 L320 150 C260 136 210 170 140 154 S40 150 0 162 Z" fill="#43A9DA" opacity=".85" />
      <path d="M126 210 L150 150 L172 150 L198 210 Z" fill="#8CBB5E" />
      <ellipse cx="190" cy="66" rx="78" ry="40" fill="#A9D47C" />
      {[...RING_TIERS].reverse().map((t, i, a) => <ellipse key={t.ft} cx="190" cy="66" rx={t.ft * 2.6 + 4} ry={t.ft * 1.35 + 2} fill={RING_COLORS[a.length - 1 - i]} opacity=".75" />)}
      <line x1="190" y1="66" x2="190" y2="26" stroke="#2B2018" strokeWidth="2" />
      <path d="M190 26 L210 32 L190 38 Z" fill={PALETTE.accent} />
      <ellipse cx="160" cy="196" rx="16" ry="6" fill="#A4CF74" />
    </svg>
  </div>;
}

function expiryText(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
  /** The email submit is waiting for the Turnstile token ("Checking…"). */
  const [waiting, setWaiting] = useState(false);
  const game = useRef<GameHandle | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [step, setStep] = useState<Step>("landing");
  const [email, setEmail] = useState("");
  const [emailOk, setEmailOk] = useState(false);
  const [phone, setPhone] = useState("");
  const [smsOk, setSmsOk] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "email" | "phone">("");
  const [existing, setExisting] = useState<{ claim: Claim | null } | null>(null);
  const [played, setPlayed] = useState(false);
  /** The phone ask after the first shot: the code already issued, and the first result. */
  const [ask, setAsk] = useState<{ claim: Claim; firstPct: number } | null>(null);
  const askRef = useRef<{ sid: string } | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const pendingGame = useRef<{ game: GameModule; session: Session } | null>(null);
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

  /** Leaving the phone ask without answering keeps the code and releases the welcome email. */
  const keepIfAsked = useCallback((keepalive = false) => {
    const asked = askRef.current;
    if (!asked) return;
    askRef.current = null;
    void api("keep", { sid: asked.sid }, keepalive).catch(() => {});
  }, []);

  const close = useCallback(() => {
    if (!dialog.current?.open) return;
    keepIfAsked(true);
    remember(played ? 365 : 14);
    track("popup_close", { played });
    if (!played) writeValue(KEYS.closedUnplayed, String(Date.now()));
    dialog.current.close();
    window.dispatchEvent(new Event("mully:tas-closed"));
  }, [played, track, keepIfAsked]);

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
  useEffect(() => {
    const onHide = () => keepIfAsked(true);
    window.addEventListener("pagehide", onHide);
    return () => { window.removeEventListener("pagehide", onHide); game.current?.(); };
  }, [keepIfAsked]);
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>("[data-step-focus]")?.focus({ preventScroll: true });
  }, [step]);

  // Turnstile (only when a site key is configured): rendered visibly as soon as
  // the email step mounts, so the check runs while the player types.
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || step !== "email" || !turnstileBox.current) return;
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
      setWaiting(false);
      void startGame(true);
      return;
    }
    const timer = window.setTimeout(() => {
      setWaiting(false);
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
    const { game: mod, session } = pending;
    sessionRef.current = session;
    game.current?.();
    const opts: Record<string, unknown> = {
      shots: session.shots, session,
      lead: { smsConsent: session.shots > SHOTS.email },
      backend: {
        shot: (b: { shot: number; target: { x: number; y: number }; e: number }) => api("shot", { sid: session.sid, ...b }),
        // A 1-shot claim offers the phone upsell, so the server holds the welcome email until the player decides.
        claim: () => api<{ status: string }>("claim", { sid: session.sid, upsell: (sessionRef.current?.shots ?? 0) === SHOTS.email }),
      },
      emit: (type: string, detail: Record<string, unknown>) => {
        if (type === "shot") track("take_a_shot_shot", { shot: detail.shot, pct: detail.pct, surf: detail.surf, feet: detail.feet });
        else if (type === "claim") track("take_a_shot_claim", { pct: detail.pct, won: detail.won, shots: detail.shots, pending: detail.pending });
      },
      onReward: (reward: { code: string; percent: number; expiresAt: string }) => saveShopReward(reward),
      onFirstClaim: (claim: Claim, best: { pct: number } | null) => {
        if (claim.pct >= MAX_PERCENT) return false;
        askRef.current = { sid: session.sid };
        setAsk({ claim, firstPct: best?.pct ?? 0 });
        setPhone(""); setSmsOk(false); setError("");
        setStep("ask");
        return true;
      },
      onClose: close,
    };
    // The game reads opts.terms when it shows the code, so keep it live.
    Object.defineProperty(opts, "terms", { enumerable: true, get: () => termsRef.current.terms });
    game.current = mod.mount(stage.current, opts);
  }, [step, close, track]);

  useEffect(() => { if (step === "ask") track("take_a_shot_phone_ask", { pct: ask?.claim.pct }); }, [step, ask, track]);

  function start() {
    track("take_a_shot_start");
    void loadGame().catch(() => {});
    setError("");
    setStep("email");
  }

  async function submitEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || waiting) return;
    const company = new FormData(event.currentTarget).get("company");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setError("Enter a valid email."); return; }
    if (!emailOk) { setError("Check the box so we can send your code."); return; }
    setBusy("email"); setError("");
    try {
      const r = await api<{ status: string; claim?: Claim | null }>("check", { email, company });
      track("take_a_shot_email_submitted");
      if (r.status === "existing") { setExisting({ claim: r.claim ?? null }); setStep("existing"); setBusy(""); return; }
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); setBusy(""); return; }
    setBusy("");
    // No token yet: show "Checking…" and start once Turnstile finishes.
    if (TURNSTILE_SITE_KEY && !turnstileToken.current) { setWaiting(true); return; }
    await startGame(true);
  }

  /** Email only: the session starts with 1 shot. `resumed`: called by the waiting effect. */
  async function startGame(resumed = false) {
    if (busy || (waiting && !resumed)) return;
    setError("");
    setBusy("email");
    try {
      const [mod, r] = await Promise.all([
        loadGame(),
        api<{ status: string; session?: Session; claim?: Claim | null }>("session", {
          email, emailConsent: true, phone: null, smsConsent: false,
          turnstileToken: turnstileToken.current || undefined,
        }),
      ]);
      if (r.status === "existing" || !r.session) { setExisting({ claim: r.claim ?? null }); setStep("existing"); return; }
      setPlayed(true);
      remember(365);
      markSignedUp("take-a-shot");
      trackEmailSubmitted("take-a-shot", popupContext(ctx.current.trigger, "session"));
      pendingGame.current = { game: mod, session: r.session };
      setStep("game");
    } catch (e) {
      // Tokens are single use, so any failed session needs a fresh one. Inputs stay as typed.
      if (TURNSTILE_SITE_KEY) resetTurnstile();
      if (e instanceof ApiError && e.code === "turnstile_failed") setError("Please complete the check above, then tap again.");
      else setError(e instanceof Error ? e.message : "Please try again.");
    } finally { setBusy(""); }
  }

  /** Phone ask: add a phone (SMS consent) and the same game gets 2 more shots. */
  async function submitPhone(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const asked = askRef.current;
    if (busy || !asked) return;
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) { setError(digits.length ? "Use a valid phone number, including your country code outside the US." : "Enter your phone to get 2 more shots."); return; }
    if (!smsOk) { setError("Check the text box to get 2 more shots."); return; }
    setBusy("phone"); setError("");
    try {
      const r = await api<{ status: string; session?: Session }>("upgrade", { sid: asked.sid, phone, smsConsent: true });
      if (!r.session) throw new ApiError("Something went wrong. Try again.");
      track("take_a_shot_phone_submitted", { placement: "after_first_shot" });
      askRef.current = null;
      sessionRef.current = r.session;
      setAsk(null);
      setStep("game");
      game.current?.extend?.(r.session);
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setBusy(""); }
  }

  function keepCode() {
    if (!ask) return;
    track("take_a_shot_keep", { pct: ask.claim.pct });
    keepIfAsked();
    const claim = ask.claim;
    setAsk(null);
    setStep("game");
    game.current?.finish?.(claim);
  }

  const claim = existing?.claim;
  const extra = SHOTS.phone - SHOTS.email;
  const copy = (code: string) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const b = e.currentTarget;
    void navigator.clipboard?.writeText(code).then(() => { b.textContent = "Copied"; });
  };
  return <dialog ref={dialog} className="tas" aria-labelledby="tas-title"
    onCancel={(e) => { e.preventDefault(); close(); }}
    onClose={() => { previousFocus.current?.focus({ preventScroll: true }); onClosed?.(); }}
    onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div className="tas__modal">
      <button className="tas__close" type="button" aria-label="Close" onClick={close}>×</button>
      <section className="tas__gate" hidden={step === "game" || step === "ask"}>
        {step === "landing" && <div className="tas__step tas__land">
          <MullyWordmark accent="#B08558" />
          <RingsArt />
          <h2 className="tas__h1" id="tas-title" tabIndex={-1} data-step-focus>Take a shot at {MAX_PERCENT}% off.</h2>
          <p className="tas__sub">One par 3 over water. The closer you land, the bigger the discount.</p>
          <div className="tas__tiers">
            <span className="tas__tier-floor">{FLOOR_PERCENT.email}% just for playing</span>
            <span className="tas__tier-top">Up to {MAX_PERCENT}% with your best shot</span>
          </div>
          <button className="tas__btn" type="button" onClick={start}>Take a Shot</button>
          <button className="tas__link" type="button" onClick={close}>No thanks</button>
        </div>}
        {step === "email" && <form className="tas__step tas__email" onSubmit={submitEmail} noValidate>
          <div className="tas__progress"><i className="on" /><i /></div>
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
          <div ref={turnstileBox} className="tas__turnstile" />
          {error && <p className="tas__err" role="alert">{error}</p>}
          <button className="tas__btn" type="submit" disabled={Boolean(busy || waiting)}>
            {waiting ? <><span className="tas__spin" />Checking…</> : busy === "email" ? <><span className="tas__spin" />Loading the hole</> : "Take my shot"}
          </button>
          <p className="tas__fine">One code per person. Best shot counts. No purchase or Reserve subscription required.</p>
          <HolePreview />
        </form>}
        {step === "existing" && <div className="tas__step">
          <MullyWordmark accent="#B08558" />
          <h2 className="tas__h2" id="tas-title" tabIndex={-1} data-step-focus>You already took your shot.</h2>
          {claim ? <>
            <p className="tas__sub">One game per person. Your code is still good for {claim.pct}% off until {expiryText(claim.expiresAt)}. {CODE_TERMS.short} {renewalLine(quarterPrice)}</p>
            <div className="tas__code"><span>{claim.code}</span>
              <button className="tas__copy" type="button" onClick={copy(claim.code)}>Copy</button>
            </div>
          </> : <p className="tas__sub">One game per person. We sent your code to the email you played with.</p>}
          <button className="tas__btn" type="button" onClick={() => { if (claim) saveShopReward({ code: claim.code, percent: claim.pct, expiresAt: claim.expiresAt }); close(); }}>Keep shopping</button>
        </div>}
      </section>
      <div className="tas__stage" ref={stage} hidden={step !== "game" && step !== "ask"} />
      {step === "ask" && ask && <section className="tas__ask">
        <div className="tas__ask-in">
          <p className="tas__eyebrow">{ask.claim.won ? "Your first shot" : "Tough hole"}</p>
          <h2 className="tas__h2" id="tas-title" tabIndex={-1} data-step-focus>{ask.claim.pct}% off{ask.claim.won ? "" : " anyway."}</h2>
          <div className="tas__code"><span>{ask.claim.code}</span>
            <button className="tas__copy" type="button" onClick={copy(ask.claim.code)}>Copy</button>
          </div>
          <p className="tas__fine">Yours to keep. One use, expires {expiryText(ask.claim.expiresAt)}. {CODE_TERMS.short} {renewalLine(quarterPrice)}</p>
          <form className="tas__ask-form" onSubmit={submitPhone} noValidate>
            <h3 className="tas__ask-h">{ask.firstPct > 0 ? `Nice shot. Want ${extra} more?` : `Want ${extra} more?`}</h3>
            <p className="tas__sub">Add your phone and your best of {SHOTS.phone} counts, with at least {FLOOR_PERCENT.phone}% off.</p>
            <label className="tas__field"><span className="tas__label">Mobile number</span>
              <input className="tas__input" type="tel" inputMode="tel" autoComplete="tel" placeholder="(555) 555-0123" maxLength={35}
                value={phone} onChange={(e) => { setPhone(formatPhone(e.target.value)); setError(""); }} />
            </label>
            <label className="tas__check"><input type="checkbox" checked={smsOk} onChange={(e) => { setSmsOk(e.target.checked); setError(""); }} />
              <span>{SMS_CONSENT} <a href="/policies/privacy" target="_blank" rel="noopener noreferrer">Privacy</a> · <a href="/policies/terms" target="_blank" rel="noopener noreferrer">Terms</a></span>
            </label>
            {error && <p className="tas__err" role="alert">{error}</p>}
            <button className="tas__btn" type="submit" disabled={busy === "phone"}>
              {busy === "phone" ? <><span className="tas__spin" />Adding your shots</> : `Get ${extra} more shots`}
            </button>
          </form>
          <button className="tas__link" type="button" disabled={busy === "phone"} onClick={keepCode}>Keep my {ask.claim.pct}%</button>
        </div>
      </section>}
    </div>
  </dialog>;
}
