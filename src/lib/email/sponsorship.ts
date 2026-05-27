/**
 * Sponsorship transactional email senders.
 *
 * One shot per event, never enqueued into the sequence engine. We pass an
 * idempotency key keyed on the underlying sponsorship_id or reward_id so
 * the orders-paid webhook can retry the entire post-attribution step
 * without sending duplicates.
 *
 * Copy rule: no em dashes anywhere. Use periods, commas, or sentence breaks.
 */
import { sendPlainText } from "./resend";
import {
  SPONSORSHIP_BADGES,
  type SponsorshipBadge,
} from "@/lib/sponsorship";

const ACCOUNT_URL = "https://mymully.com/dashboard?tab=benefits&sub=sponsorships";

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://mymully.com";
}

function tag(name: string, value: string): { name: string; value: string } {
  return { name, value };
}

const BASE_TAGS = [tag("category", "sponsorship")];

/**
 * Sent to the sponsor when a friend they sponsored finishes their first
 * paid order. Fires from the orders-paid webhook.
 */
export async function sendSponsorAttributedEmail(input: {
  to: string;
  sponsorFirstName: string | null;
  sponsoredEmail: string;
  sponsorshipId: number;
  totalCount: number;
}): Promise<string | null> {
  const greeting = input.sponsorFirstName ?? "there";
  const subject = `${input.sponsoredEmail} just joined Mully Reserve through your sponsorship.`;
  const text = `Hey ${greeting},

Quick note. ${input.sponsoredEmail} just signed up for Mully Reserve through your sponsorship link. That puts you at ${input.totalCount} paid sponsorship${input.totalCount === 1 ? "" : "s"}.

You can see your full sponsorship board, including badges and progress, here:
${ACCOUNT_URL}

Thanks for bringing them in. The Pro V1s are headed your way and theirs, we'll follow up with shipping confirmation.

Drew`;

  return sendPlainText({
    to: input.to,
    subject,
    text,
    idempotencyKey: `sponsor-attributed-${input.sponsorshipId}`,
    tags: [...BASE_TAGS, tag("event", "attributed")],
  });
}

/**
 * Sent to the sponsored member after their first paid order, welcoming
 * them in and reminding them their sponsor sent them. Fires from the
 * orders-paid webhook.
 */
export async function sendSponsoredWelcomeEmail(input: {
  to: string;
  sponsorFirstName: string | null;
  sponsorshipId: number;
}): Promise<string | null> {
  const sponsor = input.sponsorFirstName ?? "a Reserve member";
  const subject = "Welcome to Mully Reserve.";
  const text = `Welcome in.

You joined Mully Reserve through ${sponsor}, so they're getting a dozen Pro V1s on your behalf, and so are you.

You'll see those land in your account shipments shortly. Until then, your member benefits are already live, including 15% off the Pro Shop, free 2 day shipping, V1+ virtual coaching, and concierge support.

Sign in here to set up your fit profile so your first quarterly box ships dialed:
${siteUrl()}/account

Drew`;

  return sendPlainText({
    to: input.to,
    subject,
    text,
    idempotencyKey: `sponsor-welcome-${input.sponsorshipId}`,
    tags: [...BASE_TAGS, tag("event", "welcome")],
  });
}

/**
 * Sent when a badge is earned. Both sponsor and (for first_dozen)
 * the sponsored party get a note tailored to the badge.
 */
export async function sendBadgeEarnedEmail(input: {
  to: string;
  recipientFirstName: string | null;
  badge: SponsorshipBadge;
  rewardId: number;
  /** "sponsor" or "sponsored", drives the role-specific copy on first_dozen. */
  role: "sponsor" | "sponsored";
}): Promise<string | null> {
  const def = SPONSORSHIP_BADGES[input.badge];
  const greeting = input.recipientFirstName ?? "there";
  const { subject, body } = badgeCopy(input.badge, input.role, greeting);

  const text = `${body}

You can see this badge live on your sponsorship board:
${ACCOUNT_URL}

Drew

${def.title}. ${def.tagline}`;

  return sendPlainText({
    to: input.to,
    subject,
    text,
    idempotencyKey: `reward-${input.badge}-${input.rewardId}-${input.role}`,
    tags: [
      ...BASE_TAGS,
      tag("event", "badge_earned"),
      tag("badge", input.badge),
      tag("role", input.role),
    ],
  });
}

function badgeCopy(
  badge: SponsorshipBadge,
  role: "sponsor" | "sponsored",
  greeting: string,
): { subject: string; body: string } {
  switch (badge) {
    case "first_dozen":
      return role === "sponsor"
        ? {
            subject: "The First Dozen is yours. Pro V1s incoming.",
            body: `Hey ${greeting},\n\nYou just sponsored your first paid member, which means The First Dozen is unlocked. A dozen Pro V1s are headed to you, and a dozen are headed to them.\n\nKeep going. Every sponsorship from here adds another badge on your board.`,
          }
        : {
            subject: "Welcome to Mully Reserve. A dozen Pro V1s are on their way.",
            body: `Hey ${greeting},\n\nWelcome in. The person who sent you joined as your sponsor, so we're shipping you a dozen Pro V1s as a hello.\n\nFit profile takes 60 seconds. Get that set and your first quarterly box ships dialed.`,
          };
    case "foursome":
      return {
        subject: "The Foursome is complete. Tee time on us.",
        body: `Hey ${greeting},\n\nThree paid sponsorships in 30 days. That's The Foursome, and it means a private tee time at a Mully partner course, custom embroidered patches for the group, and a coordinated gear drop sized for all four of you.\n\nReply with your foursome's chosen name and your preferred partner course, Streamsong, Bandon, Pinehurst, or somewhere else. We'll handle the rest.`,
      };
    case "path_to_black":
      return {
        subject: "The Path to Black is complete. Your invitation stands.",
        body: `Hey ${greeting},\n\nTen paid sponsorships. You just walked the only public road to Reserve Black, and your invitation is guaranteed.\n\nI'll send the formal onboarding separately. For now, congratulations. This is rare air.`,
      };
    case "the_18":
      return {
        subject: "You completed The 18. Pick your trip.",
        body: `Hey ${greeting},\n\nEighteen paid sponsorships in a single calendar year. One for every hole. That puts you on the Patron's Wall in Pontiac, and it sends you on a comped trip of your choice, Pebble, Pinehurst, or wherever else you want to go.\n\nFine print, airfare and golf combined cap at $2,000. Reply with where and when, and we'll book it.`,
      };
  }
}
