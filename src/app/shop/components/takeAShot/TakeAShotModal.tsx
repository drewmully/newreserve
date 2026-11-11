"use client";
/**
 * Take a Shot, game first: the popup opens on the live hole. The first swing
 * freezes the meter and an email sheet slides up (consent, Turnstile); on
 * submit the same swing is hit. After shot 1 the server locks the result
 * without a code and the phone ask comes up: add a phone for best of 3, or
 * keep the locked percent. Exactly one code is minted per player (keep, the
 * final claim, or the cron). The server decides every result and code.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { EMAIL_CONSENT, SMS_CONSENT } from "@/lib/shopSignup";
import { saveShopReward } from "@/lib/shopRewards";
import { getClientAnonymousId } from "@/lib/tracking";
import { signalVisitorIdentified } from "@/lib/visitorIdentified";
import { KEYS, markSignedUp, writeValue, type TriggerType } from "@/lib/takeAShot/popupRules";
import { fetchReserveQuarterPrice, renewalLine } from "@/lib/takeAShot/reservePrice";
import { trackPopup } from "@/lib/takeAShot/popupTracking";
import { CODE_TERMS, FLOOR_PERCENT, MAX_PERCENT, SHOTS } from "@/lib/takeAShot/config";
import { SIGNUP_DISMISS_KEY } from "../ShopSignupPopup";
import "./take-a-shot.css";

type Claim = { status?: string; code: string; pct: number; won: boolean; expiresAt: string };
type Locked = { status: "locked"; pct: number; won: boolean };
type Session = { sid: string; pin: number; winds: { mph: number; dirDeg: number }[]; shots: number; floor: number; results: unknown[] };
/** play: game only. email: email sheet over the game. ask: result + phone sheet. */
type Step = "play" | "email" | "existing" | "game" | "ask";
type GameHandle = (() => void) & {
  fire?: (session: Session) => void; ungate?: () => void;
  extend?: (session: Session) => void; finish?: (claim: Claim) => void;
};
type GameModule = { mount: (root: HTMLElement, opts: Record<string, unknown>) => GameHandle; previewSession: () => Session };
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
  const previewRef = useRef<Session | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [step, setStep] = useState<Step>("play");
  const [loadFailed, setLoadFailed] = useState(false);
  const [email, setEmail] = useState("");
  const [emailOk, setEmailOk] = useState(false);
  const [phone, setPhone] = useState("");
  const [smsOk, setSmsOk] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "email" | "phone" | "keep">("");
  const [existing, setExisting] = useState<{ claim: Claim | null } | null>(null);
  const [played, setPlayed] = useState(false);
  /** The phone ask after the first shot: the locked percent. No code exists yet. */
  const [ask, setAsk] = useState<{ pct: number; won: boolean } | null>(null);
  const askRef = useRef<{ sid: string } | null>(null);
  const sessionRef = useRef<Session | null>(null);
  /** take_a_shot_email_submitted has fired for this player. */
  const leadSent = useRef(false);
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

  /** Leaving the phone ask without answering: the server mints the locked percent and emails it. */
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
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; }, [close]);

  /** Mount the live hole straight away, in preview until the email arrives. */
  const mountGame = useCallback(async () => {
    if (game.current || !stage.current) return;
    setLoadFailed(false);
    let mod: GameModule;
    try { mod = await loadGame(); } catch { setLoadFailed(true); return; }
    if (game.current || !stage.current) return;
    const preview = mod.previewSession();
    previewRef.current = preview;
    const opts: Record<string, unknown> = {
      shots: preview.shots, session: preview, lead: { smsConsent: false },
      gate: () => {
        track("swing_attempt_gated");
        setError("");
        setStep("email");
      },
      backend: {
        shot: (b: { shot: number; target: { x: number; y: number }; e: number }) => api("shot", { sid: sessionRef.current?.sid, ...b }),
        // On 1 shot the server locks the result for the phone ask and mints nothing.
        claim: () => api<Claim | Locked>("claim", { sid: sessionRef.current?.sid, upsell: (sessionRef.current?.shots ?? 0) === SHOTS.email }),
      },
      emit: (type: string, detail: Record<string, unknown>) => {
        if (type === "shot") track("take_a_shot_shot", { shot: detail.shot, pct: detail.pct, surf: detail.surf, feet: detail.feet });
        else if (type === "claim") track("take_a_shot_claim", { pct: detail.pct, won: detail.won, shots: detail.shots, pending: detail.pending });
        else if (type === "locked") track("take_a_shot_locked", { pct: detail.pct, won: detail.won });
      },
      onReward: (reward: { code: string; percent: number; expiresAt: string }) => saveShopReward(reward),
      onLocked: (res: Locked) => {
        const sid = sessionRef.current?.sid;
        if (!sid) return;
        askRef.current = { sid };
        setAsk({ pct: res.pct, won: res.won });
        setPhone(""); setSmsOk(false); setError("");
        setStep("ask");
      },
      onClose: () => closeRef.current(),
    };
    // The game reads opts.terms when it shows the code, so keep it live.
    Object.defineProperty(opts, "terms", { enumerable: true, get: () => termsRef.current.terms });
    game.current = mod.mount(stage.current, opts);
  }, [track]);

  useEffect(() => {
    if (!openSignal || !dialog.current || dialog.current.open) return;
    previousFocus.current = document.activeElement as HTMLElement;
    ctx.current.trigger = trigger;
    dialog.current.showModal();
    track("popup_view");
    void mountGame();
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
    return () => { window.removeEventListener("pagehide", onHide); game.current?.(); game.current = null; };
  }, [keepIfAsked]);
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>("[data-step-focus]")?.focus({ preventScroll: true });
  }, [step]);
  // Keep the sheets (and their button) above the on-screen keyboard.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const el = dialog.current;
    if (!vv || !el) return;
    const update = () => el.style.setProperty("--tas-kb", `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`);
    vv.addEventListener("resize", update); vv.addEventListener("scroll", update);
    update();
    return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
  }, []);

  // Turnstile (only when a site key is configured): rendered visibly as soon as
  // the email sheet opens, so the check runs while the player types.
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

  /** Back to aiming without an email: the frozen swing is released. */
  function backToHole() {
    if (busy || waiting) return;
    game.current?.ungate?.();
    setError("");
    setStep("play");
  }

  async function submitEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || waiting) return;
    const company = new FormData(event.currentTarget).get("company");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setError("Enter a valid email."); return; }
    if (!emailOk) { setError("Agree to emails so we can send your code."); return; }
    setBusy("email"); setError("");
    try {
      const r = await api<{ status: string; claim?: Claim | null }>("check", { email, company });
      // A returning player on their own browser is identified by /check.
      if (r.status === "existing") signalVisitorIdentified();
      if (r.status === "existing") { setExisting({ claim: r.claim ?? null }); setStep("existing"); setBusy(""); return; }
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); setBusy(""); return; }
    setBusy("");
    // No token yet: show "Checking…" and start once Turnstile finishes.
    if (TURNSTILE_SITE_KEY && !turnstileToken.current) { setWaiting(true); return; }
    await startGame(true);
  }

  /** Email only: the session starts with 1 shot on the hole they aimed at. `resumed`: called by the waiting effect. */
  async function startGame(resumed = false) {
    if (busy || (waiting && !resumed)) return;
    setError("");
    setBusy("email");
    try {
      const p = previewRef.current;
      const r = await api<{ status: string; session?: Session; claim?: Claim | null }>("session", {
        email, emailConsent: true, phone: null, smsConsent: false,
        turnstileToken: turnstileToken.current || undefined,
        preview: p ? { pin: p.pin, mph: p.winds[0]?.mph, dirDeg: p.winds[0]?.dirDeg } : undefined,
      });
      // /session may have set mully_kid: let the bag (if any) reach Klaviyo cart recovery.
      signalVisitorIdentified();
      if (r.status === "existing" || !r.session) { setExisting({ claim: r.claim ?? null }); setStep("existing"); return; }
      // Meta Lead (via #379): once per new player, only after the session stored consent.
      if (r.status === "new" && !leadSent.current) {
        leadSent.current = true;
        trackPopup("take_a_shot_email_submitted", ctx.current.trigger, "email", {}, email.trim());
      }
      setPlayed(true);
      remember(365);
      markSignedUp("take-a-shot");
      sessionRef.current = r.session;
      setStep("game");
      // The sheet drops and the frozen swing fires: same aim, same power.
      game.current?.fire?.(r.session);
    } catch (e) {
      // Tokens are single use, so any failed session needs a fresh one. Inputs stay as typed.
      if (TURNSTILE_SITE_KEY) resetTurnstile();
      if (e instanceof ApiError && e.code === "turnstile_failed") setError("Please complete the check above, then tap again.");
      else setError(e instanceof Error ? e.message : "Please try again.");
    } finally { setBusy(""); }
  }

  /** Phone ask: add a phone (SMS consent) and the same game gets 2 more shots. Nothing is minted yet. */
  async function submitPhone(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const asked = askRef.current;
    if (busy || !asked) return;
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) { setError(digits.length ? "Use a valid phone number, including your country code outside the US." : `Enter your phone to get ${extra} more shots.`); return; }
    if (!smsOk) { setError("Agree to texts to get more shots."); return; }
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

  /** "Keep my X%": the server mints the one code now and the game shows it. */
  async function keepCode() {
    const asked = askRef.current;
    if (!ask || !asked || busy) return;
    track("take_a_shot_keep", { pct: ask.pct });
    setBusy("keep"); setError("");
    try {
      const c = await api<Claim>("keep", { sid: asked.sid });
      askRef.current = null;
      setAsk(null);
      setStep("game");
      game.current?.finish?.(c);
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setBusy(""); }
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
    <div className="tas__modal" data-step={step}>
      <button className="tas__close" type="button" aria-label="Close" onClick={close}>×</button>
      <header className="tas__head">
        <h2 className="tas__h1" id="tas-title" tabIndex={-1} data-step-focus={step === "play" ? "" : undefined}>Take a shot at {MAX_PERCENT}% off.</h2>
        <p className="tas__tag">{FLOOR_PERCENT.email}% just for playing</p>
      </header>
      <div className="tas__stage" ref={stage}>
        {loadFailed && <div className="tas__loadfail"><p className="tas__sub">The hole did not load.</p>
          <button className="tas__btn" type="button" onClick={() => void mountGame()}>Try again</button></div>}
      </div>

      <section className="tas__sheet tas__sheet--email" data-open={step === "email" ? "" : undefined} aria-hidden={step !== "email"} inert={step !== "email"}>
        <form className="tas__sheet-in" onSubmit={submitEmail} noValidate>
          <h3 className="tas__h2" tabIndex={-1} data-step-focus={step === "email" ? "" : undefined}>Where should we send your code?</h3>
          <p className="tas__sub">Your swing is locked in. It fires the moment you are in.</p>
          <label className="tas__field"><span className="tas__label">Email</span>
            <input className="tas__input" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com"
              maxLength={254} value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} required />
          </label>
          <label className="tas__check"><input type="checkbox" checked={emailOk} onChange={(e) => { setEmailOk(e.target.checked); setError(""); }} />
            <span>{EMAIL_CONSENT} <a href="/policies/privacy" target="_blank" rel="noopener noreferrer">Privacy</a></span>
          </label>
          <div className="tas__trap" aria-hidden="true"><label>Company<input name="company" autoComplete="off" tabIndex={-1} /></label></div>
          <div ref={turnstileBox} className="tas__turnstile" />
          {error && step === "email" && <p className="tas__err" role="alert">{error}</p>}
          <div className="tas__sheet-cta">
            <button className="tas__btn" type="submit" disabled={Boolean(busy || waiting)}>
              {waiting ? <><span className="tas__spin" />Checking…</> : busy === "email" ? <><span className="tas__spin" />Teeing up</> : "Take my shot"}
            </button>
            <p className="tas__fine">One code per person. No purchase or Reserve subscription required. <button className="tas__inline" type="button" onClick={backToHole}>Back to the hole</button></p>
          </div>
        </form>
      </section>

      {step === "existing" && <section className="tas__sheet" data-open="">
        <div className="tas__sheet-in">
          <h3 className="tas__h2" tabIndex={-1} data-step-focus>You already took your shot.</h3>
          {claim ? <>
            <p className="tas__sub">One game per person. Your code is still good for {claim.pct}% off until {expiryText(claim.expiresAt)}. {CODE_TERMS.short} {renewalLine(quarterPrice)}</p>
            <div className="tas__code"><span>{claim.code}</span>
              <button className="tas__copy" type="button" onClick={copy(claim.code)}>Copy</button>
            </div>
          </> : <p className="tas__sub">One game per person. We sent your code to the email you played with.</p>}
          <button className="tas__btn" type="button" onClick={() => { if (claim) saveShopReward({ code: claim.code, percent: claim.pct, expiresAt: claim.expiresAt }); close(); }}>Keep shopping</button>
        </div>
      </section>}

      {step === "ask" && ask && <section className="tas__sheet tas__sheet--ask" data-open="">
        <div className="tas__sheet-in">
          <h3 className="tas__h2" tabIndex={-1} data-step-focus>{ask.won ? `Nice shot, ${ask.pct}% locked in` : `${ask.pct}% locked in`}</h3>
          <p className="tas__sub">{ask.won ? "Your code comes once you decide." : "Tough hole. You still get your playing discount, and your code comes once you decide."}</p>
          <form className="tas__ask-form" onSubmit={submitPhone} noValidate>
            <p className="tas__ask-h">Add your phone for {extra} more shots</p>
            <p className="tas__sub">Best of {SHOTS.phone} counts, with at least {FLOOR_PERCENT.phone}% off. Up to {MAX_PERCENT}%.</p>
            <label className="tas__field"><span className="tas__label">Mobile number</span>
              <input className="tas__input" type="tel" inputMode="tel" autoComplete="tel" placeholder="(555) 555-0123" maxLength={35}
                value={phone} onChange={(e) => { setPhone(formatPhone(e.target.value)); setError(""); }} />
            </label>
            <label className="tas__check"><input type="checkbox" checked={smsOk} onChange={(e) => { setSmsOk(e.target.checked); setError(""); }} />
              <span>{SMS_CONSENT} <a href="/policies/privacy" target="_blank" rel="noopener noreferrer">Privacy</a> · <a href="/policies/terms" target="_blank" rel="noopener noreferrer">Terms</a></span>
            </label>
            {error && <p className="tas__err" role="alert">{error}</p>}
            <div className="tas__sheet-cta">
              <button className="tas__btn" type="submit" disabled={Boolean(busy)}>
                {busy === "phone" ? <><span className="tas__spin" />Adding your shots</> : `Add phone for ${extra} more`}
              </button>
              <button className="tas__link" type="button" disabled={Boolean(busy)} onClick={() => void keepCode()}>
                {busy === "keep" ? "Getting your code" : `Keep my ${ask.pct}%`}
              </button>
            </div>
          </form>
        </div>
      </section>}
    </div>
  </dialog>;
}
