/**
 * The Mully 100.
 *
 * Curated list of ~100 golf-adjacent products that link out to Amazon
 * with the Mully affiliate tag. Static data (fast, cache-friendly, easy
 * to review in PRs). Move to a CMS later if it grows past 100 rows.
 *
 * Affiliate URL is generated in code (`amazonUrl` helper), not stored
 * per-row. This makes it impossible to forget the tag or paste the wrong
 * one. Tag is defined once in `AMAZON_AFFILIATE_TAG` below.
 *
 * Voice rules — same as /lp/editorial (see the mully-editorial-system
 * skill): 1 sentence, present tense, one concrete number, no em dashes,
 * never write "Mullybox."
 *
 * Rank drives display order (1 = top-left). New picks should be added
 * with a rank chosen to place them where they belong — don't just push
 * to the end. The full list is sorted ascending by rank at render time.
 */

import type { EditorialCategory } from "@/lib/shopifyEditorial";

/**
 * Amazon Associates tag for Mully. Keep this the ONLY place it lives.
 * If Amazon ever rotates our tag, change it here and every affiliate
 * URL on the site updates on next deploy.
 */
export const AMAZON_AFFILIATE_TAG = "mully0e-20";

export interface Mully100Item {
  /** Stable slug — used for React keys and analytics. */
  id: string;
  /** Display order. 1 shows on top. Ties break by array order. */
  rank: number;
  /** Same taxonomy as the editorial feed. */
  category: EditorialCategory;
  brand: string;
  name: string;
  /** 1 sentence, Uncrate voice. No em dashes. */
  headline: string;
  /**
   * Absolute image URL. Preferred sources, in order:
   *  1. `m.media-amazon.com/images/I/{ID}._SL500_.jpg` (product hero)
   *  2. Brand-site CDN (must be on the `next.config.ts` remotePatterns list)
   *  3. `placeholder(label)` helper below — flag with `TODO(image)` in
   *     the row comment so it's easy to grep and replace.
   */
  image: string;
  /**
   * Amazon Standard Identification Number (10 chars) IF the exact
   * product has been verified on Amazon. Prefer this — direct link to
   * the product page.
   */
  asin?: string;
  /**
   * If we haven't verified the ASIN yet, put the search query here.
   * Renders as a tagged Amazon search URL, which is still a valid
   * affiliate link but drops the user on a results page. Faster to seed;
   * upgrade to `asin` once you've confirmed the SKU.
   */
  searchQuery?: string;
}

/**
 * Build the affiliate URL for an item. Always use this — never construct
 * the URL by hand, or the tag will drift. Prefers `asin` (direct product
 * page); falls back to `searchQuery` (tagged Amazon search).
 */
export function amazonUrl(
  item: Pick<Mully100Item, "asin" | "searchQuery" | "brand" | "name">
): string {
  if (item.asin) {
    return `https://www.amazon.com/dp/${item.asin}?tag=${AMAZON_AFFILIATE_TAG}`;
  }
  const q = encodeURIComponent(
    item.searchQuery || `${item.brand} ${item.name}`
  );
  return `https://www.amazon.com/s?k=${q}&tag=${AMAZON_AFFILIATE_TAG}`;
}

/**
 * Neutral bordered placeholder tile. Uses the same design language as
 * the editorial cards (bone/charcoal/serif) so the page still reads as
 * "Mully" even when a product row hasn't been photographed yet.
 *
 * `label` should be the brand or a short product noun (max ~14 chars).
 * We inline the SVG via a data URL so no HTTP fetch is needed and the
 * card looks identical across environments.
 */
function placeholder(label: string): string {
  const safe = label.replace(/[<>&"]/g, "").slice(0, 22);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'>
    <rect width='400' height='400' fill='#f5f1e8'/>
    <rect x='24' y='24' width='352' height='352' fill='none' stroke='#2a2a2a' stroke-opacity='0.10' stroke-width='1'/>
    <text x='200' y='210' font-family='Georgia, serif' font-size='20' fill='#1f3d2b' text-anchor='middle' font-style='italic'>${safe}</text>
    <text x='200' y='250' font-family='Inter, sans-serif' font-size='10' fill='#2a2a2a' fill-opacity='0.4' text-anchor='middle' letter-spacing='3'>MULLY 100</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * The list. Add a row, run a test build, ship a PR. Ordered here in
 * roughly the order we'd want them to appear; runtime sort by `rank`
 * still applies.
 *
 * Every ASIN below has been verified to resolve to the correct product
 * as of the date the row was added.
 */
export const MULLY_100: Mully100Item[] = [
  // ─── TECH (rangefinders, launch monitors, GPS) ─────────────────────────
  {
    id: "bushnell-pro-x3-plus",
    rank: 1,
    category: "tech",
    brand: "Bushnell",
    name: "Pro X3+ Rangefinder",
    headline:
      "1,300 yards of range, 7x magnification, and wind speed piped in from the phone in your pocket.",
    image: placeholder("Bushnell Pro X3+"),
    asin: "B0CZ7MGYXB",
  },
  {
    id: "garmin-approach-r10",
    rank: 2,
    category: "tech",
    brand: "Garmin",
    name: "Approach R10 Launch Monitor",
    headline:
      "A $600 launch monitor you can throw in a backpack, run in the garage, and get PGA-comparable ball-speed numbers from.",
    image: placeholder("Garmin R10"),
  },
  {
    id: "garmin-s70",
    rank: 3,
    category: "tech",
    brand: "Garmin",
    name: "Approach S70 GPS Watch",
    headline:
      "An always-on AMOLED touchscreen with 43,000 preloaded courses, doubling as the nicest sport watch on the tee sheet.",
    image: placeholder("Garmin S70"),
  },
  {
    id: "voice-caddie-sc4",
    rank: 4,
    category: "tech",
    brand: "Voice Caddie",
    name: "SC4 Portable Launch Monitor",
    headline:
      "A pocket launch monitor with radar accuracy that pairs to the phone for swing video overlays.",
    image: placeholder("Voice Caddie SC4"),
  },

  // ─── COURSE (balls, gloves, accessories) ───────────────────────────────
  {
    id: "titleist-pro-v1",
    rank: 10,
    category: "course",
    brand: "Titleist",
    name: "Pro V1 (2025)",
    headline:
      "The ball 70 percent of tour pros carry, now with a softer urethane cover and a rounder flight on wedges.",
    image: placeholder("Titleist Pro V1"),
  },
  {
    id: "titleist-pro-v1x",
    rank: 11,
    category: "course",
    brand: "Titleist",
    name: "Pro V1x (2025)",
    headline:
      "A higher flight and firmer feel than the V1 for players who want more spin on iron shots.",
    image: placeholder("Titleist Pro V1x"),
  },
  {
    id: "callaway-chrome-tour",
    rank: 12,
    category: "course",
    brand: "Callaway",
    name: "Chrome Tour Golf Balls",
    headline:
      "Callaway's answer to the Pro V1: a 4-piece urethane ball with a hyper-elastic core aimed at more distance without losing greenside bite.",
    image: placeholder("Chrome Tour"),
  },
  {
    id: "srixon-zstar-xv",
    rank: 13,
    category: "course",
    brand: "Srixon",
    name: "Z-Star XV",
    headline:
      "A firmer 3-piece urethane ball that ranks with the V1x on tour spin numbers for about $10 less per dozen.",
    image: placeholder("Srixon Z-Star XV"),
  },
  {
    id: "titleist-players-glove",
    rank: 14,
    category: "course",
    brand: "Titleist",
    name: "Players Cabretta Glove",
    headline:
      "Premium cabretta leather from a Uruguayan tannery, thin enough to feel the grip and durable enough for a full round.",
    image: placeholder("Titleist Players"),
  },
  {
    id: "footjoy-stasof",
    rank: 15,
    category: "course",
    brand: "FootJoy",
    name: "StaSof Glove",
    headline:
      "The industry's benchmark leather glove for grip in humidity, on tour since 1993.",
    image: placeholder("FootJoy StaSof"),
  },
  {
    id: "pride-professional-tees",
    rank: 16,
    category: "course",
    brand: "Pride Professional",
    name: "PTS 3 1/4\" Tees, 75-pack",
    headline:
      "The tee used by more tour pros than any other, in the 3 1/4-inch length that fits a modern 460cc driver.",
    image: placeholder("Pride PTS Tees"),
  },
  {
    id: "pin-high-alignment-sticks",
    rank: 17,
    category: "course",
    brand: "Pin High",
    name: "Alignment Sticks, Pair",
    headline:
      "Two 48-inch fiberglass sticks that fit inside your bag and turn any range session into a real practice.",
    image: placeholder("Alignment Sticks"),
  },

  // ─── STYLE (apparel, headwear, bags) ───────────────────────────────────
  {
    id: "footjoy-pro-sl-carbon",
    rank: 20,
    category: "style",
    brand: "FootJoy",
    name: "Pro/SL Carbon Golf Shoe",
    headline:
      "A carbon-plated spikeless outsole under FootJoy's benchmark tour last, worn by 3 major champions since 2023.",
    image: placeholder("FJ Pro/SL Carbon"),
  },
  {
    id: "footjoy-pro-sl",
    rank: 21,
    category: "style",
    brand: "FootJoy",
    name: "Pro/SL Golf Shoe",
    headline:
      "The tour spikeless standard: leather uppers, 3-layer chassis, and enough traction to hit 3-wood off a wet lie.",
    image: placeholder("FootJoy Pro/SL"),
  },
  {
    id: "puma-ignite-pwradapt",
    rank: 22,
    category: "style",
    brand: "PUMA",
    name: "Ignite PWRADAPT Caged",
    headline:
      "Six aggressive spikes and a molded midsole that behaves like a running shoe for guys who walk 36.",
    image: placeholder("PUMA PWRADAPT"),
  },
  {
    id: "sun-mountain-c130",
    rank: 23,
    category: "style",
    brand: "Sun Mountain",
    name: "C-130 Cart Bag",
    headline:
      "The most-copied cart bag on the market: a 14-way top with full-length dividers, built in Missoula.",
    image: placeholder("Sun Mountain C-130"),
  },
  {
    id: "sun-mountain-15",
    rank: 24,
    category: "style",
    brand: "Sun Mountain",
    name: "1.5+ LS Stand Bag",
    headline:
      "3.5 pounds, dual-strap system, and a 4-way top that fits under a push cart without unloading.",
    image: placeholder("Sun Mountain 1.5+"),
  },
  {
    id: "titleist-players-4-plus",
    rank: 25,
    category: "style",
    brand: "Titleist",
    name: "Players 4 Plus Stand Bag",
    headline:
      "A 5-pound stand bag with 6 pockets, 4-way top, and the Titleist ball-marker holster tour caddies use.",
    image: placeholder("Titleist Players 4+"),
  },
  {
    id: "vessel-player-4",
    rank: 26,
    category: "style",
    brand: "Vessel",
    name: "Player IV Pro Stand Bag",
    headline:
      "Full-grain synthetic leather, magnetic pockets, and a 6-way top that looks better after 100 rounds.",
    image: placeholder("Vessel Player IV"),
  },
  {
    id: "malbon-buckets-hat",
    rank: 27,
    category: "style",
    brand: "Malbon",
    name: "Buckets Rope Cap",
    headline:
      "The hat that turned Malbon into a $50 million brand, in a low-crown five-panel silhouette.",
    image: placeholder("Malbon Buckets"),
  },
  {
    id: "yeti-rambler-26",
    rank: 28,
    category: "style",
    brand: "YETI",
    name: "Rambler 26 oz Bottle",
    headline:
      "Double-wall stainless with a chug cap, keeping range water actually cold for 18 holes in July.",
    image: placeholder("YETI Rambler 26"),
  },
  {
    id: "ohana-golf-towel",
    rank: 29,
    category: "style",
    brand: "Ohana",
    name: "Woven Cotton Golf Towel",
    headline:
      "600 gsm cotton with a carabiner clip, dyed in a Portuguese mill and cut to a 16x24 tour size.",
    image: placeholder("Ohana Towel"),
  },

  // ─── COURSE (training, on-course consumables) ──────────────────────────
  {
    id: "orange-whip-trainer",
    rank: 40,
    category: "course",
    brand: "Orange Whip",
    name: "Full-Size Swing Trainer",
    headline:
      "A weighted rubber head on a flex shaft that fixes tempo in 5 swings, endorsed by more than 250 tour pros.",
    image: placeholder("Orange Whip"),
  },
  {
    id: "puttout-pressure-trainer",
    rank: 41,
    category: "course",
    brand: "PuttOut",
    name: "Pressure Putt Trainer",
    headline:
      "A parabolic ramp that punishes anything but tour-speed putting, small enough for the living room.",
    image: placeholder("PuttOut"),
  },
  {
    id: "callaway-hitting-net",
    rank: 42,
    category: "course",
    brand: "Callaway",
    name: "Home Range Net",
    headline:
      "A 7x7 pop-up net with a self-healing back, up in 90 seconds for backyard sessions.",
    image: placeholder("Callaway Net"),
  },
  {
    id: "spider-tour-mat",
    rank: 43,
    category: "course",
    brand: "Fiberbuilt",
    name: "Grass Series 5x4 Hitting Mat",
    headline:
      "The mat you actually feel a divot on, used in more than 400 top-100 practice facilities.",
    image: placeholder("Fiberbuilt Mat"),
  },

  // ─── STYLE (accessories) ───────────────────────────────────────────────
  {
    id: "ray-ban-wayfarer",
    rank: 50,
    category: "style",
    brand: "Ray-Ban",
    name: "Wayfarer Classic",
    headline:
      "The 1952 shape that outlasted every design trend since, in G-15 lenses that read greens in bright sun.",
    image: placeholder("Ray-Ban Wayfarer"),
  },
  {
    id: "oakley-holbrook",
    rank: 51,
    category: "style",
    brand: "Oakley",
    name: "Holbrook Prizm Golf",
    headline:
      "Prizm lenses that turn grass into three shades of green for better read on breaks.",
    image: placeholder("Oakley Holbrook"),
  },
  {
    id: "peter-millar-shorts",
    rank: 52,
    category: "style",
    brand: "Peter Millar",
    name: "Salem 9\" Performance Short",
    headline:
      "A 9-inch inseam in 4-way stretch nylon that reads dressier than joggers and cooler than khakis.",
    image: placeholder("Peter Millar"),
  },
  {
    id: "howler-brothers-hat",
    rank: 53,
    category: "style",
    brand: "Howler Brothers",
    name: "Structured Snapback",
    headline:
      "Waxed cotton, a curved bill, and the fishing-brand aesthetic that reads more Bandon than PGA West.",
    image: placeholder("Howler Bros"),
  },
];
