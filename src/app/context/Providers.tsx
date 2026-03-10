"use client";

import { MembershipProvider } from "./MembershipContext";
import { EmailLinkHandler } from "../components/EmailLinkHandler";
import { PageViewTracker } from "../components/PageViewTracker";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <MembershipProvider>
      <EmailLinkHandler />
      <PageViewTracker />
      {children}
    </MembershipProvider>
  );
}
