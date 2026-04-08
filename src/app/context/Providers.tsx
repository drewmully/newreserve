"use client";

import { usePathname } from "next/navigation";
import { MembershipProvider } from "./MembershipContext";
import { EmailLinkHandler } from "../components/EmailLinkHandler";
import { PageViewTracker } from "../components/PageViewTracker";
import { Suspense, type ReactNode } from "react";

const MEMBERSHIP_EXEMPT_PREFIXES = [
  "/faq",
  "/handoff",
  "/policies",
  "/reservecard",
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
      <EmailLinkHandler />
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      {shouldWrapWithMembership ? (
        <MembershipProvider>{children}</MembershipProvider>
      ) : (
        children
      )}
    </>
  );
}
