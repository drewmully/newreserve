"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { customerContractForUi } from "@/lib/shopifyCustomerContracts";

export type ShopifySubscription = ReturnType<typeof customerContractForUi>;
export interface ShopifySubscriptionState {
  contracts: ShopifySubscription[];
  state: "loading" | "ready" | "connection_required" | "error";
  stale: boolean;
}
const EMPTY: ShopifySubscriptionState = { contracts: [], state: "loading", stale: false };

/** Live contracts are separate from both the paid-order receipt and Loop entitlements. */
export function useShopifySubscriptions(user: User | null, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<ShopifySubscriptionState & { uid: string }>({ ...EMPTY, uid: "" });
  const sequence = useRef(0);
  const invalidate = useCallback(() => { sequence.current++; }, []);

  const accept = useCallback((contracts: ShopifySubscription[]) => {
    if (!user) return;
    // An older GET must not overwrite a confirmed mutation.
    sequence.current++;
    setSnapshot({ uid: user.uid, contracts, state: "ready", stale: false });
  }, [user]);

  const refresh = useCallback(async () => {
    if (!user || !enabled) return;
    const request = ++sequence.current;
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/shopify-customer/subscriptions", {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const data = await response.json();
      if (request !== sequence.current) return;
      if (!response.ok || !Array.isArray(data.subscriptions)) {
        setSnapshot(previous => ({
          uid: user.uid,
          contracts: previous.uid === user.uid ? previous.contracts : [],
          state: data.needsConnection ? "connection_required" : "error",
          stale: true,
        }));
        return;
      }
      setSnapshot({ uid: user.uid, contracts: data.subscriptions, state: "ready", stale: false });
    } catch {
      if (request !== sequence.current) return;
      setSnapshot(previous => ({
        uid: user.uid, contracts: previous.uid === user.uid ? previous.contracts : [],
        state: "error", stale: true,
      }));
    }
  }, [user, enabled]);

  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => { if (!disposed) void refresh(); });
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      invalidate();
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, invalidate]);

  return {
    // Never briefly render another customer's contract during an auth change.
    shopifySubscriptions: user && enabled && snapshot.uid === user.uid ? snapshot : EMPTY,
    refreshShopifySubscriptions: refresh,
    acceptShopifySubscriptions: accept,
  };
}
