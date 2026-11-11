export const SHOP_INTERESTS = [
  { id: "tops", label: "Polos & shirts", note: "A good place to start." },
  { id: "layers", label: "Layers & outerwear", note: "For the cooler rounds." },
  { id: "bottoms", label: "Pants & shorts", note: "The rest falls into place." },
  { id: "everything", label: "The full edit", note: "Keep the good finds coming." },
] as const;
/**
 * Extra capture sources that reuse /api/shop/signup (email stage only). Each
 * one names the only interest it may send. The default source, the shop edit
 * popup, keeps using SHOP_INTERESTS.
 */
export const SHOP_SIGNUP_SOURCES = {
  "gift-reminders": { interest: "gifts" },
} as const;
export type ShopSignupSource = "shop-edit-popup" | keyof typeof SHOP_SIGNUP_SOURCES;
export function shopSignupSource(raw: unknown): ShopSignupSource {
  return typeof raw === "string" && Object.prototype.hasOwnProperty.call(SHOP_SIGNUP_SOURCES, raw) ? (raw as ShopSignupSource) : "shop-edit-popup";
}
export const SHOP_CONSENT_VERSION = "shop-edit-2026-09-30";
export const EMAIL_CONSENT = "I agree to receive marketing emails from Mully. Unsubscribe anytime.";
export const SMS_CONSENT = "I agree to receive recurring automated marketing texts from Mully Group, Inc. at the number provided. Up to 4 messages/month. Consent is not a condition of purchase. Message and data rates may apply. Reply STOP to cancel, HELP for help.";
/** Footer newsletter consent copy (shown in ShopNewsletter, stored as evidence). */
export const SHOP_NEWSLETTER_CONSENT = "I’d like emails from Mully. Unsubscribe anytime.";
/**
 * /join newsletter page (forwarded editorial emails). `?source=` may pick one
 * of these; anything else falls back to "forwarded". Each value is sent to
 * Klaviyo as the signup `source`, so each must be in F1's trigger filter.
 */
export const JOIN_SOURCES = ["forwarded", "share", "qr"] as const;
export type JoinSource = (typeof JOIN_SOURCES)[number];
export function isJoinSource(raw: unknown): raw is JoinSource {
  return typeof raw === "string" && (JOIN_SOURCES as readonly string[]).includes(raw);
}
export function joinSource(raw: unknown): JoinSource {
  return isJoinSource(raw) ? raw : "forwarded";
}
export const JOIN_CONSENT_VERSION = "join-2026-11";
export const JOIN_LANDING_PATH = "/join";
/** Optional, unticked checkbox on the /lp/editorial "Never miss a drop" bar. */
export const DROP_BAR_CONSENT = "Email me new drops and offers. Unsubscribe anytime.";
export function normalizeSignupPhone(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 35) return null;
  const digits = raw.replace(/[\s().-]/g, "");
  const normalized = /^\d{10}$/.test(digits) ? `+1${digits}` : /^1\d{10}$/.test(digits) ? `+${digits}` : digits;
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}
