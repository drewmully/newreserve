/**
 * BOGO15 cart nudge: discount-code policy plus "pairs well with" picks.
 *
 * BOGO15 = buy one shop item, get 15% off one more. It runs as a Shopify
 * automatic discount ("Buy 2, save 15% on one item") with a matching BOGO15
 * code. Shopify discounts the lower-priced qualifying item.
 *
 * Picks cycle so every eligible piece gets exposure, while complements of
 * what is already in the bag rank first:
 *   1. Complement fit: vest in bag -> tops and bottoms first, and so on.
 *   2. Merchandiser pin: Shopify tag `cart-pick` keeps a product in slot 1.
 *      Tag `cart-pick-exclude` keeps one out.
 *   3. Fatigue: picks a shopper has seen repeatedly without tapping sink.
 *   4. Rotation: each cart open shows the next window of the ranked list.
 */

export const BOGO15_CODE = "BOGO15";
export const BOGO15_RATE = 0.15;

export type PickCategory = "outerwear" | "tops" | "bottoms" | "gear";

export interface CartPickVariant {
  id: string;
  title: string;
  price: number;
  available: boolean;
  options: Record<string, string>;
}

export interface CartPickProduct {
  slug: string;
  name: string;
  brand: string;
  image?: string;
  price: number;
  category: PickCategory;
  pinned: boolean;
  featured: boolean;
  /** Option names the shopper must choose in the cart (Color and/or Size). */
  choiceOptions: Array<{ name: string; values: string[] }>;
  /** False when the product needs more than one fit choice (waist + inseam). */
  quickAdd: boolean;
  variants: CartPickVariant[];
}

export interface PickFatigue {
  [slug: string]: { seen: number; clicked: number };
}

/* ── Offer detection ──────────────────────────────────────────────────── */

/**
 * The 2+ item offer runs as a Shopify automatic discount titled
 * "Buy 2, save 15% on one item"; the BOGO15 code is the same offer for
 * shoppers who type it. Either one counts as BOGO15 being live on the bag.
 */
export function isBogoDiscount(
  labels: string[] = [],
  codes: Array<{ code: string; applicable: boolean }> = []
): boolean {
  return (
    labels.some((l) => /buy\s*2.*15%|bogo\s*15/i.test(l)) ||
    codes.some((c) => c.applicable && c.code.toUpperCase() === BOGO15_CODE)
  );
}

/** 15% of the lower-priced of the two pieces, rounded to cents. */
export function bogoSavings(cartItemPrice: number, pickPrice: number): number {
  const base = Math.min(cartItemPrice, pickPrice);
  return Math.round(base * BOGO15_RATE * 100) / 100;
}

/* ── Catalog mapping ──────────────────────────────────────────────────── */

export function categoryFromTags(tags: string[] = []): PickCategory | null {
  if (tags.includes("shop-outerwear")) return "outerwear";
  if (tags.includes("shop-tops")) return "tops";
  if (tags.includes("shop-bottoms")) return "bottoms";
  if (tags.some((t) => t === "shop-accessories" || t === "shop-gear" || t === "shop-bags")) return "gear";
  return null;
}

interface SourceProduct {
  slug: string;
  name: string;
  brand: string;
  tags?: string[];
  image?: string;
  options: Array<{ name: string; values: string[] }>;
  variants: Array<{
    id: string;
    title: string;
    price: number;
    availableForSale: boolean;
    selectedOptions: Array<{ name: string; value: string }>;
  }>;
}

/** Lean, cart-ready shape. Null for anything BOGO15 can't apply to. */
export function toCartPickProduct(p: SourceProduct): CartPickProduct | null {
  const tags = p.tags ?? [];
  if (!tags.includes("shop") || tags.includes("cart-pick-exclude")) return null;
  const category = categoryFromTags(tags);
  if (!category) return null;
  const variants = p.variants
    .filter((v) => v.availableForSale)
    .map((v) => ({
      id: v.id,
      title: v.title,
      price: v.price,
      available: true,
      options: Object.fromEntries(v.selectedOptions.map((o) => [o.name, o.value])),
    }));
  if (!variants.length) return null;
  const choiceOptions = p.options.filter(
    (o) => o.values.length > 1 && !/^title$/i.test(o.name)
  );
  const fitChoices = choiceOptions.filter((o) => !/^colou?r$/i.test(o.name));
  return {
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    image: p.image,
    price: Math.min(...variants.map((v) => v.price)),
    category,
    pinned: tags.includes("cart-pick"),
    featured: tags.includes("shop-featured"),
    choiceOptions,
    quickAdd: fitChoices.length <= 1,
    variants,
  };
}

/* ── Ranking and rotation ─────────────────────────────────────────────── */

const COMPLEMENTS: Record<PickCategory, Record<PickCategory, number>> = {
  outerwear: { tops: 3, bottoms: 3, gear: 1, outerwear: 0 },
  tops: { bottoms: 3, outerwear: 3, gear: 1, tops: 0 },
  bottoms: { tops: 3, outerwear: 3, gear: 2, bottoms: 0 },
  gear: { tops: 2, outerwear: 2, bottoms: 1, gear: 0 },
};

/** Stable small hash so ties don't always resolve alphabetically. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function scorePick(
  p: CartPickProduct,
  anchors: CartPickProduct[],
  fatigue: PickFatigue
): number {
  const fit = anchors.length
    ? Math.max(...anchors.map((a) => COMPLEMENTS[a.category][p.category]))
    : 1;
  const anchorTop = anchors.length ? Math.max(...anchors.map((a) => a.price)) : Infinity;
  const f = fatigue[p.slug];
  const ignored = f ? Math.max(0, f.seen - f.clicked * 3) : 0;
  return (
    fit * 10 +
    (p.featured ? 3 : 0) +
    // The cheaper piece gets the 15%, and a smaller second ticket is an easier yes.
    (p.price <= anchorTop ? 4 : 0) +
    (p.price <= 130 ? 2 : 0) -
    Math.min(6, Math.floor(ignored / 2) * 2)
  );
}

/**
 * Pick `count` products for the nudge. Pinned products hold slot 1; the
 * rest rotate through a window of the top-ranked complements, at most two
 * per category so the row doesn't show three polos.
 */
export function selectCartPicks(
  catalog: CartPickProduct[],
  cartSlugs: string[],
  opts: { fatigue?: PickFatigue; rotation?: number; count?: number; window?: number } = {}
): CartPickProduct[] {
  const count = opts.count ?? 3;
  const windowSize = opts.window ?? 9;
  const fatigue = opts.fatigue ?? {};
  const inCart = new Set(cartSlugs);
  const anchors = catalog.filter((p) => inCart.has(p.slug));
  const pool = catalog.filter((p) => !inCart.has(p.slug));
  if (!pool.length) return [];

  const ranked = pool
    .map((p) => ({ p, s: scorePick(p, anchors, fatigue) }))
    .sort((a, b) => b.s - a.s || hash(a.p.slug) - hash(b.p.slug))
    .map((x) => x.p);

  const pinned = ranked.filter((p) => p.pinned).slice(0, 1);
  const rest = ranked.filter((p) => !pinned.includes(p)).slice(0, windowSize);
  const start = rest.length ? ((opts.rotation ?? 0) * count) % rest.length : 0;
  const rotated = [...rest.slice(start), ...rest.slice(0, start)];

  const out = [...pinned];
  const perCategory: Partial<Record<PickCategory, number>> = {};
  for (const p of out) perCategory[p.category] = (perCategory[p.category] ?? 0) + 1;
  for (const p of rotated) {
    if (out.length >= count) break;
    if ((perCategory[p.category] ?? 0) >= 2) continue;
    out.push(p);
    perCategory[p.category] = (perCategory[p.category] ?? 0) + 1;
  }
  // Backfill if diversity rules left gaps.
  for (const p of rotated) {
    if (out.length >= count) break;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** Variant matching the chosen options, or the only available one. */
export function resolveVariant(
  p: CartPickProduct,
  chosen: Record<string, string>
): CartPickVariant | null {
  const needed = p.choiceOptions.map((o) => o.name);
  if (needed.some((n) => !chosen[n])) {
    return p.variants.length === 1 ? p.variants[0] : null;
  }
  return p.variants.find((v) => needed.every((n) => v.options[n] === chosen[n])) ?? null;
}
