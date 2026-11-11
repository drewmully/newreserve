/**
 * Gift a Season plain-text emails (no reveal model). Copy rules: no em
 * dashes or double dashes, say "Reserve" never "box", keep it short.
 *
 *   - Gifter confirmation (orders-paid)
 *   - Address request to the recipient (ship-to-me, 14 days after season 1 ships)
 *   - Address request to the purchaser (no recipient email, or 7-day fallback)
 *   - Purchaser reminder 14 days before season 2 when the address is missing
 *   - Season notice before each season 2..N with the update link
 *
 * Every send is gated in the caller behind an env flag that defaults off.
 */

import type { GiftShipMode } from "@/lib/gifts/giftSeason";
import { GIFT_SEASON_SHIP_WINDOW } from "@/lib/gifts/giftSeasonConfig";

const SIGN_OFF = "Drew, Founder, Mully";

function seasonsPhrase(n: number): string {
  return n === 1 ? "a season" : `${n} seasons`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "March 2027" for a YYYY-MM-DD or ms timestamp (UTC). */
export function monthYear(d: string | number): string {
  const date = typeof d === "number" ? new Date(d) : new Date(`${d}T00:00:00Z`);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "March 4" for a YYYY-MM-DD (UTC). */
export function monthDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** Season schedule lines estimated from the purchase date. */
export function seasonScheduleLines(seasons: number, fromMs: number): string[] {
  const lines = ["Season 1: ships now"];
  for (let k = 2; k <= seasons; k++) {
    const d = new Date(fromMs);
    d.setUTCMonth(d.getUTCMonth() + 3 * (k - 1));
    lines.push(`Season ${k}: around ${monthYear(d.getTime())}`);
  }
  return lines;
}

// ── Gifter confirmation ─────────────────────────────────────────────────────

export interface GifterConfirmationArgs {
  purchaserFirstName: string | null;
  recipientFirstName: string | null;
  seasonsTotal: number;
  shipMode: GiftShipMode;
  /** One-line shipping address of season 1, or "" if unknown. */
  shipToLine: string;
  hasRecipientEmail: boolean;
  purchasedAt: number;
  updateUrl: string;
  /** Optional printable card (ship-to-me). */
  giftCardUrl?: string | null;
}

export function buildGifterConfirmationSubject(): string {
  return "Your gift is on its way";
}

export function buildGifterConfirmationText(a: GifterConfirmationArgs): string {
  const name = a.purchaserFirstName?.trim() || "there";
  const recipient = a.recipientFirstName?.trim() || "They";
  const multi = a.seasonsTotal > 1;
  const shipTo =
    a.shipMode === "to_purchaser"
      ? a.shipToLine
        ? `Season 1 ships to you in ${GIFT_SEASON_SHIP_WINDOW}, so you can give it to them:`
        : `Season 1 ships to you in ${GIFT_SEASON_SHIP_WINDOW}, so you can give it to them.`
      : a.shipToLine
        ? `Season 1 ships in ${GIFT_SEASON_SHIP_WINDOW} to:`
        : `Season 1 ships in ${GIFT_SEASON_SHIP_WINDOW} to the address you entered at checkout.`;
  const out = [
    `Hi ${name},`,
    "",
    "Your gift is on its way.",
    "",
    `${recipient} gets ${seasonsPhrase(a.seasonsTotal)} of Mully Reserve, hand-picked by a Mully stylist.`,
    "",
    shipTo,
    ...(a.shipToLine ? [a.shipToLine] : []),
  ];
  if (multi) {
    out.push("", "Then one Reserve every 3 months:", ...seasonScheduleLines(a.seasonsTotal, a.purchasedAt));
    if (a.shipMode === "to_purchaser") {
      out.push(
        "",
        a.hasRecipientEmail
          ? "After they open it, we'll email them to collect their address for the next seasons."
          : "After they open it, we'll email you to collect their address for the next seasons."
      );
    } else {
      out.push("", "The next seasons ship to the same address.");
    }
    out.push("Sizes or address changed? Update them any time:", a.updateUrl);
  }
  if (a.giftCardUrl) {
    out.push("", "Want a card to hand over with it? Print one here:", a.giftCardUrl);
  }
  out.push("", "Paid once. It never renews.", "", "Questions? Just reply to this email.", "", SIGN_OFF);
  return out.join("\n");
}

// ── Address request / reminder ──────────────────────────────────────────────

export interface AddressEmailArgs {
  recipientFirstName: string | null;
  purchaserFirstName: string | null;
  seasonsTotal: number;
  /** Season 2 due date, YYYY-MM-DD. */
  nextDueOn: string | null;
  addressUrl: string;
}

export function buildAddressRequestRecipientSubject(): string {
  return "Where should your next Reserve ship?";
}

export function buildAddressRequestRecipientText(a: AddressEmailArgs): string {
  const recipient = a.recipientFirstName?.trim() || "there";
  const from = a.purchaserFirstName?.trim();
  const remaining = a.seasonsTotal - 1;
  return [
    `Hey ${recipient},`,
    "",
    from
      ? `Hope you're enjoying your first Mully Reserve from ${from}.`
      : "Hope you're enjoying your first Mully Reserve.",
    remaining === 1
      ? "One more season is on the way."
      : `${remaining} more seasons are on the way, one every 3 months.`,
    "",
    "Tell us where to send them and check your sizes. It takes a minute:",
    a.addressUrl,
    ...(a.nextDueOn ? ["", `Your next Reserve ships around ${monthDay(a.nextDueOn)}.`] : []),
    "",
    SIGN_OFF,
  ].join("\n");
}

export function buildAddressRequestPurchaserSubject(a: Pick<AddressEmailArgs, "recipientFirstName">): string {
  const r = a.recipientFirstName?.trim();
  return r ? `Where should ${r}'s next Reserve ship?` : "Where should the next Reserve ship?";
}

export function buildAddressRequestPurchaserText(a: AddressEmailArgs & { fallback: boolean }): string {
  const name = a.purchaserFirstName?.trim() || "there";
  const r = a.recipientFirstName?.trim();
  const theirs = r ? `${r}'s` : "their";
  return [
    `Hi ${name},`,
    "",
    a.fallback && r ? `We haven't heard back from ${r} yet.` : null,
    a.nextDueOn
      ? `${r ? `${r}'s` : "The"} next Reserve ships around ${monthDay(a.nextDueOn)}, and we need ${theirs} address to send it.`
      : `We need ${theirs} address to send the next Reserve.`,
    "",
    "Add it here, or forward this link to them:",
    a.addressUrl,
    "",
    SIGN_OFF,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

export function buildAddressReminderSubject(a: Pick<AddressEmailArgs, "recipientFirstName">): string {
  const r = a.recipientFirstName?.trim();
  return r ? `Address needed for ${r}'s next Reserve` : "Address needed for the next Reserve";
}

export function buildAddressReminderText(a: AddressEmailArgs): string {
  const name = a.purchaserFirstName?.trim() || "there";
  const r = a.recipientFirstName?.trim() || "them";
  return [
    `Hi ${name},`,
    "",
    a.nextDueOn
      ? `Season 2 ships around ${monthDay(a.nextDueOn)}, and we still need an address for ${r}.`
      : `We still need an address for ${r}.`,
    "We'll hold it until we have one. Add it here, or forward this link to them:",
    a.addressUrl,
    "",
    SIGN_OFF,
  ].join("\n");
}

// ── Season notice (before each season 2..N) ────────────────────────────────

export interface SeasonNoticeArgs {
  recipientFirstName: string | null;
  seasonNumber: number;
  seasonsTotal: number;
  dueOn: string;
  shipToLine: string;
  updateUrl: string;
  /** Optional sizes still blank (display labels), prompted for in the email. */
  missingSizes?: string[];
}

export function buildSeasonNoticeSubject(a: Pick<SeasonNoticeArgs, "seasonNumber">): string {
  return `Season ${a.seasonNumber} of your Mully Reserve ships soon`;
}

export function buildSeasonNoticeText(a: SeasonNoticeArgs): string {
  const recipient = a.recipientFirstName?.trim() || "there";
  return [
    `Hey ${recipient},`,
    "",
    `Season ${a.seasonNumber} of ${a.seasonsTotal} ships around ${monthDay(a.dueOn)}${a.shipToLine ? " to:" : "."}`,
    ...(a.shipToLine ? [a.shipToLine] : []),
    "",
    ...(a.missingSizes?.length
      ? [`A few sizes are still blank (${a.missingSizes.join(", ").toLowerCase()}). Add any you know, or update your address, here before it ships:`]
      : ["Moved or sizes changed? Update them here before it ships:"]),
    a.updateUrl,
    "",
    SIGN_OFF,
  ].join("\n");
}
