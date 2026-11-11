"use client";

/**
 * Sticky `pdp_complete_look` arm for this browser.
 *
 * Evaluated once, on the first shop PDP or cart view, against the Mully
 * anonymous_id, then kept in localStorage so the PDP, the cart, every
 * analytics event and the cart attributes agree. Until the flag is rolled
 * out the API answers null and the shopper keeps the current experience.
 *
 * QA: ?pdp_complete_look=test|control forces an arm where the API allows it
 * (non-production, or a flag payload with allow_overrides); =off clears it.
 */

import { useEffect, useSyncExternalStore } from "react";
import posthog from "posthog-js";
import { getClientAnonymousId } from "@/lib/tracking";
import { readShopReward } from "@/lib/shopRewards";
import {
  PDP_COMPLETE_LOOK_PROPERTY,
  PDP_COMPLETE_LOOK_QUERY,
  PDP_COMPLETE_LOOK_STORAGE_KEY,
  parseCompleteLookVariant,
  readStoredCompleteLookVariant,
  type CompleteLookVariant,
} from "@/lib/pdpCompleteLook";

const NULL_CHECK_KEY = `${PDP_COMPLETE_LOOK_STORAGE_KEY}_checked`;
const EVENT = "mully:pdp-complete-look";

let pending: Promise<CompleteLookVariant | null> | null = null;

export { readStoredCompleteLookVariant };

function store(variant: CompleteLookVariant | null) {
  try {
    if (variant) localStorage.setItem(PDP_COMPLETE_LOOK_STORAGE_KEY, variant);
    else localStorage.removeItem(PDP_COMPLETE_LOOK_STORAGE_KEY);
  } catch { /* optional storage */ }
  register(variant);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT, { detail: variant }));
}

function register(variant: CompleteLookVariant | null) {
  try {
    if (!posthog.__loaded) return;
    if (variant) posthog.register({ [PDP_COMPLETE_LOOK_PROPERTY]: variant });
    else posthog.unregister(PDP_COMPLETE_LOOK_PROPERTY);
  } catch { /* analytics never blocks the page */ }
}

/** Resolve (once per page load) and persist the arm. */
export function resolveCompleteLookVariant(): Promise<CompleteLookVariant | null> {
  if (pending) return pending;
  const query = new URLSearchParams(window.location.search).get(PDP_COMPLETE_LOOK_QUERY);
  if (query === "off") {
    store(null);
    pending = Promise.resolve(null);
    return pending;
  }
  const override = parseCompleteLookVariant(query);
  const stored = readStoredCompleteLookVariant();
  if (stored && (!override || override === stored)) {
    register(stored);
    pending = Promise.resolve(stored);
    return pending;
  }
  // Inactive flag: ask again next session, not on every page view.
  try {
    if (!override && sessionStorage.getItem(NULL_CHECK_KEY)) {
      pending = Promise.resolve(null);
      return pending;
    }
  } catch { /* optional storage */ }
  pending = fetch("/api/experiments/pdp-complete-look", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ anonymous_id: getClientAnonymousId(), override }),
  })
    .then((r) => (r.ok ? r.json() : { variant: null }))
    .then((j: { variant?: unknown }) => {
      const variant = parseCompleteLookVariant(j.variant);
      if (variant) store(variant);
      else {
        try { sessionStorage.setItem(NULL_CHECK_KEY, "1"); } catch { /* optional storage */ }
      }
      return variant;
    })
    .catch(() => null);
  return pending;
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * @param active   evaluate now (shop PDP mounted, or cart opened)
 * @param initial  server-forced arm for QA renders (non-production only)
 */
export function useCompleteLookVariant(active: boolean, initial: CompleteLookVariant | null = null) {
  // Server and hydration render use `initial`; the browser then reads the
  // sticky arm from storage and follows later assignments.
  const stored = useSyncExternalStore(subscribe, readStoredCompleteLookVariant, () => null);

  useEffect(() => {
    if (!active) return;
    void resolveCompleteLookVariant();
  }, [active]);

  return stored ?? initial;
}

/** True when a Mully shop reward is saved in this browser (client only). */
export function useHasShopReward(): boolean {
  return useSyncExternalStore(subscribe, () => Boolean(readShopReward()), () => false);
}
