"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PENDING_SIGN_IN_EMAIL_KEY } from "@/lib/pendingSignInEmail";

export const PENDING_ONBOARDING_EMAIL_KEY = "pending_onboarding_email";

export function EmailCTA({ variant = "hero" }: { variant?: "hero" | "bottom" }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = value.trim();
    if (!email || loading) return;

    setLoading(true);
    try {
      const res = await fetch("/api/auth/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      let exists = false;
      if (res.ok) {
        try {
          const data = await res.json() as { exists?: boolean };
          exists = data.exists === true;
        } catch {
          // JSON parse failed — treat as new user
        }
      }

      if (exists) {
        // Existing user → normal login flow
        try { sessionStorage.setItem(PENDING_SIGN_IN_EMAIL_KEY, email); } catch {}
        router.push("/login");
      } else {
        // New user (or error) → onboarding first
        try { sessionStorage.setItem(PENDING_ONBOARDING_EMAIL_KEY, email); } catch {}
        router.push("/onboarding");
      }
    } catch {
      // Network error — treat as new user
      try { sessionStorage.setItem(PENDING_ONBOARDING_EMAIL_KEY, email); } catch {}
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
            "Unlock Access"
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
