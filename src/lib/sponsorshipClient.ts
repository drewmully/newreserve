"use client";

/**
 * Client-side cache + prefetch for /api/account/sponsorship.
 *
 * Solves the "tab takes a while to load" jank: the dashboard parent calls
 * usePrefetchSponsorship() once on mount, which kicks off the fetch in the
 * background. By the time the user clicks into the Sponsorships tab, the
 * data is already sitting in memory.
 *
 * Cache is module-scope, lives for the lifetime of the page (single session),
 * and invalidates after 60 seconds so refreshes still get fresh data.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";

export interface SponsorshipBoard {
  code: string;
  link: string;
  progress: {
    total: number;
    yearCount: number;
    last30: number;
    firstSponsorshipAt: string | null;
    lastSponsorshipAt: string | null;
  };
  badges: Array<{
    key: "first_dozen" | "foursome" | "path_to_black" | "the_18";
    title: string;
    shortTitle: string;
    tagline: string;
    description: string;
    window: string;
    reward: string;
    threshold: number;
    current: number;
    progress: number;
    earned: boolean;
    earnedCount: number;
  }>;
  history: Array<{
    id: number;
    sponsoredEmail: string;
    attributedAt: string;
    orderTotal: number;
    tier: string | null;
  }>;
}

interface CacheEntry {
  uid: string;
  fetchedAt: number;
  data: SponsorshipBoard | null;
  error: string | null;
  inflight: Promise<SponsorshipBoard | null> | null;
}

const TTL_MS = 60_000;
const CACHE: { current: CacheEntry | null } = { current: null };

function isFresh(entry: CacheEntry, uid: string): boolean {
  return entry.uid === uid && Date.now() - entry.fetchedAt < TTL_MS;
}

async function doFetch(user: User): Promise<SponsorshipBoard | null> {
  const token = await user.getIdToken();
  const res = await fetch("/api/account/sponsorship", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as SponsorshipBoard;
}

function fetchAndCache(user: User): Promise<SponsorshipBoard | null> {
  const existing = CACHE.current;
  if (existing && existing.uid === user.uid && existing.inflight) {
    return existing.inflight;
  }
  if (existing && isFresh(existing, user.uid) && existing.data) {
    return Promise.resolve(existing.data);
  }

  const promise = doFetch(user)
    .then((data) => {
      CACHE.current = {
        uid: user.uid,
        fetchedAt: Date.now(),
        data,
        error: null,
        inflight: null,
      };
      return data;
    })
    .catch((err: unknown) => {
      CACHE.current = {
        uid: user.uid,
        fetchedAt: Date.now(),
        data: null,
        error: err instanceof Error ? err.message : "Could not load sponsorships.",
        inflight: null,
      };
      throw err;
    });

  CACHE.current = {
    uid: user.uid,
    fetchedAt: Date.now(),
    data: existing && existing.uid === user.uid ? existing.data : null,
    error: null,
    inflight: promise,
  };

  return promise;
}

/**
 * Fire-and-forget warmer. Called from the dashboard shell so the tab feels
 * instant. Safe to call repeatedly; deduped via the inflight promise.
 */
export function prefetchSponsorshipBoard(user: User | null | undefined): void {
  if (!user) return;
  void fetchAndCache(user).catch(() => {
    /* errors are surfaced on the actual tab via useSponsorshipBoard */
  });
}

/**
 * Hook for the tab. Returns the cached board if present, otherwise fetches.
 */
export function useSponsorshipBoard(user: User | null | undefined): {
  data: SponsorshipBoard | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  // Read cache synchronously for initial state so a warm cache hit renders
  // immediately with no flash, no extra effect-driven setState.
  const initialEntry =
    CACHE.current && user && CACHE.current.uid === user.uid ? CACHE.current : null;
  const hasFreshCache =
    !!(initialEntry && isFresh(initialEntry, user!.uid) && initialEntry.data);

  const [data, setData] = useState<SponsorshipBoard | null>(
    hasFreshCache ? initialEntry!.data : null,
  );
  const [error, setError] = useState<string | null>(
    hasFreshCache ? null : initialEntry?.error ?? null,
  );
  const [loading, setLoading] = useState<boolean>(!hasFreshCache && !!user);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Background fetch runs only when we don't already have fresh cached data.
  // No synchronous setState in this effect.
  useEffect(() => {
    if (!user) return;
    const cached = CACHE.current;
    if (cached && isFresh(cached, user.uid) && cached.data) return;

    fetchAndCache(user)
      .then((board) => {
        if (!mountedRef.current) return;
        setData(board);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : "Could not load sponsorships.");
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, [user]);

  const reload = useCallback(() => {
    if (!user) return;
    if (CACHE.current && CACHE.current.uid === user.uid) {
      CACHE.current = { ...CACHE.current, fetchedAt: 0, inflight: null };
    }
    setLoading(true);
    setError(null);
    fetchAndCache(user)
      .then((board) => {
        if (!mountedRef.current) return;
        setData(board);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : "Could not load sponsorships.");
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, [user]);

  return { data, loading, error, reload };
}
