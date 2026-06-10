/**
 * Sponsorship program announcement to active Reserve / Access members.
 *
 * Operation 266, June 2026. Audience: ~1,533 active subscribers in
 * `customer_facts` with `is_subscriber_active = true`. The sponsorship
 * program has been built and live in /dashboard?tab=sponsorships for
 * weeks, but no email or in-product surface has told members it exists.
 * This is the one-shot announcement that opens the channel.
 *
 * Mechanics:
 *   - Personal code is rendered inline (deterministic HMAC, no DB hit).
 *   - Single CTA goes to /s/<code> which sets the cookie and 302s to
 *     /lp/reserve, so a member can forward the link in a text and any
 *     attributed signup credits them.
 *   - Four badges restated, with First Dozen as the headline because
 *     it fires on every signup (no qualifying gate) and is the easiest
 *     to picture.
 *
 * Tone: founder-voice, no growth-hack vocabulary, no em dashes.
 */

export interface SponsorshipAnnounceContext {
  firstName: string | null;
  sponsorshipCode: string;
  /** Public site origin so links render absolute. */
  siteOrigin: string;
}

export function sponsorshipAnnounceTemplate(
  ctx: SponsorshipAnnounceContext,
): { subject: string; text: string } {
  const greeting = ctx.firstName ? `Hey ${ctx.firstName},` : "Hey,";

  // /s/<code> sets the attribution cookie at the edge and 302s to the LP.
  // Members can text this link to a friend and we credit the signup.
  const shareUrl = `${ctx.siteOrigin}/s/${ctx.sponsorshipCode}`;
  const boardUrl = `${ctx.siteOrigin}/dashboard?tab=benefits&sub=sponsorships`;

  const subject = "Your sponsorship code (and what it gets you)";

  const text = `${greeting}

I built something for Reserve members and never told you it was there. Fixing that today.

Every member has a personal sponsorship code. Yours is:

  ${ctx.sponsorshipCode}

When a friend joins Reserve or Access through your code, you both get rewarded. The rewards stack as you bring in more people:

  1 paid sponsorship   The First Dozen. A dozen Pro V1s to you, a dozen to them.
  3 in 30 days         The Foursome. Private tee time at a Mully partner course, custom embroidered patches for the group, and a coordinated gear drop.
  10 paid sponsorships  Path to Black. Guaranteed invitation to Reserve Black.
  18 in a year         The 18. Comped trip of your choice, Pebble, Pinehurst, or wherever. Airfare and golf capped at $2,000.

Two ways to use it.

Forward this link to a friend. It sets the attribution cookie automatically, you don't have to remember to tell them anything:
${shareUrl}

Or send them your code directly and they enter it at checkout:
${ctx.sponsorshipCode}

Your full sponsorship board with progress, attributed orders, and badge status lives here:
${boardUrl}

If even one person in your foursome would actually use Reserve, this is the easiest dozen Pro V1s you'll ever earn. Reply if anything is broken or you have questions.

Drew
Founder, Mullybox
`;

  return { subject, text };
}
