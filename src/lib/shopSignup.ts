export const SHOP_INTERESTS = [
  { id: "tops", label: "Polos & shirts", note: "A good place to start." },
  { id: "layers", label: "Layers & outerwear", note: "For the cooler rounds." },
  { id: "bottoms", label: "Pants & shorts", note: "The rest falls into place." },
  { id: "everything", label: "The full edit", note: "Keep the good finds coming." },
] as const;
export const SHOP_CONSENT_VERSION = "shop-edit-2026-09-30";
export const EMAIL_CONSENT = "I agree to receive marketing emails from Mully. Unsubscribe anytime.";
export const SMS_CONSENT = "I agree to receive recurring automated marketing texts from Mully Group, Inc. at the number provided. Up to 4 messages/month. Consent is not a condition of purchase. Message and data rates may apply. Reply STOP to cancel, HELP for help.";
/** Footer newsletter consent copy (shown in ShopNewsletter, stored as evidence). */
export const SHOP_NEWSLETTER_CONSENT = "I’d like emails from Mully. Unsubscribe anytime.";
/** Optional, unticked checkbox on the /lp/editorial "Never miss a drop" bar. */
export const DROP_BAR_CONSENT = "Email me new drops and offers. Unsubscribe anytime.";
export function normalizeSignupPhone(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 35) return null;
  const digits = raw.replace(/[\s().-]/g, "");
  const normalized = /^\d{10}$/.test(digits) ? `+1${digits}` : /^1\d{10}$/.test(digits) ? `+${digits}` : digits;
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}
