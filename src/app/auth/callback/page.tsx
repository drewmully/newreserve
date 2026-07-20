"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMembership } from "@/app/context/MembershipContext";

// Globally-typed gtag + fbq shims so we can call them without TS errors.
declare global {
  interface Window {
    gtag?: (
      command: "event" | "set" | "config" | "js",
      eventNameOrTarget: string | Date,
      params?: Record<string, unknown>
    ) => void;
    dataLayer?: unknown[];
    fbq?: (...args: unknown[]) => void;
  }
}

/**
 * Wait until window.gtag exists. gtag.js is loaded via next/script with
 * strategy="afterInteractive", which means it may not be ready on first paint
 * of /auth/callback. Poll for up to ~3s (30 × 100ms) then resolve true/false.
 */
async function waitForGtag(maxAttempts = 30, intervalMs = 100): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      return true;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
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
  // orders-paid webhook + Shopify Custom Pixel also fire — all three share
  // the same transaction_id (mully_txn_id, set on the LP and round-tripped
  // via Shopify note_attributes) so Google Ads dedupes automatically.
  //
  // RACE CONDITION FIX: gtag.js is loaded via next/script strategy="afterInteractive"
  // which means window.gtag may not exist when this useEffect first runs.
  // We poll for gtag up to ~3s, then fire with event_callback so we can
  // guarantee the conversion ping leaves the browser before we redirect.
  const [conversionFired, setConversionFired] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const FIRED_KEY = "mully_ga_conv_fired";

    (async () => {
      try {
        // Already fired this session — nothing to do.
        if (sessionStorage.getItem(FIRED_KEY)) {
          if (!cancelled) setConversionFired(true);
          return;
        }

        const conversionId =
          process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID || "";
        const purchaseLabel =
          process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_PURCHASE || "";
        if (!conversionId || !purchaseLabel) {
          if (!cancelled) setConversionFired(true); // Nothing to fire — unblock redirect.
          return;
        }

        const ready = await waitForGtag();
        if (cancelled) return;

        if (!ready) {
          // gtag never loaded (adblocker, network failure). Don't block the
          // user — server-side webhook is our source of truth anyway.
          console.warn("[gtag] not available after polling — skipping client conversion");
          if (!cancelled) setConversionFired(true);
          return;
        }

        const txnId =
          localStorage.getItem("mully_pending_txn_id") ||
          `mully-callback-${Date.now()}`;

        // event_callback fires once the conversion ping has been sent (or
        // event_timeout elapses). We use it to delay the redirect so gtag
        // doesn't get interrupted mid-flight by navigation.
        let callbackFired = false;
        const finish = () => {
          if (callbackFired || cancelled) return;
          callbackFired = true;
          try {
            sessionStorage.setItem(FIRED_KEY, "1");
            localStorage.removeItem("mully_pending_txn_id");
          } catch {}
          setConversionFired(true);
        };

        window.gtag?.("event", "conversion", {
          send_to: `${conversionId}/${purchaseLabel}`,
          value: 1.0,
          currency: "USD",
          transaction_id: txnId,
          event_callback: finish,
          event_timeout: 1500,
        });

        // Safety net: gtag's event_callback isn't 100% reliable — guarantee
        // we unblock within 2s even if the callback never fires.
        setTimeout(finish, 2000);
      } catch (err) {
        console.warn("[gtag] conversion fire failed:", err);
        if (!cancelled) setConversionFired(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Redirect unauthenticated visitors to login — they came back from Shopify checkout
  useEffect(() => {
    if (!authLoading && !isSignedIn) {
      try { localStorage.setItem("mully_post_checkout", "true"); } catch {}
      router.replace("/login");
    }
  }, [authLoading, isSignedIn, router]);

  // Auto-redirect authenticated users to dashboard ONLY after the Google Ads
  // conversion has fired (or the safety-net timeout has elapsed). This is the
  // critical race fix — we used to redirect 3s after sign-in regardless of
  // whether gtag was ready, which dropped conversions on slow networks.
  useEffect(() => {
    if (!authLoading && isSignedIn && conversionFired) {
      const timer = setTimeout(() => router.replace("/home"), 1500);
      return () => clearTimeout(timer);
    }
  }, [authLoading, isSignedIn, conversionFired, router]);

  // ── Meta CAPI dedup: fire browser-side Purchase pixel ──────────────────
  //
  // The orders-paid webhook already sent a server-side Purchase to Meta
  // via CAPI (see src/app/api/_lib/analytics.ts). Meta's Ads Manager was
  // double-counting those Purchases because CAPI had no browser-side
  // partner to dedup against — Meta was crediting the CAPI event AND a
  // "modeled" browser conversion for the same order.
  //
  // Now: we fetch the just-paid order's event_id from Firestore via
  // /api/purchase-context (uses the same deterministic
  // `purchase_<shopify_order_id>` id the webhook stamped on the CAPI
  // event) and fire fbq with eventID set. Meta then merges the two into
  // a single conversion. The server flips a Firestore flag on first
  // response, and we also gate on sessionStorage, so refreshes /
  // back-navigation never re-fire.
  //
  // Non-fatal by design: if fbq is missing (adblocker, script failure)
  // or the API call fails, we log and move on. CAPI still gives Meta
  // the conversion; only the dedup benefit is lost.
  const [metaFired, setMetaFired] = useState(false);
  useEffect(() => {
    if (authLoading || !isSignedIn) return;
    let cancelled = false;
    const SESSION_KEY = "mully_meta_purchase_fired";

    (async () => {
      try {
        if (sessionStorage.getItem(SESSION_KEY)) {
          if (!cancelled) setMetaFired(true);
          return;
        }

        // Get Firebase ID token — we need it to call our server API.
        const { getAuth } = await import("firebase/auth");
        const user = getAuth().currentUser;
        if (!user) {
          if (!cancelled) setMetaFired(true);
          return;
        }
        const idToken = await user.getIdToken();

        const resp = await fetch("/api/purchase-context", {
          headers: { Authorization: `Bearer ${idToken}` },
          cache: "no-store",
        });
        if (!resp.ok) throw new Error(`purchase-context ${resp.status}`);
        const ctx = (await resp.json()) as {
          has_purchase?: boolean;
          already_captured?: boolean;
          event_id?: string;
          value?: number;
          currency?: string;
        };

        if (!ctx.has_purchase || ctx.already_captured || !ctx.event_id) {
          try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
          if (!cancelled) setMetaFired(true);
          return;
        }

        if (typeof window.fbq !== "function") {
          // Meta Pixel base code didn't load — nothing to dedup with,
          // but mark done so we don't retry on every render.
          try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
          if (!cancelled) setMetaFired(true);
          return;
        }

        window.fbq(
          "track",
          "Purchase",
          { value: ctx.value ?? 0, currency: ctx.currency ?? "USD" },
          { eventID: ctx.event_id }
        );

        try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
        if (!cancelled) setMetaFired(true);
      } catch (err) {
        console.warn("[meta] Purchase dedup fire skipped:", err);
        if (!cancelled) setMetaFired(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, isSignedIn]);
  // metaFired is intentionally not blocking the redirect — the ping
  // to Meta's edge is fire-and-forget and completes in <100ms in
  // practice. Reference it so the linter doesn't drop the state var.
  void metaFired;

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
