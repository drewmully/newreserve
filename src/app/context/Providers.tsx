"use client";

import { MembershipProvider } from "./MembershipContext";
import { EmailLinkHandler } from "../components/EmailLinkHandler";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <MembershipProvider>
      <EmailLinkHandler />
      {children}
    </MembershipProvider>
  );
}
