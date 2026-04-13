"use client";

import { useEffect } from "react";
import Intercom, { shutdown as intercomShutdown } from "@intercom/messenger-js-sdk";
import { useMembership } from "../context/MembershipContext";

const APP_ID = process.env.NEXT_PUBLIC_INTERCOM_APP_ID ?? "";

export function IntercomWidget() {
  const { isSignedIn, authLoading, user, email, username, tier } = useMembership();

  useEffect(() => {
    if (!APP_ID || authLoading) return;

    if (isSignedIn && user) {
      Intercom({
        app_id: APP_ID,
        user_id: user.uid,
        email: email || undefined,
        name: username || undefined,
        membership_tier: tier,
      });
    } else {
      // Shut down the messenger for logged-out users
      intercomShutdown();
    }
  }, [isSignedIn, authLoading, user, email, username, tier]);

  return null;
}
