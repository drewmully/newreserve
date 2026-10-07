import posthog from "posthog-js";
import { nativeSourceSessionId } from "./journeySourceSessionContract";

async function context(): Promise<{ nativeSessionId: string; expiresAt: string } | null> {
  if (process.env.NEXT_PUBLIC_LEAN_SOURCE_SESSIONS_ENABLED !== "true" || typeof window === "undefined" || !posthog.__loaded) return null;
  const status = await fetch("/api/analytics/source-session/status", { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(1000) });
  if (!status.ok) return null;
  const state = await status.json();
  if (state.active !== true || typeof state.expiresAt !== "string" || !Number.isFinite(Date.parse(state.expiresAt)) ||
    Date.parse(state.expiresAt) <= Date.now()) return null;
  // Existing SDK implementation calls its session manager with readOnly=true.
  // Never initialize, identify, reset, capture or request a new session here.
  const nativeSessionId = posthog.get_session_id();
  return nativeSourceSessionId.test(nativeSessionId) ? { nativeSessionId, expiresAt: state.expiresAt } : null;
}
const bound = new Map<string, Promise<boolean>>();
/** Called by real navigation only, never by the Allow handler. No entry clock is sent. */
export async function recordSourceSessionNavigation(): Promise<void> {
  try {
    const c = await context(); if (!c) return;
    const key = `${c.nativeSessionId}:${c.expiresAt}`;
    if (bound.has(key)) { await bound.get(key); return; }
    // Bound memory too. This cache is not permission or source completeness.
    if (bound.size >= 100) bound.clear();
    const pending = fetch("/api/analytics/source-session/bind", { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nativeSessionId: c.nativeSessionId }),
      signal: AbortSignal.timeout(6000) }).then(r => r.status === 204).catch(() => false);
    bound.set(key, pending);
    if (!(await pending)) bound.delete(key);
  } catch { /* Auxiliary collection never blocks navigation. */ }
}
export async function recordSourceSessionCart(cartId: unknown): Promise<void> {
  try {
    if (typeof cartId !== "string") return;
    const c = await context(); if (!c) return;
    // No implicit native binding on checkout; a real navigation must precede it.
    await fetch("/api/analytics/source-session/cart", { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cartId, nativeSessionId: c.nativeSessionId }),
      signal: AbortSignal.timeout(2000) });
  } catch { /* Cart/redirect remains independent from optional reporting. */ }
}
