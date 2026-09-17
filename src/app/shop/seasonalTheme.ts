/**
 * Shop seasonal theme system.
 *
 * The Mully Shop dissociates from the parent site's forest-green identity
 * to feel like its own brand that changes with the seasons — think of it
 * like Google's holiday doodles. The rest of mymully.com stays Mully-green,
 * but /shop wears a fresh coat four times a year.
 *
 * Each season defines:
 *  - a period-dot color (the only tinted glyph in the `mully.` wordmark)
 *  - a primary CTA color
 *  - a secondary CTA color
 *  - a hero eyebrow label
 *  - a hero headline (2-line)
 *  - a hero image path in /public/shop/
 *  - a "layering guide" chapter title with 8 numbered outfit references
 *
 * The palette is inspired by, but not a copy of, a 3rd-party fall layering
 * color guide by The Tuxedo Collective. We reuse the categorical idea of
 * base/mid/outer layers keyed to a small color set, and remix the exact
 * hex values (charcoal warmed toward espresso, camel pulled toward tobacco,
 * navy deepened) so nothing here is a pixel-for-pixel copy.
 */

export type SeasonKey = "fall" | "winter" | "spring" | "summer";

export interface SeasonalTheme {
  season: SeasonKey;
  /** Displayed on the eyebrow pill above the hero headline. */
  eyebrow: string;
  /** 2-line hero headline. Line 2 renders in the accent color. */
  headline: [string, string];
  /** Path in /public/shop/ (leading slash included). */
  heroImage: string;
  /** Hex color of the period in the `mully.` wordmark and the primary accent. */
  accent: string;
  /** Deeper variant of `accent` for hovers and darker backgrounds. */
  accentDark: string;
  /** Secondary accent — used for outer-CTA borders, chip strokes. */
  secondary: string;
  /** Left-side hero overlay tint. */
  heroOverlay: string;
  /**
   * The five layering-palette colors for the "Layer up" section. First is
   * always the base (against the skin), last is always the outer.
   */
  layerPalette: Array<{ name: string; hex: string; role: "base" | "mid" | "outer" }>;
  /**
   * Eight numbered outfits keyed to specific product categories in the
   * shop. Each outfit is a shoppable set of chip links.
   */
  outfits: Array<{
    number: string; // "NO. 1"
    title: string;
    palette: [string, string, string]; // outer, mid, base hex
    context: "on-course" | "clubhouse" | "either";
  }>;
}

const FALL_THEME: SeasonalTheme = {
  season: "fall",
  eyebrow: "Fall 2026 · The Layering Edit",
  headline: ["The layering edit.", "For a great fall season."],
  heroImage: "/shop/hero-fall-2026.jpg",
  // Burgundy pulled slightly warmer than the source guide (source #6E1E2B → #8A2432).
  accent: "#8A2432",
  accentDark: "#6E1E2B",
  // Camel deepened toward tobacco (source #C19A6B → #B08558).
  secondary: "#B08558",
  heroOverlay: "#1A2438", // navy, deepened from source #1F2A44
  layerPalette: [
    { name: "Cream", hex: "#EDE6D6", role: "base" },
    { name: "Camel", hex: "#B08558", role: "mid" },
    { name: "Olive", hex: "#5F6431", role: "mid" },
    { name: "Burgundy", hex: "#8A2432", role: "mid" },
    { name: "Espresso", hex: "#4A2A17", role: "outer" },
  ],
  outfits: [
    {
      number: "NO. 1",
      title: "The Dawn Patrol",
      palette: ["#1A2438", "#B08558", "#EDE6D6"], // outer, mid, base
      context: "on-course",
    },
    {
      number: "NO. 2",
      title: "The Members Nine",
      palette: ["#3B3B3B", "#1F4D38", "#8A8A85"],
      context: "on-course",
    },
    {
      number: "NO. 3",
      title: "The Long Fall",
      palette: ["#4A2A17", "#5F6431", "#EDE6D6"],
      context: "on-course",
    },
    {
      number: "NO. 4",
      title: "The 19th",
      palette: ["#3B3B3B", "#8A2432", "#EDE6D6"],
      context: "clubhouse",
    },
    {
      number: "NO. 5",
      title: "The Sunday Fitting",
      palette: ["#B08558", "#1A2438", "#8A8A85"],
      context: "clubhouse",
    },
    {
      number: "NO. 6",
      title: "The Range Session",
      palette: ["#4A2A17", "#1F4D38", "#EDE6D6"],
      context: "clubhouse",
    },
    {
      number: "NO. 7",
      title: "The Late Tee",
      palette: ["#3B3B3B", "#1A2438", "#B08558"],
      context: "either",
    },
    {
      number: "NO. 8",
      title: "The Off-Course",
      palette: ["#5F6431", "#8A8A85", "#EDE6D6"],
      context: "either",
    },
  ],
};

// Placeholder off-season themes; fall is the only one shipping today.
// Add real palettes here as each season approaches.
const WINTER_THEME: SeasonalTheme = {
  ...FALL_THEME,
  season: "winter",
  eyebrow: "Winter 2026 · The Cold Edit",
  headline: ["Play through", "the shorter days."],
  accent: "#1A2438", // navy takes the period
  accentDark: "#0F1626",
  secondary: "#3B3B3B",
};

const SPRING_THEME: SeasonalTheme = {
  ...FALL_THEME,
  season: "spring",
  eyebrow: "Spring 2027 · The First Round",
  headline: ["Fresh grass.", "New irons."],
  accent: "#1F4D38", // Mully forest for spring
  accentDark: "#153224",
  secondary: "#B08558",
};

const SUMMER_THEME: SeasonalTheme = {
  ...FALL_THEME,
  season: "summer",
  eyebrow: "Summer 2027 · The Long Days",
  headline: ["Tee off at six.", "Beers by seven."],
  accent: "#D4772C", // ember for summer
  accentDark: "#A85E20",
  secondary: "#1F4D38",
};

/**
 * Pick the theme for a given Date. Uses month boundaries (fall = Sep-Nov,
 * winter = Dec-Feb, spring = Mar-May, summer = Jun-Aug) so the swap
 * happens on the first of the month rather than the solstice, which is
 * easier to explain and QA.
 */
export function getSeasonalTheme(now: Date = new Date()): SeasonalTheme {
  const month = now.getMonth(); // 0..11
  if (month >= 8 && month <= 10) return FALL_THEME; // Sep, Oct, Nov
  if (month === 11 || month <= 1) return WINTER_THEME; // Dec, Jan, Feb
  if (month >= 2 && month <= 4) return SPRING_THEME; // Mar, Apr, May
  return SUMMER_THEME; // Jun, Jul, Aug
}
