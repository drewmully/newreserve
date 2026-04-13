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

const IntercomWidget = dynamic(
  () => import("../components/IntercomWidget").then((mod) => mod.IntercomWidget),
  { ssr: false }
);

const MEMBERSHIP_EXEMPT_PREFIXES = [
  "/",
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
      {shouldWrapWithMembership && <EmailLinkHandler />}
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      {shouldWrapWithMembership ? (
        <MembershipProvider>
          <IntercomWidget />
          {children}
        </MembershipProvider>
      ) : (
        children
      )}
    </>
  );
}
