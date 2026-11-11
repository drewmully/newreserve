/**
 * BF/CM 2026: the single source of truth for every Black Friday / Cyber
 * Monday date window on mymully.com.
 *
 * Every instant is written as an explicit America/New_York offset. Late
 * November is EST (UTC-05:00), so all windows use -05:00. Each window is
 * half-open, [start, end): "11/26 23:59" in the plan means "until midnight
 * ET starts 11/27", which is the `end` instant here.
 *
 * Public API (safe to import from server and client code, no Node deps):
 *   BFCM_WINDOWS            all windows, as { start, end } ISO strings
 *   bfcmPhase(now)          null | "members_first" | "early_access" | "bf" | "cm"
 *   isInWindow(key, now)    true while `now` is inside a named window
 *   mysteryBoxAccess(now)   "closed_before" | "members" | "public" | "ended"
 *   resolveBfcmNow(...)     the effective "now", honoring ?bfcm_now on
 *                           non-production deployments only
 *   nextBfcmBoundary(now)   the next instant any window opens or closes
 *
 * The evergreen /black-friday page and every BF/CM surface should import
 * from here rather than writing dates of their own.
 */

export const BFCM_TIME_ZONE = "America/New_York";

/** Query param that overrides "now" on preview and local builds only. */
export const BFCM_NOW_PARAM = "bfcm_now";

export type BfcmPhase = "members_first" | "early_access" | "bf" | "cm";

export interface BfcmWindow {
  /** Inclusive start, explicit ET offset. */
  start: string;
  /** Exclusive end, explicit ET offset. */
  end: string;
}

export const BFCM_WINDOWS = {
  /** Members First early access: 11/23 00:00 to 11/26 23:59 ET. */
  membersFirst: { start: "2026-11-23T00:00:00-05:00", end: "2026-11-27T00:00:00-05:00" },
  /** MULLYEARLY (10% off the BF Edit): 11/26 12:00 noon to 23:59 ET. */
  earlyAccess: { start: "2026-11-26T12:00:00-05:00", end: "2026-11-27T00:00:00-05:00" },
  /** Black Friday: 11/27 00:00 to 11/29 23:59 ET. */
  bf: { start: "2026-11-27T00:00:00-05:00", end: "2026-11-30T00:00:00-05:00" },
  /** Cyber Monday: 11/30 00:00 to 12/1 23:59 ET. */
  cm: { start: "2026-11-30T00:00:00-05:00", end: "2026-12-02T00:00:00-05:00" },
  /** Doorbusters: 11/27 00:00 to 11/28 23:59 ET. */
  doorbusters: { start: "2026-11-27T00:00:00-05:00", end: "2026-11-29T00:00:00-05:00" },
  /** Mully Mystery Box, members only: 11/23 00:00 to 11/26 23:59 ET. */
  mysteryBoxMembers: { start: "2026-11-23T00:00:00-05:00", end: "2026-11-27T00:00:00-05:00" },
  /** Mully Mystery Box, public: 11/27 00:00 to 12/1 23:59 ET. */
  mysteryBoxPublic: { start: "2026-11-27T00:00:00-05:00", end: "2026-12-02T00:00:00-05:00" },
  /** Gift a Season thank-you credit line: 11/23 00:00 to 12/1 23:59 ET. */
  giftSeasonBonus: { start: "2026-11-23T00:00:00-05:00", end: "2026-12-02T00:00:00-05:00" },
} as const satisfies Record<string, BfcmWindow>;

export type BfcmWindowKey = keyof typeof BFCM_WINDOWS;

function ms(iso: string): number {
  return Date.parse(iso);
}

function toMs(now: Date | number): number {
  return typeof now === "number" ? now : now.getTime();
}

/** True while `now` is inside the named window, [start, end). */
export function isInWindow(key: BfcmWindowKey, now: Date | number): boolean {
  const t = toMs(now);
  const w = BFCM_WINDOWS[key];
  return t >= ms(w.start) && t < ms(w.end);
}

/**
 * The sitewide BF/CM phase at `now`. Early access (11/26 noon ET onward) wins
 * over Members First because it is the more specific window.
 */
export function bfcmPhase(now: Date | number): BfcmPhase | null {
  if (isInWindow("cm", now)) return "cm";
  if (isInWindow("bf", now)) return "bf";
  if (isInWindow("earlyAccess", now)) return "early_access";
  if (isInWindow("membersFirst", now)) return "members_first";
  return null;
}

export type MysteryBoxAccess = "closed_before" | "members" | "public" | "ended";

/** Who may buy the Mully Mystery Box at `now`. */
export function mysteryBoxAccess(now: Date | number): MysteryBoxAccess {
  const t = toMs(now);
  if (t < ms(BFCM_WINDOWS.mysteryBoxMembers.start)) return "closed_before";
  if (isInWindow("mysteryBoxMembers", t)) return "members";
  if (isInWindow("mysteryBoxPublic", t)) return "public";
  return "ended";
}

/** True when this deployment may honor ?bfcm_now. Never in production. */
export function bfcmOverrideAllowed(vercelEnv: string | undefined = process.env.VERCEL_ENV): boolean {
  return vercelEnv !== "production";
}

/**
 * Parse a ?bfcm_now value. Accepts any ISO string Date.parse understands;
 * values without an offset are read as UTC by the JS engine, so pass an
 * explicit offset, e.g. 2026-11-26T12:00:00-05:00.
 */
export function parseBfcmNow(value: string | string[] | null | undefined): Date | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t) : null;
}

/**
 * The effective "now". The override is ignored unless `allowOverride` is
 * true; callers pass bfcmOverrideAllowed() so production always uses the
 * real clock.
 */
export function resolveBfcmNow({
  override,
  allowOverride,
  realNow = new Date(),
}: {
  override?: string | string[] | null;
  allowOverride: boolean;
  realNow?: Date;
}): Date {
  if (!allowOverride) return realNow;
  return parseBfcmNow(override) ?? realNow;
}

/** The next instant any BF/CM window opens or closes, or null when none remain. */
export function nextBfcmBoundary(now: Date | number): Date | null {
  const t = toMs(now);
  let next = Infinity;
  for (const w of Object.values(BFCM_WINDOWS) as BfcmWindow[]) {
    for (const edge of [ms(w.start), ms(w.end)]) if (edge > t && edge < next) next = edge;
  }
  return Number.isFinite(next) ? new Date(next) : null;
}

/** Ready-made ?bfcm_now values for QA, one per phase. */
export const BFCM_QA_NOW = {
  before: "2026-11-22T12:00:00-05:00",
  members_first: "2026-11-24T12:00:00-05:00",
  early_access: "2026-11-26T12:00:00-05:00",
  bf: "2026-11-27T12:00:00-05:00",
  cm: "2026-11-30T12:00:00-05:00",
  after: "2026-12-02T12:00:00-05:00",
} as const;

/* ------------------------------------------------------------------ */
/* Offer content shared by the BF/CM surfaces.                         */
/* ------------------------------------------------------------------ */

export const BFCM_EARLY_ACCESS_CODE = "MULLYEARLY";

/**
 * Hero PDPs that show "Free gift with $150+" near the price in bf and cm,
 * instead of a sale badge or strikethrough.
 */
export const BFCM_HERO_PDP_HANDLES = [
  "olydoe-merino-ponte-vest",
  "duckhead-classic-fit-gold-school-chino-khaki",
  "duckhead-fremont-sport-performance-quilted-vest-brandy-brown",
] as const;

export function isBfcmHeroPdp(handle: string): boolean {
  return (BFCM_HERO_PDP_HANDLES as readonly string[]).includes(handle);
}

/** The free gift with $150+ for each sale phase that has one. */
export const BFCM_GIFT_WITH_PURCHASE: Partial<Record<BfcmPhase, string>> = {
  bf: "Winston towel",
  cm: "Rhone sock",
};
