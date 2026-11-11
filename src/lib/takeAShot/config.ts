/**
 * Take a Shot: every commercial rule in one place.
 *
 * Values decided by Drew on Nov 11, 2026 (floors 10/15, rings 30/25/20/15,
 * 14-day single-use codes, no minimum, no stacking, no 40%). Change them here
 * only; the server, the game and the landing copy all read from this file.
 * Nothing here is secret.
 */

/** Klaviyo source, Firestore source and Shopify tag for every Take a Shot capture. */
export const TAKE_A_SHOT_SOURCE = "take-a-shot";

/** Shots per game. Email only gets one; email + phone (SMS consent) gets three. */
export const SHOTS = { email: 1, phone: 3 } as const;

/**
 * Guaranteed minimum discount for anyone who plays, by channel. Matches
 * today's popup (10% email / 15% email + phone), so nobody gets less than
 * they would from ShopSignupPopup.
 */
export const FLOOR_PERCENT = { email: 10, phone: 15 } as const;

/**
 * Ring tiers, innermost first. `ft` is the ring radius in feet from the pin;
 * `pct` is the discount for finishing inside it. The staged build paid
 * 40 / 30 / 20 / 15 / 10 / 5 (on the green); production is capped at 30:
 *
 *   staged   ->  production
 *   3 ft  40 ->  30
 *   6 ft  30 ->  25
 *   12 ft 20 ->  20
 *   20 ft 15 ->  15
 *   30 ft 10 ->  floor (ring removed)
 *   green  5 ->  floor (ON_GREEN_PERCENT = 0)
 *   holed 40 ->  30 (HOLED_PERCENT)
 */
export const RING_TIERS: ReadonlyArray<{ ft: number; pct: number }> = [
  { ft: 3, pct: 30 },
  { ft: 6, pct: 25 },
  { ft: 12, pct: 20 },
  { ft: 20, pct: 15 },
];
/**
 * Mully palette for the game and its landing art (CRO review, Nov 11):
 * deep green, olive, sand, gold and cream, with burgundy as the one accent.
 */
export const PALETTE = {
  deepGreen: "#2E4A36",
  olive: "#6E7B3F",
  sand: "#D9C6A0",
  gold: "#C9A24A",
  cream: "#F4EEDF",
  accent: "#8A2432",
} as const;
/** Ring colors, inner (30%) to outer (15%), same order as RING_TIERS. */
export const RING_COLORS: readonly string[] = [PALETTE.accent, PALETTE.gold, PALETTE.sand, PALETTE.cream];
/** On the green but outside every ring. 0 means "the floor applies". */
export const ON_GREEN_PERCENT = 0;
/** Hole in one. Never above the cap. */
export const HOLED_PERCENT = 30;
/** Hard cap on any code this game can issue. Enforced on the server. */
export const MAX_PERCENT = 30;

/** Code rules for discountCodeBasicCreate. */
export const CODE_RULES = {
  /** Days until the code expires (endsAt = now + days). */
  expiryDays: 14,
  /** Minimum subtotal in store currency, or null for none. */
  minSubtotal: null as number | null,
  /** Code prefix; the full code is e.g. SHOT20-7KQ2MX. */
  prefix: "SHOT",
  /** Shopify discount tags. */
  tags: [TAKE_A_SHOT_SOURCE],
  /**
   * Codes only apply to these collections. Shopify basic code discounts cannot
   * exclude products directly, and one DiscountCodeBasic holds either
   * collections or products, never both (DiscountItems is a union). So every
   * eligible product, Shop and Reserve alike, has to be in this collection.
   * "Shop — Full Price (Take a Shot)" (handle shop-full-price): a smart
   * collection, tag "shop" AND compare-at price not set. That keeps sale items
   * out. Verified Nov 11, 2026: 49 products, all 37 active shop products, none
   * of the excluded products below, no compare-at items.
   * First Reserve quarter (Drew, Nov 11): the collection also has to include
   * RESERVE_FIRST_BOX_PRODUCT_IDS (done in Shopify, e.g. a second collection
   * source on a dedicated tag). Until then codes simply do not apply there.
   * Empty array = every product.
   */
  eligibleCollectionIds: ["gid://shopify/Collection/485574770880"] as string[],
  /**
   * Products that must never be discounted by a game code. Documentation and
   * test guard only (see above): none of these may be in the eligible
   * collection. Found in the Shopify catalog Nov 11, 2026.
   */
  excludedProductIds: [
    "gid://shopify/Product/10250499719360", // Mully Reserve | The Seasonal Edit (outfit builder; that checkout drops discount codes)
    "gid://shopify/Product/8652818940096", // Mully Reserve - Golf Curation Box (reserve-member-gift)
    "gid://shopify/Product/10327639392448", // Reserve Gift Season (gift subscription, draft)
    "gid://shopify/Product/8501257175232", // Mully Access — Annual Membership (reserve-access)
    "gid://shopify/Product/10268591096000", // Mully Access
  ] as string[],
  /**
   * Reserve products a code may discount, first payment only. This is the
   * product every live Reserve signup checkout sells (createMembershipCheckout
   * "member": variant 47601025122496, Loop plan "Quarterly Reserve" 3241476288,
   * $250). Same setup as FOUNDERS50: appliesOnSubscription true, cycle limit 1.
   */
  reserveFirstQuarterProductIds: [
    "gid://shopify/Product/8501257044160", // Mully Reserve | Seasonal Styling Subscription (reserve-member)
  ] as string[],
  /** Shop items are one-time purchases; the first Reserve quarter is a subscription. */
  appliesOnOneTimePurchase: true,
  appliesOnSubscription: true,
  /** Subscription payments discounted: the first one only. Renewals bill at the regular quarterly price. */
  recurringCycleLimit: 1,
  /** No stacking with anything (Drew, Nov 11), including shipping codes. */
  combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false },
} as const;

/**
 * Customer-facing code terms. Keep in step with CODE_RULES and with the
 * Take a Shot Klaviyo emails. No em dashes.
 */
export const CODE_TERMS = {
  /** Under the code on the result card. */
  short: "Works on one-time Shop orders or your first Reserve quarter.",
  /** Full terms line. */
  full: `Works on one-time Shop orders or your first Reserve quarter, up to ${MAX_PERCENT}% off. Reserve renewals bill at the regular quarterly price. Excludes sale items, Mully Access and gift subscriptions. One use, expires ${CODE_RULES.expiryDays} days after you play, and cannot be combined with other offers.`,
} as const;

/** Admin API version for discount mutations (DiscountCodeBasicInput.context). */
export const SHOPIFY_DISCOUNT_API_VERSION = "2026-07";

/** Abuse limits. */
export const LIMITS = {
  sessionsPerIpPerHour: 6,
  sessionsPerVisitorPerHour: 4,
  checksPerIpPerHour: 40,
  /** Phone upgrade attempts per IP, and per game. Over either: one generic error. */
  upgradesPerIpPerHour: 10,
  upgradesPerSessionPerHour: 3,
  /** Faster than a person can aim and tap; flagged for review, not blocked. */
  minMsBetweenShots: 900,
  /** An unclaimed game older than this is finished by the cron at its best result. */
  abandonAfterMinutes: 30,
  /** Pending Shopify codes are retried this many times before alerting. */
  maxCodeAttempts: 8,
} as const;

/** Floor for a session: phone (with SMS consent) or email only. */
export function floorFor(hasPhone: boolean): number {
  return hasPhone ? FLOOR_PERCENT.phone : FLOOR_PERCENT.email;
}

/** Discount for a finished shot, before the floor. Capped. */
export function percentForResult(surf: string, feet: number): number {
  if (surf === "holed") return Math.min(HOLED_PERCENT, MAX_PERCENT);
  if (surf !== "green") return 0;
  for (const t of RING_TIERS) if (feet <= t.ft) return Math.min(t.pct, MAX_PERCENT);
  return Math.min(ON_GREEN_PERCENT, MAX_PERCENT);
}

/**
 * Server API gate. The routes 404 unless the public flag is on, or this is
 * local development, or a preview deployment explicitly opts in with
 * TAKE_A_SHOT_PREVIEW_API=true (preview shares production Firestore and
 * Shopify, so it is off by default there too).
 */
export function isTakeAShotServerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.NEXT_PUBLIC_TAKE_A_SHOT_ENABLED === "true") return true;
  if (env.VERCEL_ENV === "preview") return env.TAKE_A_SHOT_PREVIEW_API === "true";
  return env.NODE_ENV === "development";
}
