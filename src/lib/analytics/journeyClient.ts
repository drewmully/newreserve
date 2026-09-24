/** Auxiliary same-origin handoff; never changes checkout outcome or URLs. */
async function existingFirebaseToken(): Promise<string | undefined> {
  // Reuse an already initialized app. Analytics must not initialize Firebase,
  // sign a shopper in, or turn authentication into a permission grant.
  const { getApps } = await import("firebase/app");
  const app = getApps().find(app => app.name === "[DEFAULT]");
  if (!app) return undefined;
  const { getAuth } = await import("firebase/auth");
  return getAuth(app).currentUser?.getIdToken();
}
export async function recordJourneyCart(cartId: unknown, firebaseIdToken?: string): Promise<void> {
  if (process.env.NEXT_PUBLIC_LEAN_ANALYTICS_JOURNEYS_ENABLED !== "true" ||
      typeof window === "undefined" || typeof cartId !== "string") return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const token = firebaseIdToken ?? await Promise.race([
      existingFirebaseToken(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("journey_auth_timeout")), 1000); }),
    ]);
    clearTimeout(timer);
    await fetch("/api/analytics/journey/cart", { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ cartId }),
      signal: AbortSignal.timeout(2000) });
  } catch { /* Tracking failure must not fail a purchase; delays are bounded. */ }
  finally { clearTimeout(timer); }
}
