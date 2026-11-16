/**
 * Browser helper: identity to attach to a membership cart when the shopper
 * is signed in. Never throws and never blocks checkout for long — on any
 * failure it returns whatever it safely can (possibly nothing), which is the
 * previous behaviour.
 */
import { CHECKOUT_UID_ATTRIBUTE } from "./checkoutIdentityConstants";

export interface CheckoutIdentity {
  /** Lowercased account email for cart buyerIdentity, or null. */
  email: string | null;
  /** `_mully_uid_token` cart attribute when the server could sign one. */
  attributes: Array<{ key: string; value: string }>;
}

const NONE: CheckoutIdentity = { email: null, attributes: [] };

function normalize(email: string | null | undefined): string | null {
  const v = typeof email === "string" ? email.trim().toLowerCase() : "";
  return v || null;
}

export async function getSignedInCheckoutIdentity(timeoutMs = 4000): Promise<CheckoutIdentity> {
  if (typeof window === "undefined") return NONE;
  let fallbackEmail: string | null = null;
  try {
    const { auth } = await import("./firebase");
    const user = auth?.currentUser;
    if (!user) return NONE;
    fallbackEmail = normalize(user.email);
    const idToken = await user.getIdToken();
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetch("/api/checkout/identity", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
        cache: "no-store",
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!res.ok) return { email: fallbackEmail, attributes: [] };
      const data = (await res.json()) as { email?: string | null; uidToken?: string | null };
      return {
        email: normalize(data.email) ?? fallbackEmail,
        attributes:
          typeof data.uidToken === "string" && data.uidToken
            ? [{ key: CHECKOUT_UID_ATTRIBUTE, value: data.uidToken }]
            : [],
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (err) {
    console.warn("[checkoutIdentity] continuing without signed identity:", err);
    return { email: fallbackEmail, attributes: [] };
  }
}
