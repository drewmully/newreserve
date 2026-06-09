"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";

type NavLink = { href: string; label: string; exact?: boolean };

const NAV_LINKS: NavLink[] = [
  { href: "/admin/marketing-funnel", label: "Marketing" },
  { href: "/admin/ad-performance", label: "Ad Perf" },
  { href: "/admin/proshop", label: "Pro Shop" },
  { href: "/admin/cmo", label: "CMO" },
  { href: "/customers", label: "Customers" },
  { href: "/ops", label: "Ops" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/gifts", label: "Gifts" },
  { href: "/admin/email-replies", label: "Reply queue" },
  { href: "/admin/registry", label: "Club Registry" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
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

  return (
    <div className="min-h-screen bg-cream">
      <nav className="border-b border-taupe/20 bg-white">
        <div className="max-w-6xl mx-auto px-6 flex items-center gap-8 h-12">
          <span className="font-serif text-sm text-obsidian font-medium">Admin</span>
          <div className="flex items-center gap-6">
            {NAV_LINKS.map((link) => {
              const active = link.exact
                ? pathname === link.href
                : pathname === link.href || pathname.startsWith(link.href + "/");
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-sm transition-colors duration-200 ${
                    active
                      ? "text-forest font-medium"
                      : "text-charcoal/50 hover:text-charcoal"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
      {children}
    </div>
  );
}
