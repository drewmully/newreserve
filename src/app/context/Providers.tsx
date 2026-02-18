"use client";

import { MembershipProvider } from "./MembershipContext";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return <MembershipProvider>{children}</MembershipProvider>;
}
