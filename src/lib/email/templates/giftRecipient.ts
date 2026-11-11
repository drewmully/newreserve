/**
 * Recipient-facing email for a Mully Reserve gift purchase.
 *
 * Sent from the gifting Phase 2 cron once it's time to deliver the gift
 * announcement (immediate, or scheduled via gift_deliver_on).
 */

import { monthDay } from "./giftSeasonEmails";

export interface BuildGiftRecipientEmailArgs {
  recipientFirstName: string | null;
  purchaserFirstName: string | null;
  purchaserEmail: string;
  giftMessage: string | null;
  sizingUrl: string;
}

export function buildGiftRecipientSubject(
  args: Pick<BuildGiftRecipientEmailArgs, "purchaserFirstName">
): string {
  const from = args.purchaserFirstName?.trim();
  return from
    ? `${from} sent you a Mully Reserve gift`
    : `You have a Mully Reserve gift waiting`;
}

export function buildGiftRecipientText(args: BuildGiftRecipientEmailArgs): string {
  const recipient = args.recipientFirstName?.trim() ?? "there";
  const fromName =
    args.purchaserFirstName?.trim() || args.purchaserEmail;

  const messageBlock = args.giftMessage?.trim()
    ? `\n\nA note from ${fromName}:\n"${args.giftMessage.trim()}"\n`
    : "\n";

  return [
    `Hey ${recipient},`,
    "",
    `${fromName} just gave you Mully Reserve: premium golf apparel and accessories, hand-picked by a Mully stylist every quarter. Free shipping, and exchanges are always free.`,
    messageBlock.trimEnd(),
    `Before we ship your first Reserve, confirm your sizing. It takes about 2 minutes: shirt, pant, shoe, glove and a few fit preferences.`,
    "",
    args.sizingUrl,
    "",
    `That's it. Once you submit, we style your first Reserve and it ships in 5 to 7 business days.`,
    "",
    `Questions? Just reply to this email. It goes straight to me.`,
    "",
    `Welcome to Reserve,`,
    `Drew · Founder, Mully`,
    "",
    ``,
    `Mully Reserve · Quarterly curations for golfers with taste`,
    `Your subscription will auto-cancel after your first Reserve ships, so you'll never be charged again unless you decide to stay. Manage everything at https://mymully.com/account.`,
  ].join("\n");
}

export interface BuildGiftContinueEmailArgs {
  recipientFirstName: string | null;
  purchaserFirstName: string | null;
  seasonsTotal: number;
  continueUrl: string;
  /** Multi-season: final season due date (YYYY-MM-DD), if known. */
  finalDueOn?: string | null;
}

export function buildGiftContinueSubject(args: BuildGiftContinueEmailArgs): string {
  return args.seasonsTotal > 1
    ? "Before your last gifted Reserve"
    : "Keep Mully Reserve going";
}

/** Opening line shared by the email and /gift-continue. */
export function giftContinueLead(args: {
  seasonsTotal: number;
  purchaserFirstName: string | null;
  finalDueOn?: string | null;
  /** /gift-continue only: the final season already shipped. */
  finalShipped?: boolean;
}): string {
  const from = args.purchaserFirstName?.trim() || "your gifter";
  if (args.seasonsTotal > 1) {
    if (args.finalShipped) return `The last Reserve from ${from}'s gift has shipped.`;
    const when = args.finalDueOn ? ` ships around ${monthDay(args.finalDueOn)}` : " is up next";
    return `The last Reserve from ${from}'s gift${when}.`;
  }
  return `Your Reserve from ${from} has shipped, and it was a one-season gift.`;
}

/**
 * Sent once, before the last Reserve: with the final season's notice for
 * multi-season gifts, after season 1 is fulfilled for a single season.
 */
export function buildGiftContinueText(args: BuildGiftContinueEmailArgs): string {
  const recipient = args.recipientFirstName?.trim() || "there";
  return [
    `Hey ${recipient},`,
    "",
    giftContinueLead(args),
    "",
    "Want to keep it going? Continue as a Reserve Member for $250 a season. Same stylist, same sizing, cancel anytime.",
    "",
    args.continueUrl,
    "",
    "If not, there's nothing to do. Your gift never renews.",
    "",
    "Drew, Founder, Mully",
  ].join("\n");
}
