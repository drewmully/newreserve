/**
 * Sponsorship code generation, verification, and badge taxonomy.
 *
 * Codes are deterministic and stateless. Generated from a customer's
 * numeric id + a server secret using the same HMAC primitive pattern as
 * foundersCampaign.ts. No database round trip is required to render a
 * code or to validate one at the redirect edge.
 *
 * Shape: `<PREFIX>-<4-char base32>`
 *   PREFIX: up to 6 uppercase letters from the customer's first name,
 *           falling back to "MULLY" if no name is available
 *   4-char: first 4 chars of base32(HMAC_SHA256(secret, id))
 *
 * Example: DREW-A4F2
 *
 * Validation does NOT require a DB lookup. We re-derive the expected
 * 4-char suffix from the provided id (passed alongside the code) or
 * we accept any code and resolve the customer in the webhook by
 * cross-checking the suffix against the candidate customer.
 *
 * For the public redirect path /s/[code] we only need to set a cookie,
 * the actual referrer resolution happens in the orders-paid webhook
 * where we have a Supabase service-role client. This keeps the redirect
 * edge-fast and immune to DB outages.
 */
import crypto from "node:crypto";

const TOKEN_SECRET =
  process.env.SPONSORSHIP_TOKEN_SECRET ??
  process.env.FOUNDERS_TOKEN_SECRET ??
  "dev-only-sponsorship-secret-do-not-use-in-prod";

const SUFFIX_LENGTH = 4;
const MAX_PREFIX_LENGTH = 8;

/** Base32 alphabet without the easily confused letters (no 0, 1, I, O, L, U). */
const BASE32_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

/** Map raw HMAC bytes to a base32 string using our reduced alphabet. */
function bytesToBase32(buf: Buffer, length: number): string {
  const chars: string[] = [];
  for (let i = 0; i < length && i < buf.length; i++) {
    const byte = buf[i] ?? 0;
    chars.push(BASE32_ALPHABET[byte % BASE32_ALPHABET.length]!);
  }
  return chars.join("");
}

/** Sanitize a first name into an uppercase ASCII prefix. */
function buildPrefix(firstName: string | null | undefined): string {
  const cleaned = (firstName ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
  if (!cleaned) return "MULLY";
  return cleaned.slice(0, MAX_PREFIX_LENGTH);
}

/** Compute the deterministic 4-char suffix for a customer id. */
function suffixForCustomer(customerId: number | bigint): string {
  const id = String(customerId);
  const mac = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(`sponsor:${id}`)
    .digest();
  return bytesToBase32(mac, SUFFIX_LENGTH);
}

export interface BuildSponsorshipCodeInput {
  customerId: number | bigint;
  firstName?: string | null;
}

/** Generate a sponsorship code for a customer. Stateless and idempotent. */
export function buildSponsorshipCode(input: BuildSponsorshipCodeInput): string {
  return `${buildPrefix(input.firstName)}-${suffixForCustomer(input.customerId)}`;
}

/**
 * Parse a code into its prefix and suffix. Returns null if the format is
 * obviously wrong. Does NOT verify ownership, that happens in the webhook
 * once we have a candidate customer id.
 */
export function parseSponsorshipCode(
  code: string,
): { prefix: string; suffix: string } | null {
  if (!code) return null;
  const trimmed = code.trim().toUpperCase();
  const match = trimmed.match(/^([A-Z]{1,8})-([A-Z0-9]{4})$/);
  if (!match) return null;
  return { prefix: match[1]!, suffix: match[2]! };
}

/**
 * Verify a code against a candidate customer id. Use this in the webhook
 * after resolving the candidate sponsor by suffix lookup.
 */
export function verifySponsorshipCode(
  code: string,
  customerId: number | bigint,
): boolean {
  const parsed = parseSponsorshipCode(code);
  if (!parsed) return false;
  const expected = suffixForCustomer(customerId);
  return parsed.suffix === expected;
}

/* ─── Badge taxonomy ────────────────────────────────────────────────────── */

export type SponsorshipBadge =
  | "first_dozen"
  | "foursome"
  | "path_to_black"
  | "the_18";

export const SPONSORSHIP_BADGE_ORDER: readonly SponsorshipBadge[] = [
  "first_dozen",
  "foursome",
  "path_to_black",
  "the_18",
];

export interface BadgeDefinition {
  key: SponsorshipBadge;
  title: string;
  /** Short label that fits on the badge tile. */
  shortTitle: string;
  /** Hero line used on the badge card and in emails. */
  tagline: string;
  /** Detail copy. No em dashes, by request. */
  description: string;
  /** Threshold value displayed on the badge. */
  threshold: number;
  /** Human-readable window. */
  window: string;
  /** Reward summary, used in both UI and email. */
  reward: string;
}

export const SPONSORSHIP_BADGES: Record<SponsorshipBadge, BadgeDefinition> = {
  first_dozen: {
    key: "first_dozen",
    title: "The First Dozen",
    shortTitle: "First Dozen",
    tagline: "Your first sponsorship lands a dozen on each tee.",
    description:
      "Sponsor your first paid member and we ship a dozen Pro V1s to you and a dozen to them. Two boxes, one handshake.",
    threshold: 1,
    window: "First paid sponsorship",
    reward: "A dozen Pro V1s for you, a dozen for your friend.",
  },
  foursome: {
    key: "foursome",
    title: "The Foursome",
    shortTitle: "Foursome",
    tagline: "Three friends in thirty days. The group becomes the gift.",
    description:
      "Sponsor three paid members within a 30 day window and the four of you receive a private tee time at a Mully partner course, custom embroidered patches with your foursome's chosen name, and a coordinated gear drop sized for four.",
    threshold: 3,
    window: "Within 30 days",
    reward:
      "Private tee time at a partner course, custom patches, and a coordinated gear drop for four.",
  },
  path_to_black: {
    key: "path_to_black",
    title: "The Path to Black",
    shortTitle: "Path to Black",
    tagline: "Ten sponsorships. The only public road to Reserve Black.",
    description:
      "Reserve Black is invite only. Sponsor ten paid members and your invitation is guaranteed. This is the single public path to the top tier.",
    threshold: 10,
    window: "Any time",
    reward: "A guaranteed Reserve Black invitation.",
  },
  the_18: {
    key: "the_18",
    title: "The 18",
    shortTitle: "The 18",
    tagline: "Eighteen sponsorships in a year. One for every hole.",
    description:
      "Complete The 18 in a calendar year and Mully sends you on a comped trip of your choice, Pebble, Pinehurst, or member's choice, with your name added to the Patron's Wall in Pontiac.",
    threshold: 18,
    window: "Within a calendar year",
    reward:
      "A comped trip of your choice and your name on the Patron's Wall in Pontiac. Fine print: airfare and golf combined cap at $2,000.",
  },
};

/** Cart attribute key passed through the Shopify checkout hop. */
export const SPONSORSHIP_CART_ATTR_KEY = "mully_sponsor";

/** Cookie name set by /s/[code]. 90 day TTL, first-touch wins. */
export const SPONSORSHIP_COOKIE_NAME = "mully_sponsor";

/** Cookie max age, 90 days in seconds. Mirrors Google Ads conversion window. */
export const SPONSORSHIP_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

/**
 * Compute which badges a sponsor has now earned, given their full set of
 * sponsorships and any previously earned badges. Returns ONLY newly earned
 * badges so the caller can insert them and fire one notification each.
 *
 * Window math:
 *   - first_dozen: any sponsorship pushes count to >= 1 and badge not yet held
 *   - foursome: 3 sponsorships within the trailing 30 day window
 *   - path_to_black: 10 lifetime sponsorships
 *   - the_18: 18 sponsorships in the current calendar year. Resets each Jan 1
 *     by virtue of the year-windowed count, so a sponsor can earn the_18
 *     multiple years in a row (each one creates a new reward row).
 */
export interface SponsorshipEvent {
  attributedAt: Date;
}

export interface EvaluateBadgeInput {
  events: SponsorshipEvent[];
  /** Year of the badge instances already earned, used only for the_18. */
  yearBadgesEarned: { the_18: number[] };
  /** Lifetime badges already held, used for first_dozen and path_to_black. */
  lifetimeBadgesHeld: Set<SponsorshipBadge>;
  /** Number of foursome badges already earned. We allow multiples. */
  foursomeBadgesCount: number;
  /** Anchor for "now". Lets us unit test deterministically. */
  now?: Date;
}

export function evaluateNewBadges(input: EvaluateBadgeInput): SponsorshipBadge[] {
  const now = input.now ?? new Date();
  const events = [...input.events].sort(
    (a, b) => a.attributedAt.getTime() - b.attributedAt.getTime(),
  );
  const lifetimeCount = events.length;
  const newlyEarned: SponsorshipBadge[] = [];

  if (lifetimeCount >= 1 && !input.lifetimeBadgesHeld.has("first_dozen")) {
    newlyEarned.push("first_dozen");
  }

  if (lifetimeCount >= 10 && !input.lifetimeBadgesHeld.has("path_to_black")) {
    newlyEarned.push("path_to_black");
  }

  // Foursome: any rolling 30-day window with 3+ sponsorships. We fire once
  // per such window, so we count completed windows since the last foursome
  // badge by walking the sorted events.
  const completedFoursomeWindows = countFoursomeWindows(events);
  if (completedFoursomeWindows > input.foursomeBadgesCount) {
    const newWindows = completedFoursomeWindows - input.foursomeBadgesCount;
    for (let i = 0; i < newWindows; i++) newlyEarned.push("foursome");
  }

  // The 18: count this calendar year. If >= 18 and not yet earned for this
  // year, fire.
  const currentYear = now.getUTCFullYear();
  const thisYearCount = events.filter(
    (e) => e.attributedAt.getUTCFullYear() === currentYear,
  ).length;
  if (
    thisYearCount >= 18 &&
    !input.yearBadgesEarned.the_18.includes(currentYear)
  ) {
    newlyEarned.push("the_18");
  }

  return newlyEarned;
}

/**
 * Count the number of disjoint 30 day windows in which a sponsor hit 3
 * sponsorships. Each window starts at the first qualifying event and
 * consumes the next two events that fall within 30 days. The window
 * "closes" on the third qualifying event, after which we restart counting
 * from the next un-consumed event.
 */
function countFoursomeWindows(events: SponsorshipEvent[]): number {
  if (events.length < 3) return 0;
  const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  let windows = 0;
  let i = 0;
  while (i + 2 < events.length) {
    const start = events[i]!.attributedAt.getTime();
    const third = events[i + 2]!.attributedAt.getTime();
    if (third - start <= WINDOW_MS) {
      windows += 1;
      i += 3; // consume these three
    } else {
      i += 1;
    }
  }
  return windows;
}
