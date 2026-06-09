/**
 * Weekly "This week in the Pro Shop" digest — sent to paid members
 * (access + member) every Wednesday morning. Highlights the 3-5 most-added
 * products from the last 7 days so engagement is driven by social-proof,
 * not artificial scarcity.
 *
 * Cron lives at /api/admin/cron/proshop-weekly-digest.
 */

export interface ProShopWeeklyContext {
  firstName: string | null;
  /** 3-5 trending products from the last 7d in adds-desc order. */
  products: Array<{
    name: string;
    brand: string;
    /** Member-price string (already discounted). */
    memberPrice: string;
    /** "/shop/<slug>" deep link. */
    shopPath: string;
  }>;
}

export function proShopWeeklyTemplate(
  ctx: ProShopWeeklyContext
): { subject: string; text: string } {
  const greeting = ctx.firstName ? `${ctx.firstName},` : "Friend,";

  // Top-1 brand for the subject line — gives the email a hook beyond the
  // generic "weekly digest" framing. Falls back to a neutral line if empty.
  const topProduct = ctx.products[0];
  const subject = topProduct
    ? `What members are picking up: ${topProduct.brand}, this week`
    : "This week in the Pro Shop";

  const lines: string[] = [];
  lines.push(greeting);
  lines.push("");
  lines.push(
    "Quick read on what other members are putting in their cart this week. " +
      "All at member pricing, ships separately from your quarterly curation."
  );
  lines.push("");

  for (const p of ctx.products) {
    lines.push(`• ${p.brand} — ${p.name} (${p.memberPrice})`);
    lines.push(`  https://mymully.com${p.shopPath}`);
    lines.push("");
  }

  lines.push("Browse the full Pro Shop:");
  lines.push("https://mymully.com/dashboard?tab=shop");
  lines.push("");
  lines.push("— Drew");

  return { subject, text: lines.join("\n") };
}
