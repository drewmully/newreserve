/** Fresh Klaviyo email-consent read for the lifecycle dispatcher. Read-only. */
import { klaviyoRequest } from "@/lib/klaviyo/client";

type ProfileList = { data?: Array<{ attributes?: { subscriptions?: { email?: { marketing?: {
  consent?: string; can_receive_email_marketing?: boolean; suppression?: unknown[] } } } } }> };

export interface KlaviyoConsent {
  /** Explicit SUBSCRIBED. Required for every marketing program. */
  subscribed: boolean;
  /** Klaviyo can deliver and nothing suppresses the address. */
  marketable: boolean;
  internal: boolean;
  /**
   * Never unsubscribed, deliverable and unsuppressed. Enough for checkout
   * recovery only: the shopper typed this email into checkout themselves.
   */
  contactable: boolean;
}

/**
 * Explicit SUBSCRIBED + can-receive + no suppression for marketing.
 * `contactable` also admits NEVER_SUBSCRIBED (checkout recovery only).
 * Anything unreadable or ambiguous holds.
 */
export async function readKlaviyoConsent(email: string): Promise<KlaviyoConsent> {
  const internal = /@mullybox\.com$/i.test(email) || /\+synctest/i.test(email);
  const filter = encodeURIComponent(`equals(email,${JSON.stringify(email)})`);
  const res = await klaviyoRequest<ProfileList>(`/api/profiles/?filter=${filter}&additional-fields[profile]=subscriptions`, { method: "GET" });
  const profiles = res.body?.data ?? [];
  if (profiles.length !== 1) return { subscribed: false, marketable: false, internal: true, contactable: false };
  const m = profiles[0].attributes?.subscriptions?.email?.marketing;
  const marketable = m?.can_receive_email_marketing === true && Array.isArray(m?.suppression) && m.suppression.length === 0;
  return {
    subscribed: m?.consent === "SUBSCRIBED",
    marketable,
    internal,
    contactable: marketable && (m?.consent === "SUBSCRIBED" || m?.consent === "NEVER_SUBSCRIBED"),
  };
}
