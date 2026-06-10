/**
 * Lapsed-subscriber winback email.
 *
 * Sent to customers in `customer_facts` with `is_subscriber_lapsed = true`
 * (10,490 churned subscribers as of June 2026). These people already
 * paid once, then cancelled or aged out — the warmest cold audience we have.
 *
 * Mechanics:
 *   - Single discount code `WELCOMEBACK50` ($50 off, applies to Reserve
 *     quarterly and Mully Access annual), expires 2026-07-01.
 *   - Welcome gift restated: rangefinder ($199 MSRP) ships with first
 *     quarter on Reserve Member (carryover of the standard welcome gift).
 *   - Hard urgency: Q3 enrollment closes June 30; subs starting after
 *     July 1 land in Q4 instead.
 *
 * Tone: founder-voice, no growth-hack tricks, no fake scarcity. Drew's
 * reply-to is live. No em dashes (project rule).
 */

export interface LapsedWinbackContext {
  firstName: string | null;
  /** Sponsorship/referral code we can surface for one-click forwarding. */
  sponsorshipCode?: string | null;
  /** Public site origin so links render absolute. */
  siteOrigin: string;
}

const DISCOUNT_CODE = "WELCOMEBACK50";
const DISCOUNT_AMOUNT_USD = 50;
const RANGEFINDER_MSRP_USD = 199;

export function lapsedWinbackTemplate(
  ctx: LapsedWinbackContext,
): { subject: string; text: string } {
  const greeting = ctx.firstName ? `Hey ${ctx.firstName},` : "Hey,";
  const reserveUrl = `${ctx.siteOrigin}/lp/reserve?utm_source=resend&utm_medium=email&utm_campaign=winback_jun26&discount=${DISCOUNT_CODE}`;
  const accessUrl  = `${ctx.siteOrigin}/lp/reserve?plan=access&utm_source=resend&utm_medium=email&utm_campaign=winback_jun26&discount=${DISCOUNT_CODE}`;

  const sponsorshipLine = ctx.sponsorshipCode
    ? `If you'd rather pass this to a friend, your sponsorship code is ${ctx.sponsorshipCode} and it earns you both a dozen Pro V1s when they join.`
    : "";

  const subject = "Come back to Reserve. $50 off, plus the rangefinder still ships.";

  const text = `${greeting}

You used to be a Reserve member. I'd love to have you back, and I want to make it easy.

Here's what's different now:
  • Quarterly curation that actually rotates with the season, picked from brands you wouldn't otherwise put together yourself
  • A rangefinder ships with your first quarter as the welcome gift (the same one we sell for $${RANGEFINDER_MSRP_USD}, included)
  • Members get first dibs on Pro Shop drops and member-only pricing
  • Sponsorship rewards: a dozen Pro V1s when you bring a friend, a private tee time when you bring three

I'm giving you $${DISCOUNT_AMOUNT_USD} off your first quarter or your first year of Access with code ${DISCOUNT_CODE}.

Reserve Member (quarterly), $${249 - DISCOUNT_AMOUNT_USD} your first quarter, then $249/quarter:
${reserveUrl}

Mully Access (annual, no shipments), $${99 - DISCOUNT_AMOUNT_USD} your first year:
${accessUrl}

One thing to know: Q3 curation locks June 30. If you sign back up by then, you ship with the next quarter. After July 1 you'd land in Q4 instead, which is a longer wait than I'd want for someone coming back.

${sponsorshipLine}

If anything's off, wrong size on file, a previous bad experience, a billing question, just reply. I read every one.

Drew
Founder, Mullybox

P.S. Code ${DISCOUNT_CODE} expires June 30. One per customer.
`;

  return { subject, text };
}
