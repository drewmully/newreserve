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
  eyebrow: "The fall edit",
  headline: ["Golf apparel and gear.", "Selected by Mully."],
  heroImage: "/shop-redesign/hero-rhone.jpg",
  // Espresso is the shop's persistent brand accent.
  accent: "#4A3528",
  accentDark: "#34251C",
  // Camel deepened toward tobacco (source #C19A6B → #B08558).
  secondary: "#B08558",
  heroOverlay: "#1A2438", // navy, deepened from source #1F2A44
  layerPalette: [
    { name: "Cream", hex: "#EDE6D6", role: "base" },
    { name: "Camel", hex: "#B08558", role: "mid" },
    { name: "Olive", hex: "#5F6431", role: "mid" },
    { name: "Taupe", hex: "#9B8B7A", role: "mid" },
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

export interface SeasonalHero {
  desktop: string;
  mobile: string;
  alt: string;
  /** Torso anchor (0..1 of natural image) for the "Shop the look" hotspot. */
  hotspot: { desktop: { x: number; y: number }; mobile: { x: number; y: number } };
}

export interface ShopSeasonPresentation {
  /** Word used in "The {Edit} Edit" headings, e.g. "holiday" or "winter". */
  editName: string;
  hero: SeasonalHero;
  /** Announcement bar background. */
  barColor: string;
  /** Thin colorway strip under the hero (CSS gradient). */
  colorwayStrip: string;
  /** Outfit builder heading, e.g. "Built for the frost delay." */
  outfitHeading: string;
}

const FALL_HERO: SeasonalHero = {
  desktop: "/shop-redesign/lifestyle/fall-fairway-vest-desktop.webp",
  mobile: "/shop-redesign/lifestyle/fall-fairway-vest-mobile.webp",
  alt: "AI-styled editorial scene of a distant golfer wearing a brown quilted vest over a striped polo with tailored khakis on a foggy autumn fairway",
  hotspot: { desktop: { x: 0.695, y: 0.625 }, mobile: { x: 0.659, y: 0.625 } },
};

const WINTER_HERO: SeasonalHero = {
  desktop: "/shop-redesign/lifestyle/winter-frost-vest-desktop.webp",
  mobile: "/shop-redesign/lifestyle/winter-frost-vest-mobile.webp",
  alt: "AI-styled editorial scene of a distant golfer wearing a black quilted down vest over a white long-sleeve polo and stone trousers on a frosted, foggy winter fairway",
  hotspot: { desktop: { x: 0.699, y: 0.612 }, mobile: { x: 0.66, y: 0.612 } },
};

const FALL_STRIP = "linear-gradient(90deg,#ede6d6 0%,#ede6d6 16%,#b08558 30%,#b08558 35%,#5b613f 49%,#5b613f 59%,#9b8b7a 74%,#4a3528 92%,#4a3528 100%)";
// Frost, slate, evergreen, cranberry, espresso: winter layers keyed to the catalog.
const WINTER_STRIP = "linear-gradient(90deg,#e9ecec 0%,#e9ecec 16%,#8fa3ad 30%,#8fa3ad 35%,#1f3a2e 49%,#1f3a2e 59%,#6e1f2a 74%,#4a3528 92%,#4a3528 100%)";

const PRESENTATION: Record<"fall" | "holiday" | "winter" | "spring" | "summer", ShopSeasonPresentation> = {
  fall: { editName: "fall", hero: FALL_HERO, barColor: "#5B613F", colorwayStrip: FALL_STRIP, outfitHeading: "Your fall outfit, for less." },
  holiday: { editName: "holiday", hero: WINTER_HERO, barColor: "#1F3A2E", colorwayStrip: WINTER_STRIP, outfitHeading: "Built for the frost delay." },
  winter: { editName: "winter", hero: WINTER_HERO, barColor: "#1F3A2E", colorwayStrip: WINTER_STRIP, outfitHeading: "Built for the frost delay." },
  spring: { editName: "spring", hero: FALL_HERO, barColor: "#5B613F", colorwayStrip: FALL_STRIP, outfitHeading: "Your spring outfit, for less." },
  summer: { editName: "summer", hero: FALL_HERO, barColor: "#5B613F", colorwayStrip: FALL_STRIP, outfitHeading: "Your summer outfit, for less." },
};

export type ShopPhase = keyof typeof PRESENTATION;
const PHASES = Object.keys(PRESENTATION) as ShopPhase[];

/**
 * Pick the shop presentation phase. Holiday runs Nov 26 through Dec 25,
 * winter Dec 26 through February. `NEXT_PUBLIC_SHOP_SEASON` (any phase key) overrides
 * the calendar for QA or an early switch. Dates use America/New_York.
 */
export function getShopPhase(now: Date = new Date(), override = process.env.NEXT_PUBLIC_SHOP_SEASON): ShopPhase {
  const forced = override?.trim().toLowerCase();
  if (forced && (PHASES as string[]).includes(forced)) return forced as ShopPhase;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric" }).formatToParts(now);
  const month = Number(parts.find(p => p.type === "month")?.value) - 1;
  const day = Number(parts.find(p => p.type === "day")?.value);
  if ((month === 10 && day >= 26) || (month === 11 && day <= 25)) return "holiday";
  if (month === 11 || month <= 1) return "winter";
  if (month >= 8 && month <= 10) return "fall";
  return month >= 2 && month <= 4 ? "spring" : "summer";
}

export function getShopPresentation(now: Date = new Date(), override?: string): ShopSeasonPresentation {
  return PRESENTATION[getShopPhase(now, override ?? process.env.NEXT_PUBLIC_SHOP_SEASON)];
}

/**
 * Pick the theme for a given Date. Season follows the shop phase (holiday
 * counts as winter for palette purposes). The shop accent stays espresso
 * year round; the seasonal change lives in the hero, bar, strip and copy.
 */
export function getSeasonalTheme(now: Date = new Date()): SeasonalTheme {
  const phase = getShopPhase(now);
  const seasonal = phase === "holiday" || phase === "winter" ? WINTER_THEME
    : phase === "fall" ? FALL_THEME : phase === "spring" ? SPRING_THEME : SUMMER_THEME;
  return { ...seasonal, accent: "#4A3528", accentDark: "#34251C",
    headline: FALL_THEME.headline, heroImage: FALL_THEME.heroImage };
}
