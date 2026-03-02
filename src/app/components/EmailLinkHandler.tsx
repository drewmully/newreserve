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

    confirmOTPSignIn(email, window.location.href)
      .then(() => {
        router.replace("/dashboard");
      })
      .catch(() => {
        router.replace("/login");
      });
  }, [pathname, router]);

  return null;
}
