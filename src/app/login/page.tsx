"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMembership } from "../context/MembershipContext";
import { auth, isSignInWithEmailLink, confirmOTPSignIn, signInWithGoogle } from "@/lib/firebase";
import { PENDING_SIGN_IN_EMAIL_KEY } from "@/lib/pendingSignInEmail";
import { SHOPIFY_MEMBERSHIP_PLANS } from "@/lib/membershipConfig";
import { buildCheckoutOriginAttributes } from "@/lib/shopifyCheckoutOrigin";

const PENDING_ONBOARDING_DATA_KEY = "pending_onboarding_data";

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
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 600 * attempt));
      }
    }
  }
  throw lastError;
}

function mapAuthError(code: string): string {
  const messages: Record<string, string> = {
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/too-many-requests": "Too many attempts. Please try again later.",
    "auth/unauthorized-continue-uri":
      "Sign-in is not configured for this domain.",
    "auth/expired-action-code":
      "This link has expired. Please request a new one.",
    "auth/invalid-action-code":
      "This link has already been used or is invalid.",
    "auth/user-disabled": "This account has been disabled.",
  };
  return messages[code] ?? "Something went wrong. Please try again.";
}

async function createCheckoutAndRedirect(tier: "access" | "member") {
  const PLANS = {
    access: {
      merchandiseId: SHOPIFY_MEMBERSHIP_PLANS.access.merchandiseId,
      sellingPlanId: SHOPIFY_MEMBERSHIP_PLANS.access.sellingPlanGid,
    },
    member: {
      merchandiseId: SHOPIFY_MEMBERSHIP_PLANS.member.merchandiseId,
      sellingPlanId: SHOPIFY_MEMBERSHIP_PLANS.member.sellingPlanGid,
    },
  };
  const { merchandiseId, sellingPlanId } = PLANS[tier];
  const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
  const token = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
  if (!domain || !token) return;

  const returnTo = `${window.location.origin}/auth/callback`;
  const attributes = buildCheckoutOriginAttributes(returnTo);

  const res = await fetch(`https://${domain}/api/2024-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token,
    },
    body: JSON.stringify({
      query: `mutation CreateSubscriptionCart(
        $merchandiseId: ID!
        $sellingPlanId: ID!
        $attributes: [AttributeInput!]
      ) {
        cartCreate(input: {
          lines: [{ merchandiseId: $merchandiseId, quantity: 1, sellingPlanId: $sellingPlanId }],
          attributes: $attributes
        }) {
          cart { checkoutUrl }
          userErrors { field message }
        }
      }`,
      variables: { merchandiseId, sellingPlanId, attributes },
    }),
  });

  const json = await res.json();
  const checkoutUrl = json?.data?.cartCreate?.cart?.checkoutUrl;
  if (checkoutUrl) {
    window.location.href = checkoutUrl;
  }
}

export default function LoginPage() {
  const router = useRouter();
  const { sendOTPEmail, isSignedIn, authLoading, onboardingCompleted, completeOnboarding, setTier, email: contextEmail } = useMembership();
  const pendingOnboardingHandled = useRef(false);

  // Detect email link synchronously on first render so we never flash the form
  const [step, setStep] = useState<Step>(() => {
    if (typeof window === "undefined") return "email";
    return isSignInWithEmailLink(auth, window.location.href)
      ? "confirming"
      : "email";
  });

  const [emailValue, setEmailValue] = useState(() => {
    if (contextEmail) return contextEmail;
    if (typeof window === "undefined") return "";
    try {
      return sessionStorage.getItem(PENDING_SIGN_IN_EMAIL_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  // True when the link is opened on a different device (no localStorage entry)
  const [needsEmailForLink, setNeedsEmailForLink] = useState(false);

  /* ── Handle email link on mount ── */
  useEffect(() => {
    if (!isSignInWithEmailLink(auth, window.location.href)) return;

    const savedEmail = localStorage.getItem("emailForSignIn") ?? "";
    if (savedEmail) {
      // Same device — auto-confirm
      setEmailValue(savedEmail);
      withRetry(() => confirmOTPSignIn(savedEmail, window.location.href)).catch((err) => {
        console.error("[SignIn] auto-confirm failed after all retries:", err);
        setError(mapAuthError((err as { code?: string })?.code ?? ""));
        setStep("email");
      });
    } else {
      // Different device — ask user for email
      setStep("email");
      setNeedsEmailForLink(true);
    }
  }, []);

  useEffect(() => {
    if (!contextEmail) return;
    setEmailValue((current) => current || contextEmail);
  }, [contextEmail]);

  /* ── Redirect once authenticated ── */
  useEffect(() => {
    if (authLoading || !isSignedIn) return;
    if (pendingOnboardingHandled.current) return;

    const raw = (() => {
      try { return sessionStorage.getItem(PENDING_ONBOARDING_DATA_KEY); } catch { return null; }
    })();

    if (raw && !onboardingCompleted) {
      pendingOnboardingHandled.current = true;
      try {
        const data = JSON.parse(raw) as {
          username: string;
          onboardingProfile: Record<string, unknown>;
          fitProfile?: Record<string, unknown>;
          selectedTier: "free" | "access" | "member";
        };
        try { sessionStorage.removeItem(PENDING_ONBOARDING_DATA_KEY); } catch {}

        const { selectedTier, username, onboardingProfile, fitProfile } = data;

        void completeOnboarding({
          username,
          onboardingProfile: onboardingProfile as unknown as Parameters<typeof completeOnboarding>[0]["onboardingProfile"],
          fitProfile: fitProfile as unknown as Parameters<typeof completeOnboarding>[0]["fitProfile"],
        }).then(() => {
          setTier(selectedTier);
          if (selectedTier === "access" || selectedTier === "member") {
            return createCheckoutAndRedirect(selectedTier);
          } else {
            router.replace("/home");
          }
        }).catch((err) => {
          console.error("[Login] pending onboarding apply failed:", err);
          router.replace("/onboarding");
        });
      } catch {
        router.replace(onboardingCompleted ? "/home" : "/onboarding");
      }
      return;
    }

    router.replace(onboardingCompleted ? "/home" : "/onboarding");
  }, [authLoading, isSignedIn, onboardingCompleted, router, completeOnboarding, setTier]);

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

  async function handleSendLink(e: React.FormEvent) {
    e.preventDefault();
    const email = emailValue.trim();
    if (!email) return;
    setLoading(true);
    setError(null);
    try {
      await sendOTPEmail(email);
      try {
        sessionStorage.removeItem(PENDING_SIGN_IN_EMAIL_KEY);
      } catch {}
      setStep("sent");
      setResendCooldown(60);
    } catch (err) {
      setError(mapAuthError((err as { code?: string })?.code ?? ""));
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
      setError(mapAuthError((err as { code?: string })?.code ?? ""));
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0 || loading) return;
    setLoading(true);
    setError(null);
    try {
      await sendOTPEmail(emailValue.trim());
      setResendCooldown(60);
    } catch (err) {
      setError(mapAuthError((err as { code?: string })?.code ?? ""));
    } finally {
      setLoading(false);
    }
  }

  // Confirm the link on a different device after the user types their email
  async function handleConfirmWithEmail(e: React.FormEvent) {
    e.preventDefault();
    const email = emailValue.trim();
    if (!email) return;
    setLoading(true);
    setError(null);
    setStep("confirming");
    try {
      await withRetry(() => confirmOTPSignIn(email, window.location.href));
      // onAuthStateChanged → isSignedIn → redirect
    } catch (err) {
      console.error("[SignIn] handleConfirmWithEmail failed after all retries:", err);
      setError(mapAuthError((err as { code?: string })?.code ?? ""));
      setStep("email");
      setNeedsEmailForLink(true);
    } finally {
      setLoading(false);
    }
  }

  /* ── Shared UI pieces ── */

  const logoBox = (
    <div className="w-12 h-12 rounded-2xl bg-forest/8 flex items-center justify-center mx-auto mb-4">
      <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto text-forest" aria-hidden="true">
        <path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" />
      </svg>
    </div>
  );

  const spinner = (
    <span className="inline-flex items-center gap-2">
      <span className="w-4 h-4 border-2 border-bone/30 border-t-bone rounded-full animate-spin" />
    </span>
  );

  const errorBanner = error && (
    <p className="text-xs text-red-600/80 bg-red-50 border border-red-200/60 rounded-lg px-3 py-2.5 text-center">
      {error}
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
    <div className="min-h-screen bg-bone flex flex-col">
      {/* ─── HEADER ─── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/15">
        <div className="max-w-7xl mx-auto px-5 md:px-12 flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2 text-forest">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-4 w-auto" aria-hidden="true">
              <path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" />
            </svg>
            <span className="font-serif text-xl font-bold tracking-wide">mully.</span>
          </Link>
        </div>
      </header>

      {/* ─── MAIN ─── */}
      <main className="flex-1 flex items-center justify-center pt-14 px-5 py-12">
        <div className="w-full max-w-sm">

          {/* ══ STEP 1 — Email input ══ */}
          {step === "email" && !needsEmailForLink && (
            <>
              <div className="text-center mb-8">
                {logoBox}
                <h1 className="font-serif text-2xl text-obsidian mb-1">Welcome back</h1>
                <p className="text-sm text-charcoal/45">
                  Enter your email and we&apos;ll send you a sign‑in link.
                </p>
              </div>

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
                <h1 className="font-serif text-2xl text-obsidian mb-1">Check your email</h1>
                <p className="text-sm text-charcoal/45">
                  We sent a sign‑in link to{" "}
                  <strong className="text-obsidian font-medium">{emailValue}</strong>.
                </p>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl bg-cream border border-taupe/15 px-5 py-4 text-sm text-charcoal/55 leading-relaxed">
                  Click the link in your inbox to sign in. It expires after 1&nbsp;hour.
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
          {needsEmailForLink && (
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

              {termsFooter}
            </>
          )}

        </div>
      </main>
    </div>
  );
}
