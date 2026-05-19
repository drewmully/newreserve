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
