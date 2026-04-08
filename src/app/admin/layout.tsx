"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "authorized" | "unauthorized">("loading");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user || !user.email) {
        router.replace("/login");
        return;
      }
      if (isAllowedAdminEmail(user.email)) {
        setStatus("authorized");
      } else {
        setStatus("unauthorized");
      }
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
