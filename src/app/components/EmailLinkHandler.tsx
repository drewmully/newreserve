"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { auth, isSignInWithEmailLink, confirmOTPSignIn } from "@/lib/firebase";
import { isRetryableAuthError } from "@/app/login/loginErrors";

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

    // /login owns every recovery path (different device, wrong email, dead
    // link), so hand it the original link query instead of dropping it.
    const loginWithLink = `/login${window.location.search}`;

    const email = localStorage.getItem("emailForSignIn") ?? "";
    if (!email) {
      // No stored email (different device) — send to /login to collect it
      router.replace(loginWithLink);
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
          // Expired/used codes never succeed on retry.
          if (!isRetryableAuthError(err)) break;
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 600 * attempt));
          }
        }
      }
      throw lastError;
    };

    withRetry(() => confirmOTPSignIn(email, window.location.href))
      .then(() => {
        router.replace("/");
      })
      .catch((err) => {
        console.error("[EmailLinkHandler] sign-in failed after all retries:", err);
        // /login retries once, then shows the "send a fresh link" recovery
        // (or the wrong-email prompt) and strips the dead code from the URL.
        router.replace(loginWithLink);
      });
  }, [pathname, router]);

  return null;
}
