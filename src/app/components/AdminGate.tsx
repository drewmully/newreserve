"use client";

/**
 * Wraps a page in the admin auth gate (same logic as /admin/layout.tsx).
 * Use this for top-level admin-only pages outside the /admin/ tree,
 * e.g. /customers, /ops.
 *
 * Usage in a page.tsx:
 *
 *   "use client";
 *   import AdminGate from "@/app/components/AdminGate";
 *   export default function Page() {
 *     return <AdminGate><MyContent /></AdminGate>;
 *   }
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { clientAdminStatus, type ClientAdminStatus } from "@/lib/adminClientGate";

export default function AdminGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | ClientAdminStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user || !user.email) {
        router.replace("/login");
        return;
      }
      void clientAdminStatus(user).then((next) => {
        if (!cancelled) setStatus(next);
      });
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <p className="text-charcoal/40 text-sm">Loading...</p>
      </div>
    );
  }
  if (status === "reauth") return <AdminReauthNotice />;
  if (status === "unauthorized") {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <p className="text-charcoal/60 text-sm">Access denied.</p>
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * Shown to allowlisted admins whose current session can't be used for admin
 * access (e.g. a custom-token session from the homepage email form, or an
 * unverified email). Signing in again with Google or an email link fixes it.
 */
export function AdminReauthNotice() {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-6">
      <div className="max-w-sm text-center space-y-4">
        <p className="text-charcoal/70 text-sm">
          Admin access needs a verified sign-in. Sign out, then sign in again with Google or an email link.
        </p>
        <button
          type="button"
          onClick={() => { void signOut(auth).finally(() => router.replace("/login")); }}
          className="min-h-11 rounded-xl bg-forest px-5 text-sm text-bone"
        >
          Sign out and sign in again
        </button>
      </div>
    </div>
  );
}
