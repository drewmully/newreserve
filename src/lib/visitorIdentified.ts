/**
 * Browser signal fired after a consented signup succeeds and the server has
 * set the `mully_kid` identity cookie. MembershipContext listens and, if the
 * bag already has items, replays it once to Klaviyo (`cart_identified`),
 * because the earlier add_to_cart was anonymous. Client-safe; no I/O.
 */
export const VISITOR_IDENTIFIED_EVENT = "mully:visitor-identified";

export function signalVisitorIdentified(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(VISITOR_IDENTIFIED_EVENT));
  } catch {
    // Never let tracking break a signup.
  }
}
