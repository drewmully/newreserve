/**
 * Swatch colors for card dots. Keys are lowercase color tokens as they appear
 * in Shopify option values; multi-tone values ("Snow White / Sparrow") render
 * as split dots. Unknown names fall back to a neutral gray.
 */
const SWATCH_HEX: Record<string, string> = {
  "brandy brown": "#8a3a26", "fossil gray": "#8d8a84", "deep navy": "#1c2538",
  pine: "#2f4a3a", brown: "#6b4f3a", navy: "#1f2a44", "true navy": "#1d2840",
  "highland green": "#3b4a3a", sand: "#d8cdb9", khaki: "#c3ab82", "light khaki": "#cfc3a6",
  "smokey olive": "#6b6a4f", "pure black": "#1c1c1c", black: "#1c1c1c",
  stone: "#cfc8b8", "ultimate grey": "#9a9b9c", "snow white": "#f4f3ef",
  sparrow: "#7d5a55", "ghost gray": "#b9bcbf", oceana: "#2b3f63",
  "dark slate": "#2f343b", "light gray": "#c9cacc", "windward blue": "#9fb6cf",
  blue: "#5b7aa6", cotton: "#f1ede4", white: "#f7f7f5",
  "red stripes": "#b0353a", "blue stripes": "#2f5a9a", "green stripes": "#2f6a45",
};

export function swatchBackground(color: string): string {
  const parts = color.split("/").map((p) => p.trim().toLowerCase()).filter(Boolean);
  const hexes = parts.map((p) => SWATCH_HEX[p] ?? "#a9a6a0");
  if (hexes.length <= 1) return hexes[0] ?? "#a9a6a0";
  const step = 100 / hexes.length;
  return `linear-gradient(135deg, ${hexes
    .map((h, i) => `${h} ${Math.round(i * step)}% ${Math.round((i + 1) * step)}%`)
    .join(", ")})`;
}
