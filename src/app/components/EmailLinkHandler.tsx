"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { auth, isSignInWithEmailLink, confirmOTPSignIn } from "@/lib/firebase";

/**
 * Mounted on every page inside MembershipProvider.
 * Detects Firebase Email Link sign-in URLs and completes the auth flow
 * for any page the user might land on (e.g. if actionCodeSettings.url
 * is changed to something other than /login in the future).
 *
 * The /login page handles links itself, so we skip it here to avoid
 * double-handling.
 */
export function EmailLinkHandler() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Let /login handle its own link detection
    if (pathname === "/login") return;
    if (!isSignInWithEmailLink(auth, window.location.href)) return;

    const email = localStorage.getItem("emailForSignIn") ?? "";
    if (!email) {
      // No stored email (different device) — send to /login to collect it
      router.replace("/login");
      return;
    }

    const withRetry = async (fn: () => Promise<void>, maxAttempts = 3): Promise<void> => {
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await fn();
        } catch (err) {
          lastError = err;
          console.error(`[EmailLinkHandler] attempt ${attempt}/${maxAttempts} failed:`, err);
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 600 * attempt));
          }
        }
      }
      throw lastError;
    };

    withRetry(() => confirmOTPSignIn(email, window.location.href))
      .then(() => {
        router.replace("/home");
      })
      .catch((err) => {
        console.error("[EmailLinkHandler] sign-in failed after all retries:", err);
        router.replace("/login");
      });
  }, [pathname, router]);

  return null;
}
