"use client";

/**
 * NechvEmailCTA — the EmailCTA variant used on /nechv.
 *
 * Same UX and post-signup destination as the homepage EmailCTA, but:
 *   1. Tags the start-account call with `source: "nechv"` so the server
 *      records `signup_source = "nechv"` on the user doc. The grant-credit
 *      endpoint uses that signal as its eligibility check.
 *   2. After the custom-token sign-in succeeds, calls
 *      POST /api/nechv/grant-credit to apply $25 USD of Shopify store credit
 *      to the new member's Shopify customer. The grant is best-effort:
 *      a failure here logs to the console and PostHog but does NOT block
 *      the redirect — the new member should always reach /choose-plan.
 *      If the credit didn't apply, a manual or cron-driven backfill can
 *      retry idempotently.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PENDING_SIGN_IN_EMAIL_KEY } from "@/lib/pendingSignInEmail";
import { trackEvent } from "@/lib/tracking";
import { PENDING_ONBOARDING_EMAIL_KEY } from "./EmailCTA";

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

async function grantNechvCredit(idToken: string): Promise<void> {
  try {
    const res = await fetch("/api/nechv/grant-credit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; already_granted?: boolean; amount?: number; error?: string }
      | null;
    if (!res.ok || !data?.ok) {
      console.warn("[NechvEmailCTA] grant-credit failed", res.status, data?.error);
      void trackEvent("nechv_credit_grant_failed", {
        properties: { status: res.status, error: data?.error ?? "unknown" },
      });
      return;
    }
    void trackEvent("nechv_credit_granted", {
      properties: {
        amount: data.amount ?? 25,
        already_granted: data.already_granted ?? false,
      },
    });
  } catch (err) {
    console.warn("[NechvEmailCTA] grant-credit threw", err);
    void trackEvent("nechv_credit_grant_failed", {
      properties: { error: err instanceof Error ? err.message : "thrown" },
    });
  }
}

export function NechvEmailCTA({
  variant = "hero",
  ctaText,
}: {
  variant?: "hero" | "bottom";
  ctaText?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = value.trim();
    if (!email || loading) return;

    setLoading(true);

    try {
      sessionStorage.setItem(PENDING_ONBOARDING_EMAIL_KEY, email);
    } catch {}

    void trackEvent("email_submitted", {
      email,
      properties: {
        source: variant === "hero" ? "nechv_hero_cta" : "nechv_bottom_cta",
        landing: "nechv",
      },
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
          /* treat as new user */
        }
      }

      if (exists) {
        // Returning user — they don't get the perk again. Send them to
        // /login and let the existing flow do its thing. The grant-credit
        // endpoint is idempotent so even if they ever hit it the credit
        // would not double-apply.
        try {
          sessionStorage.setItem(PENDING_SIGN_IN_EMAIL_KEY, email);
        } catch {}
        router.push("/login");
        return;
      }

      const startRes = await fetch("/api/auth/start-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          source: "nechv",
          utm: collectAttribution(),
        }),
      });

      if (!startRes.ok) {
        // Fallback to legacy onboarding so we never lose a lead. The
        // user simply won't get the credit on this signup — we can
        // backfill from the Firestore `signup_source` field.
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
          const cred = await signInWithCustomToken(auth, startData.customToken);
          void trackEvent("account_created", {
            user_id: startData.uid,
            email,
            properties: { method: "email_only", tier: "free", landing: "nechv" },
          });

          // Grant the $25 store credit. Best-effort; don't block redirect.
          try {
            const idToken = await cred.user.getIdToken();
            await grantNechvCredit(idToken);
          } catch (creditErr) {
            console.warn("[NechvEmailCTA] failed to get id token", creditErr);
          }
        } catch (signInErr) {
          console.error("[NechvEmailCTA] custom-token sign-in failed:", signInErr);
        }
      }

      router.push("/choose-plan");
    } catch {
      router.push("/onboarding");
    } finally {
      setLoading(false);
    }
  };

  if (variant === "hero") {
    return (
      <form
        onSubmit={handleSubmit}
        className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full max-w-xs sm:max-w-md mx-auto md:mx-0 mb-5"
      >
        <input
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Your email"
          disabled={loading}
          aria-label="Email address"
          className="w-full sm:flex-1 h-12 px-5 rounded-lg bg-white border border-taupe/30 text-forest placeholder:text-charcoal/40 text-base focus:border-forest/40 focus:ring-1 focus:ring-forest/20 transition-all duration-300 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!value.trim() || loading}
          className="w-full sm:w-auto h-12 px-8 rounded-lg text-white text-sm font-semibold tracking-wider uppercase shadow-lg hover:brightness-110 transition-all duration-300 cursor-pointer whitespace-nowrap btn-press"
          style={{ background: "#D4772C" }}
        >
          {loading ? (
            <span className="inline-flex items-center justify-center">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </span>
          ) : (
            ctaText ?? "Claim $25 Credit"
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
        aria-label="Email address"
        className="w-full h-13 px-5 rounded-xl bg-bone border border-taupe/30 text-obsidian placeholder:text-taupe text-base focus:border-forest focus:ring-2 focus:ring-forest/20 transition-all duration-300 disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={!value.trim() || loading}
        className="w-full h-13 rounded-xl text-white text-sm font-semibold tracking-wider uppercase shadow-lg hover:brightness-110 transition-all duration-300 cursor-pointer btn-press"
        style={{ background: "#D4772C" }}
      >
        {loading ? (
          <span className="inline-flex items-center justify-center">
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </span>
        ) : (
          "Claim $25 Credit"
        )}
      </button>
    </form>
  );
}
