"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMembership } from "../context/MembershipContext";
import {
  auth,
  isSignInWithEmailLink,
  confirmOTPSignIn,
  signInWithGoogle,
  signInWithGoogleRedirect,
  completeGoogleRedirectSignIn,
} from "@/lib/firebase";
import { PENDING_SIGN_IN_EMAIL_KEY } from "@/lib/pendingSignInEmail";
import { createMembershipCheckout } from "@/lib/shopifyCheckout";
import { shopReturnFromLogin } from "@/lib/shopLogin";
import {
  DEAD_LINK_MESSAGE,
  IN_APP_BROWSER_GOOGLE_HINT,
  isInAppBrowser,
  isRetryableAuthError,
  isValidEmail,
  isWrongEmailForLink,
  mapAuthError,
  normalizeEmail,
  shouldFallBackToGoogleRedirect,
  stripEmailLinkParams,
} from "./loginErrors";
import { ShopPageShell } from "../shop/components/ShopPageShell";

const PENDING_ONBOARDING_DATA_KEY = "pending_onboarding_data";
const POST_CHECKOUT_KEY = "mully_post_checkout";

/* ═══════════════════════════════════════════
   LOGIN PAGE  —  passwordless Email Link flow
   ═══════════════════════════════════════════ */

type Step = "email" | "sent" | "confirming";

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      console.error(`[SignIn] attempt ${attempt}/${maxAttempts} failed:`, err);
      // Expired/used/wrong-email codes never succeed on retry.
      if (!isRetryableAuthError(err)) break;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 600 * attempt));
      }
    }
  }
  throw lastError;
}

function errorCode(err: unknown): string {
  return (err as { code?: string })?.code ?? "";
}

const PAID_TIERS = new Set(["access", "member", "black"]);

export default function LoginPage() {
  const router = useRouter();
  const { sendOTPEmail, isSignedIn, authLoading, onboardingCompleted, completeOnboarding, setTier, tier, email: contextEmail } = useMembership();
  const pendingOnboardingHandled = useRef(false);

  // Detect email link synchronously on first render so we never flash the form.
  // Also honor ?paid_member=1 — that means the EmailCTA already triggered a
  // magic-link email via /api/auth/check-loop-status, so we should land on
  // the "check your inbox" screen instead of the email input.
  const initialPaidMember =
    typeof window !== "undefined" &&
    (() => {
      try {
        return new URLSearchParams(window.location.search).get("paid_member") === "1";
      } catch {
        return false;
      }
    })();
  const [isPaidMemberFlow] = useState<boolean>(initialPaidMember);
  const [step, setStep] = useState<Step>(() => {
    if (typeof window === "undefined") return "email";
    if (isSignInWithEmailLink(auth, window.location.href)) return "confirming";
    if (initialPaidMember) return "sent";
    return "email";
  });

  // Starts empty on both server and client so hydration matches; the
  // prefill (signed-in email or the email saved by a dead-link recovery) is
  // applied in an effect below. Reading storage in the initializer made the
  // client state disagree with the server HTML, leaving "Continue" disabled.
  const [emailValue, setEmailValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Non-error guidance shown above the send-link form, e.g. after a dead link.
  const [notice, setNotice] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  // True when the link is opened on a different device (no localStorage entry)
  const [needsEmailForLink, setNeedsEmailForLink] = useState(false);
  // Detected after mount for the same hydration reason.
  const [inAppBrowser, setInAppBrowser] = useState(false);

  /**
   * The email link can no longer be used (expired, already used, or any
   * other confirm failure). Drop the one-time code from the URL so a refresh
   * doesn't retry it, and switch to the normal send-link form with the email
   * pre-filled.
   */
  function recoverFromDeadLink(email: string, message: string | null = DEAD_LINK_MESSAGE) {
    try {
      window.history.replaceState(window.history.state, "", stripEmailLinkParams(window.location.href));
    } catch {}
    // An empty prefill clears the field, so a wrong address never sticks.
    const prefill = normalizeEmail(email);
    setEmailValue(prefill);
    if (prefill) {
      try {
        sessionStorage.setItem(PENDING_SIGN_IN_EMAIL_KEY, prefill);
      } catch {}
    }
    setError(null);
    setNotice(message);
    setNeedsEmailForLink(false);
    setStep("email");
  }

  /**
   * The address this sign-in is meant for, if we know it: the email saved
   * when the link was requested on this device, the one saved by a dead-link
   * recovery, or the signed-in account. Never what was just typed into the
   * confirm form (that may be the wrong address).
   */
  function knownIntendedEmail(): string {
    try {
      const stored =
        localStorage.getItem("emailForSignIn") ||
        sessionStorage.getItem(PENDING_SIGN_IN_EMAIL_KEY);
      if (stored) return stored;
    } catch {}
    return contextEmail || "";
  }

  function handleLinkConfirmFailure(err: unknown, email: string) {
    if (isWrongEmailForLink(err)) {
      // The one-time code is still valid; let them enter the right address.
      setError(mapAuthError("auth/invalid-email", "link"));
      setNotice(null);
      setStep("email");
      setNeedsEmailForLink(true);
      return;
    }
    const code = errorCode(err);
    recoverFromDeadLink(
      email,
      code === "auth/network-request-failed"
        ? "We couldn't finish signing you in with that link. Check your connection — we can send you a fresh one."
        : DEAD_LINK_MESSAGE,
    );
  }

  /* ── Client-only initial state (after hydration) ── */
  useEffect(() => {
    setInAppBrowser(isInAppBrowser(navigator.userAgent));
    let saved = "";
    try {
      saved = sessionStorage.getItem(PENDING_SIGN_IN_EMAIL_KEY) ?? "";
    } catch {}
    const initial = contextEmail || saved;
    if (initial) setEmailValue((current) => current || initial);
  // Mount-only; later contextEmail changes are handled by the effect below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Handle email link (and Google redirect result) on mount ── */
  useEffect(() => {
    // Completes a Google redirect started by the popup fallback below.
    completeGoogleRedirectSignIn().catch((err: unknown) => {
      console.error("[SignIn] Google redirect failed:", err);
      setError(mapAuthError(errorCode(err), "google"));
    });

    if (!isSignInWithEmailLink(auth, window.location.href)) return;

    const savedEmail = localStorage.getItem("emailForSignIn") ?? "";
    if (savedEmail) {
      // Same device — auto-confirm
      setEmailValue(savedEmail);
      withRetry(() => confirmOTPSignIn(savedEmail, window.location.href)).catch((err) => {
        console.error("[SignIn] auto-confirm failed after all retries:", err);
        handleLinkConfirmFailure(err, savedEmail);
      });
    } else {
      // Different device — ask user for email
      setStep("email");
      setNeedsEmailForLink(true);
    }
  // Mount-only: the handlers above only call stable state setters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!contextEmail) return;
    setEmailValue((current) => current || contextEmail);
  }, [contextEmail]);

  /* ── Redirect once authenticated ── */
  useEffect(() => {
    if (authLoading || !isSignedIn) return;
    if (pendingOnboardingHandled.current) return;
    // Explicit shop sign-in (?returnTo=/shop…, or "/") does not enroll or
    // resume an abandoned membership. The return path is carried in the email
    // link, including on another device. Plain /login links carry no returnTo,
    // so they fall through to the pending-onboarding completion below.
    const shopReturn = shopReturnFromLogin(window.location.search);
    if (shopReturn) {
      router.replace(shopReturn);
      return;
    }

    const raw = (() => {
      try { return localStorage.getItem(PENDING_ONBOARDING_DATA_KEY); } catch { return null; }
    })();

    if (raw && !onboardingCompleted) {
      pendingOnboardingHandled.current = true;
      try {
        const data = JSON.parse(raw) as {
          username: string;
          onboardingProfile: Record<string, unknown>;
          fitProfile?: Record<string, unknown>;
          selectedTier: "free" | "access" | "member";
          phone?: string;
          smsOptIn?: boolean;
        };

        const { selectedTier, username, onboardingProfile, fitProfile, phone, smsOptIn } = data;

        const hasPaidTier = PAID_TIERS.has(tier);
        const alreadyPaid = (() => {
          // Never send someone who already has a paid tier back to checkout.
          if (hasPaidTier) return true;
          try {
            // Set by the magic link URL (?paid=1) when webhook generates the link post-checkout
            if (new URLSearchParams(window.location.search).get("paid") === "1") return true;
            // Fallback: flag set when user returned through /auth/callback
            return !!localStorage.getItem(POST_CHECKOUT_KEY);
          } catch { return false; }
        })();

        void completeOnboarding({
          username,
          onboardingProfile: onboardingProfile as unknown as Parameters<typeof completeOnboarding>[0]["onboardingProfile"],
          fitProfile: fitProfile as unknown as Parameters<typeof completeOnboarding>[0]["fitProfile"],
          phone,
          smsOptIn,
        }).then(() => {
          // Only clear the saved answers once they are actually stored, so a
          // failed save can be retried instead of silently losing them.
          try { localStorage.removeItem(PENDING_ONBOARDING_DATA_KEY); } catch {}
          if (alreadyPaid) {
            try { localStorage.removeItem(POST_CHECKOUT_KEY); } catch {}
          }
          // Don't locally downgrade a paid member to the tier picked pre-auth.
          if (!hasPaidTier) setTier(selectedTier);
          if (!alreadyPaid && (selectedTier === "access" || selectedTier === "member")) {
            return createMembershipCheckout(selectedTier);
          } else {
            router.replace("/");
          }
        }).catch((err) => {
          console.error("[Login] pending onboarding apply failed:", err);
          router.replace("/onboarding");
        });
      } catch {
        // Unreadable leftovers: drop them so they can't block future logins.
        try { localStorage.removeItem(PENDING_ONBOARDING_DATA_KEY); } catch {}
        router.replace("/");
      }
      return;
    }

    router.replace("/");
  }, [authLoading, isSignedIn, onboardingCompleted, router, completeOnboarding, setTier, tier]);

  /* ── Resend cooldown countdown ── */
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  // Already signed in → brief spinner while redirect fires
  if (!authLoading && isSignedIn) {
    return (
      <div className="min-h-screen bg-bone flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-forest/30 border-t-forest rounded-full animate-spin" />
      </div>
    );
  }

  /* ── Handlers ── */

  /** Lowercased, validated email or null (with the error already shown). */
  function readEmailInput(): string | null {
    const email = normalizeEmail(emailValue);
    if (!email) {
      setError(mapAuthError("auth/missing-email"));
      return null;
    }
    if (!isValidEmail(email)) {
      setError(mapAuthError("auth/invalid-email"));
      return null;
    }
    if (email !== emailValue) setEmailValue(email);
    return email;
  }

  async function handleSendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const email = readEmailInput();
    if (!email) return;
    setLoading(true);
    try {
      await sendOTPEmail(email);
      try {
        sessionStorage.removeItem(PENDING_SIGN_IN_EMAIL_KEY);
      } catch {}
      setNotice(null);
      setStep("sent");
      setResendCooldown(60);
    } catch (err) {
      setError(mapAuthError(errorCode(err), "send"));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
      // onAuthStateChanged → isSignedIn → redirect
    } catch (err) {
      const code = errorCode(err);
      if (shouldFallBackToGoogleRedirect(code, inAppBrowser)) {
        try {
          await signInWithGoogleRedirect();
          return; // the page navigates away
        } catch (redirectErr) {
          console.error("[SignIn] Google redirect fallback failed:", redirectErr);
        }
      }
      setError(mapAuthError(code, "google"));
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0 || loading) return;
    setError(null);
    const email = readEmailInput();
    if (!email) return;
    setLoading(true);
    try {
      await sendOTPEmail(email);
      setResendCooldown(60);
    } catch (err) {
      setError(mapAuthError(errorCode(err), "send"));
    } finally {
      setLoading(false);
    }
  }

  // Confirm the link on a different device after the user types their email
  async function handleConfirmWithEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const email = readEmailInput();
    if (!email) return;
    setLoading(true);
    setStep("confirming");
    try {
      await withRetry(() => confirmOTPSignIn(email, window.location.href));
      // onAuthStateChanged → isSignedIn → redirect
    } catch (err) {
      console.error("[SignIn] handleConfirmWithEmail failed after all retries:", err);
      handleLinkConfirmFailure(err, email);
    } finally {
      setLoading(false);
    }
  }

  /* ── Shared UI pieces ── */

  const logoBox = (
    <div className="shop-page-kicker">Your Mully account</div>
  );

  const spinner = (
    <span className="inline-flex items-center gap-2">
      <span className="w-4 h-4 border-2 border-bone/30 border-t-bone rounded-full animate-spin" />
    </span>
  );

  const errorBanner = error && (
    <p role="alert" className="text-xs text-red-600/80 bg-red-50 border border-red-200/60 rounded-lg px-3 py-2.5 text-center">
      {error}
    </p>
  );

  const noticeBanner = notice && (
    <p role="status" className="text-xs text-charcoal/70 bg-cream border border-taupe/25 rounded-lg px-3 py-2.5 text-center mb-4">
      {notice}
    </p>
  );

  const termsFooter = (
    <p className="text-center text-[10px] text-charcoal/25 leading-relaxed mt-6">
      By continuing, you agree to our{" "}
      <Link href="/policies/terms" className="underline underline-offset-2 hover:text-charcoal/40 transition-colors">
        Terms of Service
      </Link>
      {" "}and{" "}
      <Link href="/policies/privacy" className="underline underline-offset-2 hover:text-charcoal/40 transition-colors">
        Privacy Policy
      </Link>.
    </p>
  );

  return (
    <ShopPageShell>
      {/* ─── MAIN ─── */}
      <main className="shop-auth-main">
        <div className="w-full max-w-sm">

          {/* ══ STEP 1 — Email input ══ */}
          {step === "email" && !needsEmailForLink && (
            <>
              <div className="text-center mb-8">
                {logoBox}
                <h1 className="font-serif text-2xl text-obsidian mb-1">
                  {notice ? "Get a new sign‑in link" : "Welcome back"}
                </h1>
                <p className="text-sm text-charcoal/45">
                  Enter your email and we&apos;ll send you a sign‑in link.
                </p>
              </div>

              {noticeBanner}

              {/* Google sign-in */}
              <button
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full h-11 rounded-xl text-sm font-medium flex items-center justify-center gap-3 bg-cream border border-taupe/20 text-obsidian hover:bg-taupe/10 transition-all duration-300 btn-press cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </button>
              {inAppBrowser && (
                <p className="text-[11px] text-charcoal/45 text-center mt-2">
                  {IN_APP_BROWSER_GOOGLE_HINT}
                </p>
              )}

              {/* Divider */}
              <div className="relative flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-taupe/20" />
                <span className="text-[11px] uppercase tracking-wide text-charcoal/30">or</span>
                <div className="flex-1 h-px bg-taupe/20" />
              </div>

              <form onSubmit={handleSendLink} className="space-y-4">
                <div>
                  <label className="block text-[11px] tracking-wide uppercase text-charcoal/45 font-medium mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    value={emailValue}
                    onChange={(e) => setEmailValue(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    autoFocus
                    className="w-full h-11 px-4 rounded-xl bg-cream border border-taupe/20 text-sm text-obsidian placeholder:text-charcoal/25 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
                  />
                </div>

                {errorBanner}

                <button
                  type="submit"
                  disabled={!emailValue.trim() || loading}
                  className={`w-full h-11 rounded-xl text-sm font-medium tracking-wider uppercase transition-all duration-300 btn-press cursor-pointer ${
                    emailValue.trim() && !loading
                      ? "bg-forest text-bone hover:bg-forest-dark"
                      : "bg-taupe/20 text-charcoal/25 cursor-not-allowed"
                  }`}
                >
                  {loading ? spinner : "Continue"}
                </button>
              </form>

              {termsFooter}
            </>
          )}

          {/* ══ STEP 2 — Link sent ══ */}
          {step === "sent" && (
            <>
              <div className="text-center mb-8">
                {logoBox}
                <h1 className="font-serif text-2xl text-obsidian mb-1">
                  {isPaidMemberFlow ? "Welcome back" : "Check your email"}
                </h1>
                <p className="text-sm text-charcoal/45">
                  {isPaidMemberFlow ? "Your membership is active. " : ""}We sent a sign‑in link to{" "}
                  <strong className="text-obsidian font-medium">{emailValue}</strong>.
                </p>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl bg-cream border border-taupe/15 px-5 py-4 text-sm text-charcoal/55 leading-relaxed">
                  Click the link in your inbox to sign in. Each link works once and expires after a while, so use the newest one. If it stops working, come back here for a fresh link.
                  <span className="block mt-2">
                    The link comes from info@mymully.com. Check Spam or Promotions if you don&apos;t see it.
                  </span>
                </div>

                {errorBanner}

                <button
                  onClick={handleResend}
                  disabled={resendCooldown > 0 || loading}
                  className={`w-full h-11 rounded-xl text-sm font-medium tracking-wider uppercase transition-all duration-300 btn-press cursor-pointer ${
                    resendCooldown > 0 || loading
                      ? "bg-taupe/20 text-charcoal/25 cursor-not-allowed"
                      : "bg-forest text-bone hover:bg-forest-dark"
                  }`}
                >
                  {loading
                    ? spinner
                    : resendCooldown > 0
                    ? `Resend in ${resendCooldown}s`
                    : "Resend link"}
                </button>

                <button
                  onClick={() => { setStep("email"); setError(null); }}
                  className="w-full text-sm text-charcoal/45 hover:text-charcoal/70 transition-colors duration-300 cursor-pointer"
                >
                  Use a different email
                </button>
              </div>
            </>
          )}

          {/* ══ Confirming — auto sign-in in progress ══ */}
          {step === "confirming" && (
            <>
              <div className="text-center mb-8">
                {logoBox}
                <h1 className="font-serif text-2xl text-obsidian mb-1">Signing you in…</h1>
                <p className="text-sm text-charcoal/45">Just a moment.</p>
              </div>
              <div className="flex justify-center py-4">
                <div className="w-6 h-6 border-2 border-forest/30 border-t-forest rounded-full animate-spin" />
              </div>
            </>
          )}

          {/* ══ Different device — user must enter their email to confirm ══ */}
          {needsEmailForLink && step === "email" && (
            <>
              <div className="text-center mb-8">
                {logoBox}
                <h1 className="font-serif text-2xl text-obsidian mb-1">Confirm your email</h1>
                <p className="text-sm text-charcoal/45">
                  Enter the email you used to request this link.
                </p>
              </div>

              <form onSubmit={handleConfirmWithEmail} className="space-y-4">
                <div>
                  <label className="block text-[11px] tracking-wide uppercase text-charcoal/45 font-medium mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    value={emailValue}
                    onChange={(e) => setEmailValue(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    autoFocus
                    className="w-full h-11 px-4 rounded-xl bg-cream border border-taupe/20 text-sm text-obsidian placeholder:text-charcoal/25 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
                  />
                </div>

                {errorBanner}

                <button
                  type="submit"
                  disabled={!emailValue.trim() || loading}
                  className={`w-full h-11 rounded-xl text-sm font-medium tracking-wider uppercase transition-all duration-300 btn-press cursor-pointer ${
                    emailValue.trim() && !loading
                      ? "bg-forest text-bone hover:bg-forest-dark"
                      : "bg-taupe/20 text-charcoal/25 cursor-not-allowed"
                  }`}
                >
                  {loading ? spinner : "Sign In"}
                </button>
              </form>

              <button
                type="button"
                onClick={() => recoverFromDeadLink(knownIntendedEmail(), null)}
                className="w-full mt-4 text-sm text-charcoal/45 hover:text-charcoal/70 transition-colors duration-300 cursor-pointer"
              >
                Send me a new link instead
              </button>

              {termsFooter}
            </>
          )}

        </div>
      </main>
    </ShopPageShell>
  );
}
