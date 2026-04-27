"use client";

import { useMembership } from "@/app/context/MembershipContext";
import { Back9WelcomeModal } from "./Back9WelcomeModal";

export function Back9WelcomeOverlay() {
  const {
    authLoading,
    isLegacy,
    back9WelcomeSeen,
    back9UX,
    username,
    markBack9WelcomeSeen,
  } = useMembership();

  if (authLoading || !isLegacy || back9WelcomeSeen || back9UX === "landing") {
    return null;
  }

  return (
    <Back9WelcomeModal username={username} onClose={markBack9WelcomeSeen} />
  );
}
