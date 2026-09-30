/** Coordinates refer to the original photo, not its cropped CSS box. */
export const SHOP_HERO_HOTSPOTS = [
  {
    slug: "quiet-golf-remy-polo-active-pique",
    label: "Quiet Golf Polo",
    desktop: { x: .70, y: .43 },
    mobile: { x: .61, y: .29 },
  },
  {
    slug: "duckhead-classic-fit-gold-school-chino-khaki",
    label: "Duckhead Chinos",
    desktop: { x: .755, y: .66 },
    mobile: { x: .69, y: .54 },
  },
] as const;

export function projectHeroPoint({
  width, height, naturalWidth, naturalHeight, point,
  positionX = .5, positionY = .5,
}: {
  width: number; height: number; naturalWidth: number; naturalHeight: number;
  point: { x: number; y: number }; positionX?: number; positionY?: number;
}): { x: number; y: number } | null {
  if (![width, height, naturalWidth, naturalHeight].every(n => Number.isFinite(n) && n > 0)) return null;
  const scale = Math.max(width / naturalWidth, height / naturalHeight);
  const renderedWidth = naturalWidth * scale;
  const renderedHeight = naturalHeight * scale;
  const x = point.x * renderedWidth + (width - renderedWidth) * positionX;
  const y = point.y * renderedHeight + (height - renderedHeight) * positionY;
  // Never detach a marker from its garment by clamping it to an image edge.
  return x >= 22 && x <= width - 22 && y >= 22 && y <= height - 22 ? { x, y } : null;
}
