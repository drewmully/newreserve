/**
 * Pro Shop abandoned-add nudge.
 *
 * Sent ~24h after a user fires `proshop_quick_add_clicked` (or `add_to_cart`
 * scoped to the Pro Shop collection) and has NOT completed a purchase since.
 * Soft, founder-voice — no countdown timers, no discount bait. The Pro Shop
 * is already at member price; the value prop is the curation, not urgency.
 *
 * Cron lives at /api/admin/cron/proshop-abandon-nudge.
 */

export interface ProShopAbandonContext {
  firstName: string | null;
  /** The single product the user added (we pick the most recent one). */
  productName: string;
  productBrand: string;
  productShopPath: string; // "/shop/<slug>"
}

export function proShopAbandonTemplate(
  ctx: ProShopAbandonContext
): { subject: string; text: string } {
  const greeting = ctx.firstName ? `Hey ${ctx.firstName},` : "Hey,";

  const subject = `Still thinking about the ${ctx.productBrand}?`;

  const text = `${greeting}

Saw you had the ${ctx.productName} (${ctx.productBrand}) in your Pro Shop cart yesterday. It's still there if you want to grab it.

https://mymully.com${ctx.productShopPath}

Member pricing is already applied. No discount code, no rush — but if you've got a question on sizing or fit, just reply to this email and I'll get you sorted.

— Drew
`;

  return { subject, text };
}
