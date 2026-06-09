/**
 * Pro Shop recovery email.
 *
 * Sent ONCE to customers who had at least one open Shopify draft order
 * surviving the legacy duplicate-draft cleanup (see dedupe-member-drafts.ts).
 *
 * These people clicked "Checkout" on the Pro Shop but never paid — sometimes
 * because they bounced between dozens of duplicate draft URLs, sometimes
 * because they just wandered off. Either way, the cart is still live and we
 * can route them back to the invoice URL Shopify already minted.
 *
 * Tone: short, founder-voice, no urgency manipulation. Drew's reply-to is
 * always live, so be human.
 */

export interface ProShopRecoveryContext {
  firstName: string | null;
  /** Shopify draft order invoice URL — opens hosted checkout pre-populated. */
  invoiceUrl: string;
  /** Top 1–3 items in the cart, for the "what's in there" reminder. */
  topItems: Array<{ title: string; quantity: number }>;
  /** Pre-tax total from the surviving draft. */
  totalPrice: string;
}

function formatTopItems(items: ProShopRecoveryContext["topItems"]): string {
  if (items.length === 0) return "";
  const slice = items.slice(0, 3);
  const parts = slice.map((i) =>
    i.quantity > 1 ? `${i.title} ×${i.quantity}` : i.title
  );
  if (items.length > 3) parts.push(`and ${items.length - 3} more`);
  return parts.join(", ");
}

export function proShopRecoveryTemplate(
  ctx: ProShopRecoveryContext
): { subject: string; text: string } {
  const greeting = ctx.firstName ? `Hey ${ctx.firstName},` : "Hey,";
  const cartLine = formatTopItems(ctx.topItems);
  const cartSentence = cartLine
    ? `You had ${cartLine} sitting in the Pro Shop cart at $${ctx.totalPrice}.`
    : `You had a Pro Shop cart sitting at $${ctx.totalPrice}.`;

  const subject = "Your Pro Shop cart — picked up where you left off";

  const text = `${greeting}

I was cleaning up the back-end of the Pro Shop this week and noticed your cart was still open. We had a bug that was creating duplicate carts on every add — that's fixed now, and I consolidated yours back into a single checkout you can finish in two clicks.

${cartSentence}

Pick up where you left off:
${ctx.invoiceUrl}

Member pricing is already applied. If anything looks off — wrong sizing, changed your mind, want a substitution — just reply to this email and I'll sort it.

— Drew
Founder, Mullybox
`;

  return { subject, text };
}
