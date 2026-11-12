/**
 * Homepage hero test: home_hero_dual.
 *
 * Control is the current "The {Season} Edit" hero. The dual arm shows two
 * equal cards (Shop the edit, Mully Reserve quarterly) so retail and
 * Reserve both have a clear path from the homepage.
 *
 * Server HTML always renders control (the dual markup ships `hidden`), so
 * Googlebot, no-JS visitors and anyone PostHog cannot bucket see the
 * current page. The arm is resolved on the client from the PostHog flag,
 * which is sticky per distinct_id. The resolved arm is stored locally and
 * forwarded as the `ab_home_hero` cart attribute so purchases can be split
 * by arm in the orders-paid webhook.
 *
 * If dual wins: make it the server default, delete the flag, and render the
 * dual headline as the page's <h1> so Google indexes it (same as #355).
 */

export const HOME_HERO_FLAG = "home-hero-dual";
export type HomeHeroVariant = "control" | "dual";

/** localStorage key holding the last resolved arm (read at cart time). */
export const HOME_HERO_STORAGE_KEY = "mully_home_hero";
/** Cart attribute key that carries the arm to the Shopify order. */
export const HOME_HERO_CART_ATTR = "ab_home_hero";
/** QA override: ?hh=dual | ?hh=control, ?hh=off clears it. */
export const HOME_HERO_OVERRIDE_PARAM = "hh";

/**
 * Dual-arm headline. SEO / GEO approved the new headline for the variant
 * (2026-11-11). Set to false to keep the current headline inside the dual
 * layout.
 */
export const HOME_HERO_USE_NEW_H1 = true;
export const HOME_HERO_NEW_H1 = "Better golf clothes.";

export function homeHeroHeadline(season: string): string {
  if (HOME_HERO_USE_NEW_H1) return HOME_HERO_NEW_H1;
  return `The ${season.charAt(0).toUpperCase() + season.slice(1)} Edit`;
}

/** Real Shopify packshots, trimmed to the same scale (public/home-hero). */
export const HOME_HERO_SHOP_IMAGES = [
  { src: "/home-hero/ponte-vest.webp", alt: "Olydoe Merino Ponte Vest" },
  { src: "/home-hero/fremont-vest.webp", alt: "Duck Head Fremont Sport Performance Quilted Vest" },
] as const;

export const HOME_HERO_RESERVE_IMAGES = [
  { src: "/home-hero/bristol-sweater.webp", alt: "Quiet Golf Bristol Polo Sweater" },
  { src: "/home-hero/remy-polo.webp", alt: "Quiet Golf Remy Polo" },
  { src: "/home-hero/gold-school-chino.webp", alt: "Duck Head Gold School Chino" },
  { src: "/home-hero/stretch-belt.webp", alt: "Duck Head Stretch Belt" },
] as const;

export function isHomeHeroVariant(value: unknown): value is HomeHeroVariant {
  return value === "control" || value === "dual";
}

/** Formats a Shopify money amount for the hero ("$250", "$249.50"). */
export function formatHeroPrice(amount: string | number | null | undefined): string | null {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/** Last resolved arm, or null. Safe to call during SSR. */
export function readStoredHomeHeroVariant(): HomeHeroVariant | null {
  try {
    if (typeof window === "undefined") return null;
    const v = window.localStorage.getItem(HOME_HERO_STORAGE_KEY);
    return isHomeHeroVariant(v) ? v : null;
  } catch {
    return null;
  }
}

export function storeHomeHeroVariant(variant: HomeHeroVariant): void {
  try {
    window.localStorage.setItem(HOME_HERO_STORAGE_KEY, variant);
  } catch {
    // Storage can be blocked; attribution is best effort.
  }
}
