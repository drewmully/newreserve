"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { PageViewTracker } from "../components/PageViewTracker";
import { Suspense, type ReactNode } from "react";

const MembershipProvider = dynamic<{ children: ReactNode }>(() =>
  import("./MembershipContext").then((mod) => mod.MembershipProvider)
);

const EmailLinkHandler = dynamic(
  () =>
    import("../components/EmailLinkHandler").then(
      (mod) => mod.EmailLinkHandler
    ),
  { ssr: false }
);

const MEMBERSHIP_EXEMPT_PREFIXES = [
  "/subscription",
  "/handoff",
  "/mulligan",
  "/reservecard",
  // Standalone pitch / preview pages that don't need Firebase auth
  // or the Back9 welcome overlay.
  "/swingbox",
];

export function shouldUseMembershipProvider(pathname: string | null): boolean {
  if (!pathname) return true;
  return !MEMBERSHIP_EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const shouldWrapWithMembership = shouldUseMembershipProvider(pathname);

  return (
    <>
      {shouldWrapWithMembership && <EmailLinkHandler />}
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      {shouldWrapWithMembership ? (
        <MembershipProvider>
          {children}
        </MembershipProvider>
      ) : (
        children
      )}
    </>
  );
}
