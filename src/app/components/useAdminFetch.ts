"use client";

/**
 * useAdminFetch — returns a fetch helper that attaches the current user's
 * Firebase ID token as a Bearer Authorization header. Use for all calls
 * to /api/admin/* routes.
 */

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";

export function useAdminFetch() {
  const [tokenReady, setTokenReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setTokenReady(!!u));
    return unsub;
  }, []);

  const adminFetch = useCallback(async (path: string, init: RequestInit = {}) => {
    const user = auth.currentUser;
    if (!user) throw new Error("not signed in");
    const token = await user.getIdToken();
    const headers = new Headers(init.headers || {});
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !headers.has("content-type")) {
      headers.set("Content-Type", "application/json");
    }
    return fetch(path, { ...init, headers });
  }, []);

  return { adminFetch, tokenReady };
}
