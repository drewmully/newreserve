/**
 * Holiday gift guide (/shop/gifts and /shop/gifts/[tier]).
 *
 * Everything editorial lives here: tier bands, curated picks with a one-line
 * reason, the "full outfit" sets, FAQs and the Christmas order-by date.
 * Prices, stock and in-stock sizes always come from Shopify at render time.
 * Copy never names a price or a stock count.
 *
 * Picks follow cmo_audit/merchandise_velocity.md (2026-11-11): vests and
 * outerwear lead, the Gold School Chino anchors the outfits while it is in
 * stock in L or XL (vest-led looks take over when it is not), summer polos,
 * $300+ duffels and the Mystery Bundle stay out.
 */

import { getProductByHandle, type ShopifyProduct } from "@/lib/shopify";
import { isRestockOnly } from "@/lib/restock";

// Christmas cutoff lives in giftGuideDates.ts (client-safe). Re-exported here.
export { GIFT_SHIP_BY, GIFT_ORDER_BY, GIFT_RESTOCK_WEEKS, giftOrderByLabel, giftOrderByShort, giftRestockCutoffLabel, giftRestockCutoffShortDay, giftOrderByCopy, giftRestockCopy, isPastGiftOrderBy } from "@/lib/giftGuideDates";
import { GIFT_RESTOCK_WEEKS, giftOrderByShort, giftRestockCutoffShortDay } from "@/lib/giftGuideDates";

// ─── Gift a Season ──────────────────────────────────────────────────────────

/**
 * Gift a Season (prepaid Reserve, one, two or four seasons) lives at
 * /lp/gift-season (PR #352, live 2026-11-11). Set to false to hide it. While false, every Gift a Season element (hero strip
 * CTA, intro link, the card, the mobile tile, the Gift a Season FAQs and meta
 * mention) is hidden: /lp/gift sells the recurring Reserve, so "never renews"
 * would be false there. This is the only switch.
 */
export const GIFT_SEASON_LIVE: boolean = true;
export const GIFT_SEASON_HREF = "/lp/gift-season";

// ─── Tiers ──────────────────────────────────────────────────────────────────

export type GiftTierSlug = "under-100" | "100-to-150" | "150-to-250";

export interface GiftTier {
  slug: GiftTierSlug;
  /** Pre-2026 slug, permanently redirected to `slug` in next.config.ts. */
  legacyKey: string;
  /** Short label for nav and links. */
  label: string;
  /** H2 on the hub and H1 on the tier page, phrased as the search query. */
  heading: string;
  kicker: string;
  /** One-line dek under the heading. */
  dek: string;
  metaTitle: string;
  metaDescription: string;
  /** Inclusive lower bound, exclusive upper bound, on the live price. */
  min: number;
  max: number;
  /** Curated handles in display order. In-stock items float to the top. */
  picks: string[];
}

/**
 * Never shown anywhere in the guide (tiers, hub rail, outfits, JSON-LD),
 * even if a handle is added to a list below. The Rhone C.O.R. Crew Sock is
 * reserved as the CM26 gift and isn't in Shop - All.
 */
export const GIFT_EXCLUDED_HANDLES: ReadonlySet<string> = new Set(["rhone-c-o-r-crew-sock"]);

export const GIFT_GUIDE_TIERS: GiftTier[] = [
  {
    slug: "under-100",
    legacyKey: "under100",
    label: "Under $100",
    heading: "Best golf gifts under $100",
    kicker: "Stocking stuffers",
    dek: "Small, useful and the kind of thing he would not buy for himself.",
    metaTitle: "Golf Gifts Under $100 for Men 2026 | Mully",
    metaDescription:
      "Golf gifts under $100 for men: tour towels, organic cotton hats, bag organizers and shag bags. Picked by Mully, with in-stock pieces first.",
    min: 0,
    max: 100,
    picks: [
      "sloat-organic-cotton-six-panel-hat",
      "jolly-golf-purist-organizer",
      "penfold-heritage-shag-bag",
      "winston-golf-tour-towel",
      "primo-fairway-crew",
      "duckhead-stretch-belt",
    ],
  },
  {
    slug: "100-to-150",
    legacyKey: "hundredToThree",
    label: "$100 to $150",
    heading: "Best golf gifts from $100 to $150",
    kicker: "The core",
    dek: "The chino, the layer and the long sleeve he will wear all winter.",
    metaTitle: "Golf Gifts $100 to $150 for Men 2026 | Mully",
    metaDescription:
      "Golf gifts from $100 to $150: the Duck Head Gold School Chino, Rhone and Olydoe layers, and a Penfold shoe bag. Picked by Mully.",
    min: 100,
    max: 150,
    picks: [
      "duckhead-classic-fit-gold-school-chino-khaki",
      "rhone-long-game-vest",
      "olydoe-pima-long-sleeve-polo",
      "rhone-rise-quarter-zip",
      "rhone-long-game-jacket",
      "penfold-heritage-shoe-bag-ii",
      "duckhead-long-drive-performance-five-pocket",
      "technically-golf-tiger-stripe-needlepoint-belt",
    ],
  },
  {
    slug: "150-to-250",
    legacyKey: "threeHundredPlus",
    label: "$150 to $250",
    heading: "Best golf gifts from $150 to $250",
    kicker: "The hero gifts",
    dek: "Vests and outerwear. The pieces golfers bought most this fall.",
    metaTitle: "Golf Gifts $150 to $250 for Men 2026 | Mully",
    metaDescription:
      "The best golf gifts from $150 to $250: merino and down vests, quarter zips and heavyweight fleece from Olydoe, Duck Head, Rhone and Sloat.",
    min: 150,
    max: 250.01,
    picks: [
      "olydoe-merino-ponte-vest",
      "duckhead-fremont-sport-performance-quilted-vest-brandy-brown",
      "rhone-voyage-down-vest",
      "olydoe-merino-ponte-quarter-zip",
      "quiet-golf-bristol-polo-sweater",
      // stitch-player-puffer-jacket is out until Shopify has a flat packshot
      // for it: every photo in its media is a model shot (CRO, 2026-11-11).
      "technically-golf-nio-half-zip",
      "sloat-organic-cotton-fleece-quarter-zip",
      "sloat-organic-cotton-fleece-crewneck",
      "sloat-organic-cotton-fleece-hoodie",
    ],
  },
];

/** Hub order: hero tier first, per the velocity report. */
export const GIFT_GUIDE_HUB_ORDER: GiftTierSlug[] = ["150-to-250", "100-to-150", "under-100"];

export function getGiftTier(slug: string): GiftTier | undefined {
  return GIFT_GUIDE_TIERS.find((t) => t.slug === slug);
}

/** One line per product. No prices, no stock counts, no em dashes. */
export const GIFT_REASONS: Record<string, string> = {
  // Under $100
  "sloat-organic-cotton-six-panel-hat": "Organic cotton, made in the USA, with a leather strap that patinas as he wears it.",
  "jolly-golf-purist-organizer": "Every tee, marker and pencil in one zip pouch. No more digging on the first tee.",
  "penfold-heritage-shag-bag": "Millerain canvas, a lifetime warranty and room for a hundred practice balls.",
  "winston-golf-tour-towel": "Ribbed terry, 22 by 44 inches. Big enough to dry a grip in a downpour.",
  "primo-fairway-crew": "A modal-blend crew with four-way stretch that sits quietly over a polo.",
  "duckhead-stretch-belt": "A braided stretch belt that gives a little at the top of the backswing.",
  // $100 to $150
  "duckhead-classic-fit-gold-school-chino-khaki": "A classic-fit khaki he will wear all week. Pick his waist and inseam and it does the rest.",
  "rhone-long-game-vest": "UPF 50+ and a water-repellent finish for the round that turns on the back nine.",
  "olydoe-pima-long-sleeve-polo": "Long-staple Peruvian Pima with a little stretch. A polo built for November.",
  "rhone-rise-quarter-zip": "Raglan sleeves and a low chin guard, over any polo he already owns.",
  "rhone-long-game-jacket": "A stretch shell with magnetic hand pockets, so nothing falls out on the cart path.",
  "penfold-heritage-shoe-bag-ii": "Waxed Millerain canvas on a full-grain leather base. His spikes ride home in it for years.",
  "duckhead-long-drive-performance-five-pocket": "A performance five-pocket in a clean, familiar cut. Course to dinner without a change.",
  "technically-golf-tiger-stripe-needlepoint-belt": "Navy needlepoint with a tiger-stripe detail. Gets noticed at the turn.",
  // $150 to $250
  "olydoe-merino-ponte-vest": "The piece golfers bought most this fall. Two layers of Australian merino, knitted as one.",
  "duckhead-fremont-sport-performance-quilted-vest-brandy-brown": "Quilted warmth and a full-zip front, in three low-key fall colors.",
  "rhone-voyage-down-vest": "700+ fill down that layers clean and packs small for the trip.",
  "olydoe-merino-ponte-quarter-zip": "The vest's merino ponte with sleeves. Natural stretch and a real drape.",
  "quiet-golf-bristol-polo-sweater": "100% cotton fleece, smooth outside and plush inside, with a polo collar.",
  "stitch-player-puffer-jacket": "Stuffs into its own pocket and rides in the bag until the wind picks up.",
  "technically-golf-nio-half-zip": "A light half zip for the first tee and the walk back to the car.",
  "sloat-organic-cotton-fleece-quarter-zip": "480 gsm organic cotton fleece, sewn in Portugal. Heavy in the right way.",
  "sloat-organic-cotton-fleece-crewneck": "480 gsm organic fleece with a concealed zip pocket for the car key.",
  "sloat-organic-cotton-fleece-hoodie": "The same 480 gsm Portuguese fleece, with a jersey-lined hood for December range sessions.",
};

// ─── Outfits ────────────────────────────────────────────────────────────────

export interface GiftOutfitLook {
  /** Anchor piece. The look only shows if the anchor is in stock in L or XL right now. */
  anchor: string;
  /** The other pieces. Each must be purchasable (in stock or restocking). */
  with: string[];
  note: string;
}

export interface GiftOutfit {
  key: string;
  name: string;
  /**
   * Looks in priority order. The first look whose anchor passes the live
   * stock check is shown; if none pass, the outfit is hidden. The chino
   * comes first; the vest-led looks cover the chino being oversold.
   */
  looks: GiftOutfitLook[];
}

export const GIFT_OUTFIT_CHINO = "duckhead-classic-fit-gold-school-chino-khaki";
/** Sizes that count as "common" for the anchor stock check. */
const ANCHOR_SIZES = ["L", "XL"];

export const GIFT_OUTFITS: GiftOutfit[] = [
  {
    key: "saturday-morning",
    name: "The Saturday Morning",
    looks: [
      {
        anchor: GIFT_OUTFIT_CHINO,
        with: ["olydoe-pima-long-sleeve-polo", "olydoe-merino-ponte-vest"],
        note: "Khaki chino, a Pima long sleeve and the merino vest. Three of the pieces golfers bought most this fall, worn together.",
      },
      {
        anchor: "olydoe-merino-ponte-vest",
        with: ["olydoe-pima-long-sleeve-polo", "winston-golf-tour-towel"],
        note: "The merino vest over a Pima long sleeve, plus a tour towel. The vest is the piece golfers bought most this fall.",
      },
    ],
  },
  {
    key: "frost-delay",
    name: "The Frost Delay",
    looks: [
      {
        anchor: GIFT_OUTFIT_CHINO,
        with: ["rhone-rise-quarter-zip", "duckhead-fremont-sport-performance-quilted-vest-brandy-brown"],
        note: "The same chino under a Rhone quarter zip and a quilted Duck Head vest.",
      },
      {
        anchor: "duckhead-fremont-sport-performance-quilted-vest-brandy-brown",
        with: ["rhone-rise-quarter-zip", "winston-golf-tour-towel"],
        note: "A quilted Duck Head vest over a Rhone quarter zip, and a tour towel for the wet first tee.",
      },
    ],
  },
];


// ─── FAQs ───────────────────────────────────────────────────────────────────

export interface GiftFaq {
  q: string;
  a: string;
}

export function giftGuideFaqs(): GiftFaq[] {
  const orderBy = giftOrderByShort();
  const restockBy = giftRestockCutoffShortDay();
  const shipping: GiftFaq = {
    q: "When do I need to order for Christmas delivery?",
    a: `Order in-stock pieces by ${orderBy} for Christmas delivery with standard shipping. Pieces marked Restocking ship in about ${GIFT_RESTOCK_WEEKS} weeks: order them by ${restockBy} for the best chance by Christmas.`,
  };
  const returns: GiftFaq = {
    q: "Can gifts be returned or exchanged?",
    a: "Unworn, unwashed pieces with tags attached can be returned within 30 days of delivery, and the refund goes to the original payment method. Size exchanges are free: start one on the Returns page with the order number and email.",
  };
  if (!GIFT_SEASON_LIVE) {
    return [
      {
        q: "What do you get a golfer who has everything?",
        a: "Something he would not buy for himself. A merino or down vest he will wear every cold round, a needlepoint belt, or a Penfold shoe bag that outlasts his clubs.",
      },
      shipping,
      {
        q: "What if I am not sure of his size?",
        a: "Most of the tops we ship this time of year go out in L or XL, and each product page has the brand's size chart. Unworn items with tags attached can be returned within 30 days of delivery.",
      },
      returns,
    ];
  }
  return [
    {
      q: "What do you get a golfer who has everything?",
      a: "Gift a Season. A Mully stylist hand-picks golf apparel and accessories for him each season, so he gets pieces he would not have picked for himself. Choose one, two or four seasons. You pay once and it never renews.",
    },
    {
      q: "Is a gift subscription better than a single item?",
      a: "A single piece is something to open on the day. Gift a Season keeps arriving long after the holidays, a new edit each season. If you are unsure of his size, pick his usual one: he can update his sizes before each season.",
    },
    shipping,
    {
      q: "What if I am not sure of his size?",
      a: "Most of the tops we ship this time of year go out in L or XL, and each product page has the brand's size chart. With Gift a Season you pick his usual sizes, and he can update them before each season. For single pieces, unworn items with tags attached can be returned within 30 days of delivery.",
    },
    returns,
  ];
}

// ─── Live data ──────────────────────────────────────────────────────────────

/** Hub only: every in-stock pick, then at most this many Restocking picks per tier. */
export const HUB_MAX_RESTOCK_PER_TIER = 2;
export function capForHub(picks: GiftPick[]): GiftPick[] {
  return [...picks.filter((p) => p.inStock), ...picks.filter((p) => !p.inStock).slice(0, HUB_MAX_RESTOCK_PER_TIER)];
}

/** Product grids are 4 across on desktop and 2 on mobile. */
export const GRID_COLUMNS = 4;

/**
 * Keep a grid free of empty slots. Trailing Restocking picks are dropped
 * until the count is a multiple of 4, or one short of it; in that case
 * `fill` is true and the grid adds one link tile (or the Gift a Season tile
 * when it is live). In-stock picks are never dropped.
 */
export function fitToRows(picks: GiftPick[]): { picks: GiftPick[]; fill: boolean } {
  const out = [...picks];
  while (out.length % GRID_COLUMNS !== 0 && out.length % GRID_COLUMNS !== GRID_COLUMNS - 1 && out.length && !out[out.length - 1].inStock) {
    out.pop();
  }
  return { picks: out, fill: out.length % GRID_COLUMNS === GRID_COLUMNS - 1 };
}

/** A rail pick carries its own tier, so clicks report the tier it belongs to. */
export type GiftRailPick = GiftPick & { tier: GiftTierSlug };

/**
 * Hub rail under the H1: four in-stock picks, live from Shopify. The first
 * two hero-tier picks (the vests), then the first in-stock pick of the other
 * tiers, topped up from whatever else is in stock. Slugs in `exclude` (the
 * hub's first grid row) are skipped so the rail never repeats them.
 */
export function heroRail(tiers: GiftTierData[], size = 4, exclude: ReadonlySet<string> = new Set()): GiftRailPick[] {
  const inStock = (slug: GiftTierSlug): GiftRailPick[] =>
    (tiers.find((t) => t.tier.slug === slug)?.picks ?? [])
      .filter((p) => p.inStock && !exclude.has(p.product.slug))
      .map((p) => ({ ...p, tier: slug }));
  const hero = inStock("150-to-250");
  const core = inStock("100-to-150");
  const small = inStock("under-100");
  const seen = new Set<string>();
  const out: GiftRailPick[] = [];
  for (const p of [hero[0], hero[1], core[0], small[0], ...hero, ...core, ...small]) {
    if (!p || seen.has(p.product.slug) || out.length >= size) continue;
    seen.add(p.product.slug);
    out.push(p);
  }
  return out;
}

export interface GiftOutfitData {
  outfit: GiftOutfit;
  look: GiftOutfitLook;
  picks: GiftPick[];
}

export interface GiftPick {
  product: ShopifyProduct & { preferredVariantId?: string };
  reason: string;
  inStock: boolean;
  restockOnly: boolean;
  /** Sizes with units on hand right now, across colors. Empty for one-size items. */
  sizesInStock: string[];
}

export interface GiftTierData {
  tier: GiftTier;
  picks: GiftPick[];
}

const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "XXXL"];
const EARTH_TONE = /green|brown|khaki|olive|tan|brandy|pine|forest|highland|oceana|stone|sand|camel|wine|fossil|loden|moss|honey|oat|natural|bone|cream|heather/i;
const MAX_PER_TIER = 12;

function optionValue(v: ShopifyProduct["variants"][number], name: RegExp): string | undefined {
  return v.selectedOptions?.find((o) => name.test(o.name))?.value;
}

function sizeRank(size: string): number {
  const i = SIZE_ORDER.indexOf(size.toUpperCase());
  return i === -1 ? 99 : i;
}

/**
 * Card link target: an in-stock variant, preferring L then XL, then earth
 * tones. Falls back to any available variant.
 */
function preferredVariant(p: ShopifyProduct): string | undefined {
  const ready = p.variants.filter((v) => v.availableForSale && !v.currentlyNotInStock);
  const pool = ready.length ? ready : p.variants.filter((v) => v.availableForSale);
  const score = (v: ShopifyProduct["variants"][number]) => {
    const size = optionValue(v, /^size$/i)?.toUpperCase();
    const color = optionValue(v, /^colou?r$/i) ?? "";
    return (size === "L" ? 0 : size === "XL" ? 1 : size ? 3 : 2) + (EARTH_TONE.test(color) ? 0 : 0.5);
  };
  return [...pool].sort((a, b) => score(a) - score(b))[0]?.id;
}

function toPick(p: ShopifyProduct): GiftPick {
  const ready = p.variants.filter((v) => v.availableForSale && !v.currentlyNotInStock);
  const sizes = Array.from(
    new Set(ready.map((v) => optionValue(v, /^size$/i)).filter((s): s is string => !!s && !/one size|^os$/i.test(s)))
  ).sort((a, b) => sizeRank(a) - sizeRank(b));
  return {
    product: { ...p, preferredVariantId: preferredVariant(p) },
    reason: GIFT_REASONS[p.slug] ?? p.editorialHeadline ?? "",
    inStock: ready.length > 0,
    restockOnly: isRestockOnly(p.variants),
    sizesInStock: sizes,
  };
}

/** Every curated handle, fetched once per render (Storefront fetch is cached 60s, page ISR 1h). */
async function loadCatalog(): Promise<Map<string, ShopifyProduct>> {
  const handles = Array.from(
    new Set([...GIFT_GUIDE_TIERS.flatMap((t) => t.picks), ...GIFT_OUTFITS.flatMap((o) => o.looks.flatMap((l) => [l.anchor, ...l.with]))])
  ).filter((h) => !GIFT_EXCLUDED_HANDLES.has(h));
  const settled = await Promise.allSettled(handles.map((h) => getProductByHandle(h)));
  const map = new Map<string, ShopifyProduct>();
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) map.set(handles[i], r.value);
  });
  return map;
}

function purchasable(p: ShopifyProduct | undefined): p is ShopifyProduct {
  return !!p && !GIFT_EXCLUDED_HANDLES.has(p.slug) && p.variants.some((v) => v.availableForSale);
}

function tierForPrice(price: number): GiftTier | undefined {
  return GIFT_GUIDE_TIERS.find((t) => price >= t.min && price < t.max);
}

/**
 * Live gift guide data. A pick lands in the tier its live Shopify price fits,
 * so a price change in Shopify moves the product without a code change.
 * Anything not purchasable is dropped. In-stock pieces sort first.
 */
export async function loadGiftGuide(): Promise<{ tiers: GiftTierData[]; outfits: GiftOutfitData[] }> {
  const catalog = await loadCatalog();
  const buckets = new Map<GiftTierSlug, GiftPick[]>(GIFT_GUIDE_TIERS.map((t) => [t.slug, []]));
  const placed = new Set<string>();

  for (const tier of GIFT_GUIDE_TIERS) {
    for (const handle of tier.picks) {
      const p = catalog.get(handle);
      if (!purchasable(p) || placed.has(handle)) continue;
      const home = tierForPrice(p.price);
      if (!home) continue; // drifted outside every band, e.g. repriced above $250
      buckets.get(home.slug)!.push(toPick(p));
      placed.add(handle);
    }
  }

  const tiers = GIFT_GUIDE_TIERS.map((tier) => {
    const list = buckets.get(tier.slug)!;
    // Stable sort: in-stock first, curated order otherwise.
    const sorted = [...list.filter((x) => x.inStock), ...list.filter((x) => !x.inStock)].slice(0, MAX_PER_TIER);
    return { tier, picks: sorted };
  });

  // Live stock decides the anchor: first look whose anchor is in stock in L
  // or XL and whose other pieces can all be bought. No look, no outfit.
  const outfits: GiftOutfitData[] = [];
  for (const outfit of GIFT_OUTFITS) {
    for (const look of outfit.looks) {
      const anchor = catalog.get(look.anchor);
      if (!purchasable(anchor)) continue;
      const anchorPick = toPick(anchor);
      if (!anchorPick.inStock || !anchorPick.sizesInStock.some((size) => ANCHOR_SIZES.includes(size.toUpperCase()))) continue;
      const rest = look.with.map((h) => catalog.get(h));
      if (!rest.every(purchasable)) continue;
      outfits.push({ outfit, look, picks: [anchorPick, ...rest.map((p) => toPick(p!))] });
      break;
    }
  }

  return { tiers, outfits };
}
