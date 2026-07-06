"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PENDING_SIGN_IN_EMAIL_KEY } from "@/lib/pendingSignInEmail";
import { trackEvent } from "@/lib/tracking";

export const PENDING_ONBOARDING_EMAIL_KEY = "pending_onboarding_email";

/** Read UTM/click ID query params off the current URL. */
function collectAttribution(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const sp = new URLSearchParams(window.location.search);
    const out: Record<string, string> = {};
    for (const k of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "gclid",
      "gbraid",
      "wbraid",
    ]) {
      const v = sp.get(k);
      if (v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function EmailCTA({ variant = "hero", ctaText }: { variant?: "hero" | "bottom"; ctaText?: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = value.trim();
    if (!email || loading) return;

    setLoading(true);

    // Always remember the email locally (for fallback paths).
    try { sessionStorage.setItem(PENDING_ONBOARDING_EMAIL_KEY, email); } catch {}

    // Fire "email submitted" up front so we can measure top-of-funnel even
    // if the user bounces before /choose-plan loads.
    void trackEvent("email_submitted", {
      email,
      properties: { source: variant === "hero" ? "hero_cta" : "bottom_cta" },
    });

    try {
      const checkRes = await fetch("/api/auth/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      let exists = false;
      if (checkRes.ok) {
        try {
          const data = (await checkRes.json()) as { exists?: boolean };
          exists = data.exists === true;
        } catch {
          // Treat as new user.
        }
      }

      if (exists) {
        try { sessionStorage.setItem(PENDING_SIGN_IN_EMAIL_KEY, email); } catch {}
        router.push("/login");
        return;
      }

      // Not in Firebase Auth yet — but this could still be a legacy Loop
      // subscriber whose Firebase account was never created. Ask Loop
      // before assuming they're a new signup. If Loop says they're an
      // active paying member, /api/auth/check-loop-status provisions the
      // Firebase user + Firestore doc and emails them a magic link.
      try {
        const loopRes = await fetch("/api/auth/check-loop-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (loopRes.ok) {
          const loopData = (await loopRes.json()) as {
            paid?: boolean;
            tier?: string;
            isLegacy?: boolean;
          };
          if (loopData.paid === true) {
            void trackEvent("legacy_loop_login_provisioned", {
              email,
              properties: {
                tier: loopData.tier ?? "unknown",
                is_legacy: loopData.isLegacy ?? false,
                source: variant === "hero" ? "hero_cta" : "bottom_cta",
              },
            });
            try { sessionStorage.setItem(PENDING_SIGN_IN_EMAIL_KEY, email); } catch {}
            router.push("/login?paid_member=1");
            return;
          }
        }
      } catch {
        // Loop lookup failed — fall through to the standard new-user path.
      }

      // New user: create a Firebase account with no password and sign in
      // with the returned custom token, then route to /choose-plan.
      const startRes = await fetch("/api/auth/start-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          source: variant === "hero" ? "hero_cta" : "bottom_cta",
          utm: collectAttribution(),
        }),
      });

      if (!startRes.ok) {
        // Fall back to the legacy onboarding page so we never lose a lead.
        router.push("/onboarding");
        return;
      }

      const startData = (await startRes.json()) as {
        uid?: string;
        customToken?: string;
      };

      if (startData.customToken) {
        try {
          const [{ auth }, { signInWithCustomToken }] = await Promise.all([
            import("@/lib/firebase"),
            import("firebase/auth"),
          ]);
          await signInWithCustomToken(auth, startData.customToken);
          void trackEvent("account_created", {
            user_id: startData.uid,
            email,
            properties: { method: "email_only", tier: "free" },
          });
        } catch (signInErr) {
          console.error("[EmailCTA] custom-token sign-in failed:", signInErr);
          // Fall through to /choose-plan anyway — the page treats unauth
          // users as legitimate guests and re-prompts.
        }
      }

      router.push("/choose-plan");
    } catch {
      // Network error — keep them moving via the legacy path.
      router.push("/onboarding");
    } finally {
      setLoading(false);
    }
  };

  if (variant === "hero") {
    return (
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full max-w-xs sm:max-w-md mx-auto md:mx-0 mb-5">
        <input
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Your email"
          disabled={loading}
          className="w-full sm:flex-1 h-12 px-5 rounded-lg bg-white border border-taupe/30 text-forest placeholder:text-charcoal/40 text-base focus:border-forest/40 focus:ring-1 focus:ring-forest/20 transition-all duration-300 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!value.trim() || loading}
          className="w-full sm:w-auto h-12 px-8 rounded-lg text-white text-sm font-semibold tracking-wider uppercase shadow-lg hover:brightness-110 transition-all duration-300 cursor-pointer whitespace-nowrap btn-press"
          style={{ background: '#D4772C' }}
        >
          {loading ? (
            <span className="inline-flex items-center justify-center">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </span>
          ) : (
            ctaText ?? "Unlock Access"
          )}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="email"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Your email"
        disabled={loading}
        className="w-full h-13 px-5 rounded-xl bg-bone border border-taupe/30 text-obsidian placeholder:text-taupe text-base focus:border-forest focus:ring-2 focus:ring-forest/20 transition-all duration-300 disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={!value.trim() || loading}
        className="w-full h-13 rounded-xl text-white text-sm font-semibold tracking-wider uppercase shadow-lg hover:brightness-110 transition-all duration-300 cursor-pointer btn-press"
        style={{ background: '#D4772C' }}
      >
        {loading ? (
          <span className="inline-flex items-center justify-center">
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </span>
        ) : (
          "Get Started"
        )}
      </button>
    </form>
  );
}
