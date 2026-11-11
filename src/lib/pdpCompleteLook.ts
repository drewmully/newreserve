/**
 * PDP "Complete the look" A/B test (PostHog flag `pdp_complete_look`).
 *
 * Pure logic shared by the vest PDPs, the slide cart and the unit tests:
 * the pairing config, the out-of-stock fallback, the size default and the
 * BOGO15 line state. No fetches, no React, no prices: every price and stock
 * flag comes from the live Storefront product passed in.
 */

import { BOGO15_CODE, isBogoDiscount } from "./cartPicks";
import { isFirstOrderShippingCode } from "./firstOrderShipping";

export const PDP_COMPLETE_LOOK_FLAG = "pdp_complete_look";
/** PostHog property that carries the arm on every event of the test. */
export const PDP_COMPLETE_LOOK_PROPERTY = `$feature/${PDP_COMPLETE_LOOK_FLAG}`;
/** QA query param: ?pdp_complete_look=test|control|off */
export const PDP_COMPLETE_LOOK_QUERY = PDP_COMPLETE_LOOK_FLAG;
/** Browser storage key for the sticky assignment. */
export const PDP_COMPLETE_LOOK_STORAGE_KEY = "mully_pdp_complete_look";

export type CompleteLookVariant = "control" | "test";

export function parseCompleteLookVariant(value: unknown): CompleteLookVariant | null {
  return value === "control" || value === "test" ? value : null;
}

/** The sticky arm stored in this browser, if any. */
export function readStoredCompleteLookVariant(): CompleteLookVariant | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return parseCompleteLookVariant(localStorage.getItem(PDP_COMPLETE_LOOK_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * QA overrides work outside production, or in production when the flag
 * payload for the evaluated variant is {"allow_overrides": true}.
 */
export function completeLookOverridesAllowed(payload: unknown, vercelEnv: string | undefined): boolean {
  if (vercelEnv !== "production") return true;
  return !!payload && typeof payload === "object" && (payload as { allow_overrides?: unknown }).allow_overrides === true;
}

/**
 * The one config for the test. Vest handle -> two pairing handles, in order.
 * Product names for reference:
 *   Olydoe Merino Ponte Vest -> Olydoe Pima LS Polo + Winston Golf Tour Towel
 *     (CRO, PR #361: the Crew Sock is not in Shop — All, so BOGO15 never applied)
 *   Duck Head Fremont Quilted Vest -> Rhone Rise 1/4 Zip + Winston Golf Tour Towel
 *   Rhone Voyage Down Vest -> Olydoe Pima LS Polo + Winston Golf Tour Towel
 */
export const COMPLETE_LOOK_PAIRINGS: Record<string, readonly string[]> = {
  "olydoe-merino-ponte-vest": ["olydoe-pima-long-sleeve-polo", "winston-golf-tour-towel"],
  "duckhead-fremont-sport-performance-quilted-vest-brandy-brown": [
    "rhone-rise-quarter-zip",
    "winston-golf-tour-towel",
  ],
  "rhone-voyage-down-vest": ["olydoe-pima-long-sleeve-polo", "winston-golf-tour-towel"],
};

/** Gift guide tiers whose picks back-fill an out-of-stock pairing, in order. */
export const COMPLETE_LOOK_FALLBACK_TIERS = ["100-to-150", "under-100"] as const;

export const COMPLETE_LOOK_COUNT = 2;

export function isCompleteLookProduct(slug: string | undefined | null): boolean {
  return !!slug && Object.prototype.hasOwnProperty.call(COMPLETE_LOOK_PAIRINGS, slug);
}

/* ── Lean product shape ─────────────────────────────────────────────── */

export interface LookVariant {
  id: string;
  /** Live Shopify variant price (what the cart charges a non-member). */
  price: number;
  /** Member price, passed through to the existing cart add. */
  reservePrice: number;
  /** Physically in stock: sellable and not a preorder/restock line. */
  inStock: boolean;
  size?: string;
  color?: string;
  label: string;
}

export interface LookItem {
  slug: string;
  name: string;
  brand: string;
  image: string;
  /** Tagged "shop", i.e. in Shop — All, the BOGO15 buy/get collection. */
  bogoEligible: boolean;
  /** Name of the product's size option, when it has one. */
  sizeOption?: string;
  /** Size values in Shopify order. */
  sizes: string[];
  /** True when the item uses apparel letter sizing, so the vest size carries over. */
  sizeApplies: boolean;
  variants: LookVariant[];
}

interface SourceVariant {
  id: string;
  price: number;
  reservePrice: number;
  availableForSale: boolean;
  currentlyNotInStock?: boolean;
  selectedOptions: Array<{ name: string; value: string }>;
}

export interface LookSourceProduct {
  slug: string;
  name: string;
  brand: string;
  images: string[];
  tags?: string[];
  options?: Array<{ name: string; values: string[] }>;
  variants: SourceVariant[];
}

const SIZE_RE = /^size$/i;
const COLOR_RE = /^colou?r$/i;
const APPAREL_SIZES = new Set(["XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL"]);

/**
 * Map a Storefront product to the lean item. Returns null when the item
 * cannot be added in one tap: it has an option other than size and color
 * (fit, inseam, waist), or no variants.
 */
export function toLookItem(p: LookSourceProduct, image?: string): LookItem | null {
  if (!p.variants?.length) return null;
  const options = (p.options ?? []).filter(
    (o) => !(o.values.length === 1 && o.values[0] === "Default Title")
  );
  if (options.some((o) => !SIZE_RE.test(o.name) && !COLOR_RE.test(o.name))) return null;
  const sizeOption = options.find((o) => SIZE_RE.test(o.name))?.name;
  const colorOption = options.find((o) => COLOR_RE.test(o.name))?.name;
  const sizes = sizeOption ? options.find((o) => o.name === sizeOption)?.values ?? [] : [];
  const letterSizes = sizes.filter((s) => APPAREL_SIZES.has(s.toUpperCase()));
  const variants: LookVariant[] = p.variants.map((v) => {
    const size = sizeOption ? v.selectedOptions.find((o) => o.name === sizeOption)?.value : undefined;
    const color = colorOption ? v.selectedOptions.find((o) => o.name === colorOption)?.value : undefined;
    return {
      id: v.id,
      price: v.price,
      reservePrice: v.reservePrice,
      inStock: v.availableForSale && !v.currentlyNotInStock,
      size,
      color,
      label: [color, size].filter(Boolean).join(" / ") || "Default",
    };
  });
  return {
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    image: image ?? p.images[0] ?? "",
    bogoEligible: (p.tags ?? []).includes("shop"),
    sizeOption,
    sizes,
    sizeApplies: letterSizes.length >= 3,
    variants,
  };
}

/* ── Size and stock ─────────────────────────────────────────────────── */

function sameSize(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase();
}

/** Sizes with at least one in-stock variant, in Shopify order. */
export function inStockSizes(item: LookItem): string[] {
  return item.sizes.filter((s) => item.variants.some((v) => v.inStock && v.size === s));
}

/**
 * Is the item buyable for this shopper? Letter-sized items must be in
 * stock in the vest size the shopper picked; anything else just needs one
 * in-stock variant.
 */
export function isAvailableFor(item: LookItem, vestSize?: string): boolean {
  if (item.sizeApplies && vestSize) {
    return item.variants.some((v) => v.inStock && sameSize(v.size, vestSize));
  }
  return item.variants.some((v) => v.inStock);
}

/** Default size for the item's select: the vest size where it applies. */
export function defaultLookSize(item: LookItem, vestSize?: string): string | undefined {
  if (!item.sizeOption) return undefined;
  const sizes = inStockSizes(item);
  if (item.sizeApplies && vestSize) {
    const match = sizes.find((s) => sameSize(s, vestSize));
    if (match) return match;
  }
  return sizes[0];
}

/** First in-stock variant for a size (or any in-stock variant without sizes). */
export function lookVariantFor(item: LookItem, size?: string): LookVariant | null {
  return (
    item.variants.find((v) => v.inStock && (!item.sizeOption || v.size === size)) ?? null
  );
}

/* ── Selection with fallback ────────────────────────────────────────── */

export interface LookPick {
  item: LookItem;
  /** 1-based slot position in the module. */
  position: number;
  source: "pairing" | "fallback";
  defaultSize?: string;
}

export interface SelectLookOptions {
  vestSize?: string;
  /** Slugs never to show (the PDP product, items already in the bag). */
  exclude?: string[];
  count?: number;
  /** Cart line: only BOGO15-eligible items qualify. */
  requireBogo?: boolean;
}

/**
 * Fill each pairing slot in order. If a paired item is missing, out of
 * stock in the selected size, or excluded, the slot falls back to the next
 * in-stock piece from the gift guide lists that is not already shown.
 */
export function selectCompleteLook(
  pairing: Array<LookItem | null | undefined>,
  fallbacks: LookItem[],
  { vestSize, exclude = [], count = COMPLETE_LOOK_COUNT, requireBogo = false }: SelectLookOptions = {}
): LookPick[] {
  const used = new Set(exclude);
  const ok = (item: LookItem | null | undefined): item is LookItem =>
    !!item && !used.has(item.slug) && (!requireBogo || item.bogoEligible) && isAvailableFor(item, vestSize);
  const picks: LookPick[] = [];
  let cursor = 0;
  const nextFallback = (): LookItem | null => {
    while (cursor < fallbacks.length) {
      const candidate = fallbacks[cursor++];
      if (ok(candidate)) return candidate;
    }
    return null;
  };
  const push = (item: LookItem, source: LookPick["source"]) => {
    used.add(item.slug);
    picks.push({ item, position: picks.length + 1, source, defaultSize: defaultLookSize(item, vestSize) });
  };
  // Slots: the configured pairing; an empty pairing still yields `count` slots.
  const slots = pairing.length ? pairing.slice(0, count) : Array.from({ length: count }, () => null);
  for (const slot of slots) {
    if (ok(slot)) { push(slot, "pairing"); continue; }
    const fb = nextFallback();
    if (fb) push(fb, "fallback");
  }
  return picks;
}

/* ── BOGO15 copy rules ──────────────────────────────────────────────── */

export const PDP_BOGO_LINE = "Add a second piece, save 15%.";
export const CART_BOGO_ONE_ITEM = "Add one more piece and save 15% on it";
export const CART_BOGO_APPLIED = "Second piece 15% off applied";

/**
 * Whether the PDP may show "Add a second piece, save 15%.": the vest and
 * every shown piece must be in Shop — All (BOGO15 buy and get collection),
 * and the shopper must not be on a member price, reward or other code,
 * because BOGO15 does not combine with those.
 */
export function pdpBogoLineApplies(
  vestEligible: boolean,
  picks: Array<Pick<LookPick, "item">>,
  suppressed = false
): boolean {
  return !suppressed && vestEligible && picks.length > 0 && picks.every((p) => p.item.bogoEligible);
}

/**
 * An applied code that BOGO15 does not combine with. BOGO15 combines with
 * shipping discounts, so the bag's first-order free shipping code
 * (FIRSTORDERSHIP, auto-added at $100+) must not hide the line.
 */
export function hasBogoBlockingCode(codes: Array<{ code: string; applicable: boolean }> = []): boolean {
  return codes.some(
    (c) => c.applicable && c.code.toUpperCase() !== BOGO15_CODE && !isFirstOrderShippingCode(c.code)
  );
}

export type CartBogoState = "hidden" | "one_item" | "applied";

export interface CartBogoInput {
  /** Cart lines with quantity and whether the product is BOGO15 eligible. */
  lines: Array<{ slug: string; quantity: number; eligible: boolean }>;
  /** Live dollars Shopify took off through BOGO15 (cart discount allocations). */
  bogoSaved: number;
  /** Member price, reward or another code on the cart. */
  suppressed?: boolean;
}

export function cartBogoState({ lines, bogoSaved, suppressed = false }: CartBogoInput): {
  state: CartBogoState;
  eligibleUnits: number;
  saved: number;
} {
  const eligibleUnits = lines.reduce((n, l) => n + (l.eligible ? Math.max(0, l.quantity) : 0), 0);
  const saved = Math.round(Math.max(0, bogoSaved) * 100) / 100;
  if (suppressed || eligibleUnits === 0) return { state: "hidden", eligibleUnits, saved };
  if (eligibleUnits === 1) return { state: "one_item", eligibleUnits, saved };
  // Never claim it applied unless Shopify actually allocated money.
  return { state: saved > 0 ? "applied" : "hidden", eligibleUnits, saved };
}

/** Sum the live BOGO15 allocations from the per-discount amounts on the cart. */
export function bogoSavedFromAllocations(amounts: Record<string, number> = {}): number {
  const total = Object.entries(amounts)
    .filter(([title]) => isBogoDiscount([title]) || title.toUpperCase() === BOGO15_CODE)
    .reduce((sum, [, amount]) => sum + (Number(amount) || 0), 0);
  return Math.round(total * 100) / 100;
}

/** Pull a letter size out of a cart variant title like "Highland Green / M". */
export function sizeFromVariantTitle(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const parts = title.split("/").map((s) => s.trim());
  return parts.find((p) => APPAREL_SIZES.has(p.toUpperCase()));
}

/** Comma-joined handles: the analytics route only accepts scalar properties. */
export function itemsProperty(picks: Array<Pick<LookPick, "item">>): string {
  return picks.map((p) => p.item.slug).join(",");
}
