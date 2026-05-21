"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMembership } from "@/app/context/MembershipContext";

// Globally-typed gtag shim so we can call window.gtag(...) without TS errors.
declare global {
  interface Window {
    gtag?: (
      command: "event",
      eventName: string,
      params?: Record<string, unknown>
    ) => void;
  }
}

/* ═══════════════════════════════════════════
   AUTH CALLBACK PAGE
   Handles the return from Shopify checkout.
   ─ If authenticated  → purchase confirmation + auto-redirect to dashboard
   ─ If not authenticated → redirect to login
   ═══════════════════════════════════════════ */

export default function AuthCallbackPage() {
  const router = useRouter();
  const { isSignedIn, authLoading } = useMembership();

  // Fire Google Ads purchase conversion client-side. The server-side
  // orders-paid webhook also fires — both share the same transaction_id
  // (mully_txn_id, set on the LP and round-tripped via Shopify note_attributes)
  // so Google Ads dedupes automatically.
  useEffect(() => {
    try {
      const conversionId =
        process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID || "";
      const purchaseLabel =
        process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_PURCHASE || "";
      if (!conversionId || !purchaseLabel) return;
      if (typeof window === "undefined" || typeof window.gtag !== "function") return;

      // Prevent double-fire on re-mounts / strict-mode double-invokes.
      const FIRED_KEY = "mully_ga_conv_fired";
      if (sessionStorage.getItem(FIRED_KEY)) return;

      const txnId =
        localStorage.getItem("mully_pending_txn_id") ||
        `mully-callback-${Date.now()}`;

      window.gtag("event", "conversion", {
        send_to: `${conversionId}/${purchaseLabel}`,
        value: 1.0,
        currency: "USD",
        transaction_id: txnId,
      });

      sessionStorage.setItem(FIRED_KEY, "1");
      // Clear the pending id so the next checkout generates a fresh one.
      localStorage.removeItem("mully_pending_txn_id");
    } catch {
      // Never let analytics break the auth callback flow.
    }
  }, []);

  // Redirect unauthenticated visitors to login — they came back from Shopify checkout
  useEffect(() => {
    if (!authLoading && !isSignedIn) {
      try { localStorage.setItem("mully_post_checkout", "true"); } catch {}
      router.replace("/login");
    }
  }, [authLoading, isSignedIn, router]);

  // Auto-redirect authenticated users to dashboard after 3 s
  useEffect(() => {
    if (!authLoading && isSignedIn) {
      const timer = setTimeout(() => router.replace("/home"), 3000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, isSignedIn, router]);

  if (authLoading || !isSignedIn) {
    return (
      <div className="min-h-screen bg-bone flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-forest/30 border-t-forest rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bone flex flex-col items-center justify-center px-5">
      <div className="w-full max-w-sm text-center">
        {/* Logo */}
        <div className="w-12 h-12 rounded-2xl bg-forest/8 flex items-center justify-center mx-auto mb-6">
          <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto text-forest" aria-hidden="true">
            <path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" />
          </svg>
        </div>

        {/* Checkmark */}
        <div className="w-16 h-16 rounded-full bg-forest/10 flex items-center justify-center mx-auto mb-5">
          <svg className="w-8 h-8 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="font-serif text-2xl text-obsidian mb-2">Purchase Confirmed</h1>
        <p className="text-sm text-charcoal/50 leading-relaxed mb-8">
          Thank you for your purchase. Your membership is being updated —
          you&apos;ll be redirected to your dashboard shortly.
        </p>

        <Link
          href="/home"
          className="inline-flex items-center justify-center h-11 px-8 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300"
        >
          Go to Dashboard
        </Link>

        <p className="text-xs text-charcoal/30 mt-4">Redirecting automatically…</p>
      </div>
    </div>
  );
}
