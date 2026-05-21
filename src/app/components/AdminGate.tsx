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
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";

export default function AdminGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "authorized" | "unauthorized">("loading");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user || !user.email) {
        router.replace("/login");
        return;
      }
      setStatus(isAllowedAdminEmail(user.email) ? "authorized" : "unauthorized");
    });
    return unsub;
  }, [router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <p className="text-charcoal/40 text-sm">Loading...</p>
      </div>
    );
  }
  if (status === "unauthorized") {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <p className="text-charcoal/60 text-sm">Access denied.</p>
      </div>
    );
  }
  return <>{children}</>;
}
