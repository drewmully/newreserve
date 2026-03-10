"use client";

import { MembershipProvider } from "./MembershipContext";
import { EmailLinkHandler } from "../components/EmailLinkHandler";
import { PageViewTracker } from "../components/PageViewTracker";
import { Suspense, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <MembershipProvider>
      <EmailLinkHandler />
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      {children}
    </MembershipProvider>
  );
}
