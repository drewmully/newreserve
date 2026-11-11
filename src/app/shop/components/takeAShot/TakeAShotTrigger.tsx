"use client";
/**
 * Take a Shot auto-open, suppression and launcher pill. Used by TakeAShotGate
 * when the flag is on (it replaces ShopSignupPopup's trigger). Rules live in
 * lib/takeAShot/popupRules; this component only reads the page and storage.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useMembership } from "@/app/context/MembershipContext";
import { readShopReward } from "@/lib/shopRewards";
import { PURCHASE_INTENT_KEY } from "../ShopSignupPopup";
import {
  CAPS, KEYS, exitIntentReady, excludedPath, hasSignedUp, isEmailOrSmsVisit, isPaidSocial,
  klaviyoCookieKnown, launcherVisible, pageKindFor, productPageInDom, readAutoOpens, readNumber, recordAutoOpen,
  suppressReason, timedTrigger, writeValue, type SuppressReason, type TriggerType,
} from "@/lib/takeAShot/popupRules";
import { trackPopup } from "@/lib/takeAShot/popupTracking";
import { MAX_PERCENT } from "@/lib/takeAShot/config";
import "./take-a-shot-launcher.css";

const PURCHASE_INTENT_SELECTOR = "#outfit, [data-purchase-intent]";

function scrollFraction() {
  const travel = document.documentElement.scrollHeight - window.innerHeight;
  return travel > 0 ? window.scrollY / travel : 0;
}

/** Something else needs the screen right now: try again on the next tick. */
function busyScreen() {
  const active = document.activeElement;
  return document.visibilityState !== "visible" ||
    Boolean(document.getElementById("shop-gate-title")) ||
    Boolean(document.querySelector("dialog[open]")) ||
    document.body.dataset.shopBuilderInView === "true" ||
    Boolean(active?.matches("input,textarea,select,[contenteditable=true]"));
}

export function TakeAShotTrigger({ onOpen, modalOpen }: { onOpen: (trigger: TriggerType) => void; modalOpen: boolean }) {
  const pathname = usePathname();
  const { cartOpen, cartCount, user, tier } = useMembership();
  const member = Boolean(tier && tier !== "free");
  const state = useRef({ cartOpen, cartCount, user: Boolean(user), member });
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    state.current = { cartOpen, cartCount, user: Boolean(user), member };
    onOpenRef.current = onOpen;
  });
  const [rewardSaved, setRewardSaved] = useState(true);
  const [launcher, setLauncher] = useState({ dismissedUntil: 0, closedUnplayed: false, firstVisitBeforeTrigger: false, width: 1024, now: 0, productPage: false });

  const refreshLauncher = useCallback(() => {
    setRewardSaved(Boolean(readShopReward()));
    setLauncher({
      dismissedUntil: readNumber(KEYS.launcherDismissed),
      closedUnplayed: readNumber(KEYS.closedUnplayed) > 0,
      firstVisitBeforeTrigger: readNumber(KEYS.sessionFirstVisit, "session") === 1 && readNumber(KEYS.sessionAutoOpens, "session") === 0,
      width: window.innerWidth,
      now: Date.now(),
      productPage: productPageInDom(),
    });
  }, []);

  // Session bookkeeping: first visit, landing params, page views.
  useEffect(() => {
    if (!readNumber(KEYS.seen)) { writeValue(KEYS.seen, String(Date.now())); writeValue(KEYS.sessionFirstVisit, "1", "session"); }
    const params = new URLSearchParams(window.location.search);
    if (isEmailOrSmsVisit(params)) writeValue(KEYS.emailVisitor, String(Date.now() + CAPS.emailVisitorDays * 86_400_000));
    try {
      if (!sessionStorage.getItem(KEYS.sessionLanding)) sessionStorage.setItem(KEYS.sessionLanding, isPaidSocial(params) ? "paid_social" : "other");
    } catch { /* storage unavailable */ }
    writeValue(KEYS.sessionPageViews, String(readNumber(KEYS.sessionPageViews, "session") + 1), "session");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser storage after hydration
    refreshLauncher();
  }, [pathname, refreshLauncher]);

  useEffect(() => {
    const update = () => refreshLauncher();
    window.addEventListener("mully:shop-reward", update);
    window.addEventListener("mully:tas-closed", update);
    window.addEventListener("resize", update, { passive: true });
    return () => {
      window.removeEventListener("mully:shop-reward", update);
      window.removeEventListener("mully:tas-closed", update);
      window.removeEventListener("resize", update);
    };
  }, [refreshLauncher]);

  // Auto-open.
  useEffect(() => {
    const productPage = productPageInDom();
    const kind = pageKindFor(pathname, productPage);
    const started = Date.now();
    const pageViews = readNumber(KEYS.sessionPageViews, "session");
    let landing = "other";
    try { landing = sessionStorage.getItem(KEYS.sessionLanding) ?? "other"; } catch { /* storage unavailable */ }
    const paidSocialFirstPage = landing === "paid_social" && pageViews <= 1;
    let maxScroll = scrollFraction();
    let fired = false;
    let reported = false;

    function knownEmail() {
      try { if (new URLSearchParams(window.location.search).get("_kx") || localStorage.getItem(KEYS.klaviyoKx)) return true; } catch { /* storage unavailable */ }
      return state.current.user || klaviyoCookieKnown(document.cookie);
    }
    function purchaseIntent() {
      try { return sessionStorage.getItem(PURCHASE_INTENT_KEY) === "1"; } catch { return false; }
    }
    function reason(): SuppressReason | null {
      return suppressReason({
        rewardSaved: Boolean(readShopReward()),
        signedUp: hasSignedUp(),
        knownEmail: knownEmail(),
        member: state.current.member,
        emailSmsVisit: readNumber(KEYS.emailVisitor) > Date.now(),
        excludedPage: excludedPath(pathname, productPage),
        bag: state.current.cartOpen || state.current.cartCount > 0 || purchaseIntent(),
        snoozedUntil: readNumber(KEYS.snooze),
        sessionAutoOpens: readNumber(KEYS.sessionAutoOpens, "session"),
        autoOpens: readAutoOpens(),
        now: Date.now(),
      });
    }
    function report(r: SuppressReason | null) {
      if (reported) return;
      reported = true;
      if (r) trackPopup("popup_suppressed", null, null, { reason: r });
      else trackPopup("popup_eligible", null, null);
    }
    function fire(trigger: TriggerType) {
      if (fired) return;
      const r = reason();
      if (r) { if (r !== "bag") report(r); return; }
      if (busyScreen()) return;
      report(null);
      fired = true;
      recordAutoOpen();
      refreshLauncher();
      onOpenRef.current(trigger);
    }
    function tick() {
      const t = timedTrigger({ kind, dwellMs: Date.now() - started, scrollFraction: maxScroll, pageViews, paidSocialFirstPage });
      if (t) fire(t);
    }
    function onScroll() { maxScroll = Math.max(maxScroll, scrollFraction()); tick(); }
    function onPointer(event: Event) {
      const target = event.target;
      if (target instanceof Element && target.closest(PURCHASE_INTENT_SELECTOR)) {
        try { sessionStorage.setItem(PURCHASE_INTENT_KEY, "1"); } catch { /* storage unavailable */ }
      }
    }
    function onExit(event: MouseEvent) {
      if (event.clientY > 0 || event.relatedTarget) return;
      if (exitIntentReady({ kind, dwellMs: Date.now() - started, finePointer: window.matchMedia("(pointer:fine)").matches, paidSocialFirstPage })) fire("exit_intent");
    }
    function onManual() { onOpenRef.current("manual"); }

    // Report suppression for persistent reasons right away; eligibility is reported when it opens.
    const initial = reason();
    if (initial && initial !== "bag") report(initial);
    const timer = window.setInterval(tick, 1000);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointerdown", onPointer, { passive: true });
    document.addEventListener("focusin", onPointer);
    document.addEventListener("mouseout", onExit);
    window.addEventListener("mully:open-signup", onManual);
    return () => {
      clearInterval(timer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("focusin", onPointer);
      document.removeEventListener("mouseout", onExit);
      window.removeEventListener("mully:open-signup", onManual);
    };
  }, [pathname, refreshLauncher]);

  const kind = pageKindFor(pathname, launcher.productPage);
  const show = launcherVisible({
    rewardSaved, member, dismissedUntil: launcher.dismissedUntil, now: launcher.now,
    excludedPage: excludedPath(pathname, launcher.productPage), kind, viewportWidth: launcher.width, cartOpen, modalOpen,
    closedUnplayed: launcher.closedUnplayed, firstVisitBeforeTrigger: launcher.firstVisitBeforeTrigger,
  });
  if (!show) return null;
  return <div className="tas-launch" role="complementary" aria-label="Take a Shot">
    <button type="button" className="tas-launch__open" onClick={() => onOpenRef.current("launcher")}>Take a shot at {MAX_PERCENT}% off</button>
    <button type="button" className="tas-launch__x" aria-label="Hide Take a Shot" onClick={() => {
      writeValue(KEYS.launcherDismissed, String(Date.now() + CAPS.launcherDismissDays * 86_400_000));
      trackPopup("popup_launcher_dismissed", "launcher", null);
      refreshLauncher();
    }}>×</button>
  </div>;
}
