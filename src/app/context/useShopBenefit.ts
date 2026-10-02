"use client";
import { useEffect, useState } from "react";
import type { User } from "firebase/auth";

export function useShopBenefit(user: User | null, subscriptionRevision: unknown) {
  const [state, setState] = useState<{ uid: string; eligible: boolean } | null>(null);
  useEffect(() => {
    let stopped = false;
    let generation = 0;
    const refresh = async () => {
      const current = ++generation;
      if (!user) { setState(null); return; }
      // Rechecking after a cancellation must not retain a stale entitlement.
      setState(null);
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/shop/member-benefit", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const data = await response.json();
        if (!stopped && current === generation) setState({ uid: user.uid, eligible: response.ok && data.eligible === true });
      } catch { if (!stopped && current === generation) setState(null); }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => { stopped = true; window.removeEventListener("focus", refresh); };
  }, [user, subscriptionRevision]);
  return Boolean(user && state?.uid === user.uid && state.eligible);
}
