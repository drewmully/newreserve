/**
 * Swatch colors for card dots, sampled from each color's product photo.
 * Keys are lowercase color tokens as they appear in Shopify option values;
 * multi-tone values ("Snow White / Sparrow") render as split dots.
 * PRODUCT_OVERRIDES handle names that mean something different for one
 * product (e.g. Randolph's "Navy" is a navy-and-white stripe).
 */
const SWATCH_HEX: Record<string, string> = {
  "brandy brown": "#7a2b1c", "fossil gray": "#655e5a", "deep navy": "#1e2533",
  pine: "#243429", brown: "#3a2c25", navy: "#212836", "true navy": "#1d2333",
  "highland green": "#34372b", sand: "#d6c4b9", khaki: "#b0a183", "light khaki": "#ddd5c3",
  "smokey olive": "#716959", "pure black": "#1f1f21", black: "#1d1f24",
  stone: "#cac4b7", "ultimate grey": "#a0a1a0", "snow white": "#f2f1ee",
  sparrow: "#7a6575", "ghost gray": "#a9aaab", oceana: "#34456b",
  "dark slate": "#34313a", "light gray": "#c6c7c7", "windward blue": "#a9bdd6",
  blue: "#6d8fbf", cotton: "#f3f1ec", white: "#f7f7f5",
  midnight: "#22304a", onyx: "#1b1919",
  "red stripes": "#a0423f", "blue stripes": "#3a4a78", "green stripes": "#3f6152",
};

const split = (...hexes: string[]) => {
  const step = 100 / hexes.length;
  return `linear-gradient(135deg, ${hexes
    .map((h, i) => `${h} ${Math.round(i * step)}% ${Math.round((i + 1) * step)}%`)
    .join(", ")})`;
};

const PRODUCT_OVERRIDES: Record<string, Record<string, string>> = {
  "quiet-golf-randolph-polo": { navy: split("#1f2236", "#f4f3ef"), pine: split("#2c4a3a", "#f4f3ef") },
  "olydoe-oxford-pique-polo": { "oceana / sparrow": split("#4b4a78", "#7a6575") },
  "olydoe-og-supima-hollow-polo": { "cotton / brown / blue": split("#f3f1ec", "#8a5a64", "#6d8fbf") },
  "primo-fairway-crew": { black: "#1c252d" },
};

export function swatchBackground(color: string, slug?: string): string {
  const key = color.trim().toLowerCase();
  const override = slug ? PRODUCT_OVERRIDES[slug]?.[key] : undefined;
  if (override) return override;
  const parts = key.split("/").map((p) => p.trim()).filter(Boolean);
  const hexes = parts.map((p) => SWATCH_HEX[p] ?? "#a9a6a0");
  if (hexes.length <= 1) return hexes[0] ?? "#a9a6a0";
  return split(...hexes);
}
