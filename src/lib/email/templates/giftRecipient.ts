/**
 * Recipient-facing email for a Mully Reserve gift purchase.
 *
 * Sent from the gifting Phase 2 cron once it's time to deliver the gift
 * announcement (immediate, or scheduled via gift_deliver_on).
 */

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
