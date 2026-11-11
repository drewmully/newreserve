/**
 * Mully Gift Card (/shop/gift-card). A native Shopify gift card product, so
 * Shopify issues the code and sends the email once the order is paid.
 *
 * Recipient details ride on the cart line as the line item properties
 * Shopify's gift card fulfillment reads:
 * https://shopify.dev/docs/storefronts/themes/product-merchandising/gift-cards
 * Without them, Shopify emails the card to the buyer. "Send on" schedules the
 * email up to 90 days out; without it the email goes as soon as the order is paid.
 * The non-underscore properties show on the Shopify checkout under the line
 * (checked on checkout.mymully.com, Nov 11 2026).
 *
 * Prices are never hard-coded: denominations are the product's live variants.
 */

export const GIFT_CARD_HANDLE = "mully-gift-card";
export const GIFT_CARD_PATH = "/shop/gift-card";
export const GIFT_CARD_MESSAGE_MAX = 200;
/** Shopify allows up to 90 days; 89 keeps a day of margin across timezones. */
export const GIFT_CARD_SEND_MAX_DAYS = 89;
export const GIFT_CARD_NAME_MAX = 255;

export const GIFT_CARD_PROPS = {
  email: "Recipient email",
  name: "Recipient name",
  message: "Message",
  sendOn: "Send on",
  toRecipient: "__shopify_send_gift_card_to_recipient",
  offset: "__shopify_offset",
} as const;

export interface GiftCardForm {
  /** "them": Shopify emails the recipient. "me": Shopify emails the buyer. */
  sendTo: "them" | "me";
  recipientEmail?: string;
  recipientName?: string;
  message?: string;
  /** yyyy-mm-dd, optional. */
  sendOn?: string;
}

export type GiftCardFieldError = Partial<Record<"recipientEmail" | "message" | "sendOn", string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** yyyy-mm-dd for a local date. */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Earliest and latest "Send on" dates Shopify accepts, as yyyy-mm-dd. */
export function sendOnRange(today: Date = new Date()): { min: string; max: string } {
  const max = new Date(today);
  max.setDate(max.getDate() + GIFT_CARD_SEND_MAX_DAYS);
  return { min: isoDay(today), max: isoDay(max) };
}

export function validateGiftCardForm(form: GiftCardForm, today: Date = new Date()): GiftCardFieldError {
  const errors: GiftCardFieldError = {};
  if (form.sendTo !== "them") return errors;
  const email = form.recipientEmail?.trim() ?? "";
  if (!EMAIL.test(email)) errors.recipientEmail = "Enter his email address.";
  if ((form.message ?? "").length > GIFT_CARD_MESSAGE_MAX) {
    errors.message = `Keep the note to ${GIFT_CARD_MESSAGE_MAX} characters.`;
  }
  const sendOn = form.sendOn?.trim();
  if (sendOn) {
    const { min, max } = sendOnRange(today);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sendOn) || sendOn < min || sendOn > max) {
      errors.sendOn = `Pick a date between today and ${GIFT_CARD_SEND_MAX_DAYS} days from now.`;
    }
  }
  return errors;
}

/** Cart line attributes for the gift card line. Empty when sending to the buyer. */
export function giftCardLineAttributes(form: GiftCardForm, today: Date = new Date()): Array<{ key: string; value: string }> {
  if (form.sendTo !== "them") return [];
  const attrs: Array<{ key: string; value: string }> = [
    { key: GIFT_CARD_PROPS.email, value: form.recipientEmail!.trim() },
  ];
  const name = form.recipientName?.trim();
  if (name) attrs.push({ key: GIFT_CARD_PROPS.name, value: name.slice(0, GIFT_CARD_NAME_MAX) });
  const message = form.message?.trim();
  if (message) attrs.push({ key: GIFT_CARD_PROPS.message, value: message.slice(0, GIFT_CARD_MESSAGE_MAX) });
  const sendOn = form.sendOn?.trim();
  // Today is the same as "now"; only a future date is a schedule.
  if (sendOn && sendOn > sendOnRange(today).min) attrs.push({ key: GIFT_CARD_PROPS.sendOn, value: sendOn });
  attrs.push({ key: GIFT_CARD_PROPS.toRecipient, value: "true" });
  // Buyer's timezone offset in minutes, so "Send on" means his local day, not the shop's.
  attrs.push({ key: GIFT_CARD_PROPS.offset, value: String(today.getTimezoneOffset()) });
  return attrs;
}

/**
 * The first Shopify userErrors message from a cart mutation error
 * ("cartCreate failed: [{field, message}]"), or undefined.
 */
export function shopifyCartErrorMessage(err: unknown): string | undefined {
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const start = text.indexOf("[");
  if (start < 0) return undefined;
  try {
    const list = JSON.parse(text.slice(start)) as Array<{ message?: unknown }>;
    const msg = list.find((e) => typeof e?.message === "string" && e.message.trim())?.message as string | undefined;
    return msg?.trim();
  } catch {
    return undefined;
  }
}

/** "$50" from 50, "$49.50" from 49.5. Display only; the price itself comes from Shopify. */
export function giftCardAmountLabel(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Shown on /shop/gift-card and in its FAQPage JSON-LD. */
export const GIFT_CARD_FAQS = [
  {
    q: "How does the gift card arrive?",
    a: "By email. Most gift cards arrive by email within minutes. If you send it to him, he gets the email with your note. If you send it to yourself, it comes to the email you use at checkout, so you can print it or forward it.",
  },
  {
    q: "Can I schedule it?",
    a: "Yes. Pick a send date, like Christmas morning, up to 89 days out. Leave the date blank and it sends as soon as your order goes through.",
  },
  {
    q: "Didn't get it?",
    a: "Check spam, then reach out and we'll resend it.",
  },
  {
    q: "What can he use it on?",
    a: "Any piece in the Mully shop. He enters the code at checkout, and any balance stays on the card for next time.",
  },
];
