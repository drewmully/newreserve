/**
 * Recipient-facing email for a Mully Reserve gift purchase.
 *
 * Sent from the gifting Phase 2 cron once it's time to deliver the gift
 * announcement (immediate, or scheduled via gift_deliver_on).
 */
import {
  GIFT_SEASON_SHIP_WINDOW,
  GIFT_SEASON_SHOW_FREE_SHIPPING_EXCHANGES,
} from "@/lib/gifts/giftSeasonConfig";

export interface BuildGiftRecipientEmailArgs {
  recipientFirstName: string | null;
  purchaserFirstName: string | null;
  purchaserEmail: string;
  giftMessage: string | null;
  sizingUrl: string;
  /** Gift a Season: prepaid box count. Omit for the legacy recurring gift. */
  seasonsTotal?: number | null;
}


function seasonsPhrase(n: number): string {
  return n === 1 ? "a season" : `${n} seasons`;
}

export function buildGiftRecipientSubject(
  args: Pick<BuildGiftRecipientEmailArgs, "purchaserFirstName" | "seasonsTotal">
): string {
  const from = args.purchaserFirstName?.trim();
  if (args.seasonsTotal) {
    return from
      ? `${from} gave you ${seasonsPhrase(args.seasonsTotal)} of Mully Reserve`
      : `You have a Mully Reserve gift waiting`;
  }
  return from
    ? `${from} sent you a Mully Reserve gift`
    : `You have a Mully Reserve gift waiting`;
}

export function buildGiftRecipientText(args: BuildGiftRecipientEmailArgs): string {
  if (args.seasonsTotal) return buildGiftSeasonRecipientText(args, args.seasonsTotal);
  const recipient = args.recipientFirstName?.trim() ?? "there";
  const fromName =
    args.purchaserFirstName?.trim() || args.purchaserEmail;

  const messageBlock = args.giftMessage?.trim()
    ? `\n\nA note from ${fromName}:\n"${args.giftMessage.trim()}"\n`
    : "\n";

  return [
    `Hey ${recipient},`,
    "",
    `${fromName} just gave you Mully Reserve — our hand-curated quarterly box of premium golf apparel and accessories. $300+ retail value in every box, free shipping, exchanges always free.`,
    messageBlock.trimEnd(),
    `Before we ship your first box, confirm your sizing (it takes ~2 minutes — shirt, pant, shoe, glove, and a few fit preferences):`,
    "",
    args.sizingUrl,
    "",
    `That's it. Once you submit, we curate your first quarterly box and it ships in 5–7 business days.`,
    "",
    `Questions? Just reply to this email — it goes straight to me.`,
    "",
    `Welcome to Reserve,`,
    `Drew · Founder, Mully`,
    "",
    `— — —`,
    `Mullybox · Quarterly curations for golfers with taste`,
    `Your subscription will auto-cancel after the first box ships, so you'll never be charged again unless you decide to stay. Manage everything at https://mymully.com/account.`,
  ].join("\n");
}

/**
 * Gift a Season reveal email. Copy rules: no em dashes, say "Reserve" not
 * "box", keep it short.
 */
function buildGiftSeasonRecipientText(
  args: BuildGiftRecipientEmailArgs,
  seasons: number
): string {
  const recipient = args.recipientFirstName?.trim() || "there";
  const fromName = args.purchaserFirstName?.trim() || args.purchaserEmail;
  const note = args.giftMessage?.trim();
  return [
    `Hey ${recipient},`,
    "",
    `${fromName} gave you ${seasonsPhrase(seasons)} of Mully Reserve: golf apparel and accessories hand-picked by a Mully stylist each season.${
      GIFT_SEASON_SHOW_FREE_SHIPPING_EXCHANGES ? " Shipping and exchanges are free." : ""
    }`,
    ...(note ? ["", `A note from ${fromName}:`, `"${note}"`] : []),
    "",
    "Confirm your sizing so we can style your first Reserve. It takes about 2 minutes:",
    "",
    args.sizingUrl,
    "",
    seasons > 1
      ? `Your first Reserve ships ${GIFT_SEASON_SHIP_WINDOW} after you confirm sizing, then one every 3 months until all ${seasons} have arrived.`
      : `Your Reserve ships ${GIFT_SEASON_SHIP_WINDOW} after you confirm sizing.`,
    "It's fully prepaid. Nothing renews and you'll never be charged.",
    "",
    "Questions? Just reply to this email.",
    "",
    "Welcome to Reserve,",
    "Drew, Founder, Mully",
  ].join("\n");
}

export interface BuildGiftContinueEmailArgs {
  recipientFirstName: string | null;
  purchaserFirstName: string | null;
  seasonsTotal: number;
  continueUrl: string;
}

export function buildGiftContinueSubject(args: BuildGiftContinueEmailArgs): string {
  return args.seasonsTotal > 1
    ? "Your last gifted Reserve is on its way"
    : "Keep Mully Reserve going";
}

/** Sent once, when the final prepaid Reserve is on its way. */
export function buildGiftContinueText(args: BuildGiftContinueEmailArgs): string {
  const recipient = args.recipientFirstName?.trim() || "there";
  const from = args.purchaserFirstName?.trim() || "your gifter";
  return [
    `Hey ${recipient},`,
    "",
    args.seasonsTotal > 1
      ? `The last Reserve from ${from}'s gift is on its way.`
      : `Your Reserve from ${from} is on its way.`,
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

export interface BuildGiftSelfDeliverEmailArgs {
  purchaserFirstName: string | null;
  recipientFirstName: string | null;
  seasonsTotal: number;
  sizingUrl: string;
  giftCardUrl: string;
}

/** "I'll give it myself": reveal subject sent to the gifter. */
export function buildGiftSelfDeliverSubject(args: BuildGiftSelfDeliverEmailArgs): string {
  const recipient = args.recipientFirstName?.trim();
  return recipient
    ? `Your Mully Reserve gift for ${recipient} is ready to give`
    : "Your Mully Reserve gift is ready to give";
}

/**
 * "I'll give it myself": the gifter gets the printable card and the
 * recipient's private sizing link to pass along. Copy rules apply.
 */
export function buildGiftSelfDeliverText(args: BuildGiftSelfDeliverEmailArgs): string {
  const name = args.purchaserFirstName?.trim() || "there";
  const recipient = args.recipientFirstName?.trim() || "them";
  return [
    `Hi ${name},`,
    "",
    `Your gift of ${seasonsPhrase(args.seasonsTotal)} of Mully Reserve is ready to give.`,
    "",
    "Print the gift card here. It has their private sizing link on it:",
    args.giftCardUrl,
    "",
    `Or send ${recipient} the sizing link directly:`,
    args.sizingUrl,
    "",
    `Their first Reserve ships ${GIFT_SEASON_SHIP_WINDOW} after they confirm sizing.`,
    "It's fully prepaid. Nothing renews and they'll never be charged.",
    "",
    "Questions? Just reply to this email.",
    "",
    "Drew, Founder, Mully",
  ].join("\n");
}
