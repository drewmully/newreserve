/** Fresh Klaviyo email-consent read for the lifecycle dispatcher. Read-only. */
import { klaviyoRequest } from "@/lib/klaviyo/client";

type ProfileList = { data?: Array<{ attributes?: { subscriptions?: { email?: { marketing?: {
  consent?: string; can_receive_email_marketing?: boolean; suppression?: unknown[] } } } } }> };

/** Explicit SUBSCRIBED + can-receive + no suppression. Anything else holds. */
export async function readKlaviyoConsent(email: string) {
  const internal = /@mullybox\.com$/i.test(email) || /\+synctest/i.test(email);
  const filter = encodeURIComponent(`equals(email,${JSON.stringify(email)})`);
  const res = await klaviyoRequest<ProfileList>(`/api/profiles/?filter=${filter}&additional-fields[profile]=subscriptions`, { method: "GET" });
  const profiles = res.body?.data ?? [];
  if (profiles.length !== 1) return { subscribed: false, marketable: false, internal: true };
  const m = profiles[0].attributes?.subscriptions?.email?.marketing;
  return {
    subscribed: m?.consent === "SUBSCRIBED",
    marketable: m?.can_receive_email_marketing === true && Array.isArray(m?.suppression) && m.suppression.length === 0,
    internal,
  };
}
