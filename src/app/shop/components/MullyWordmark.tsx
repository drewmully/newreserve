/**
 * The Mully Shop wordmark.
 *
 * Deliberately different from the parent-site `mully.` lockup: no
 * bird-of-prey glyph, just the wordmark. The period is the only tinted
 * glyph, and its color is driven by the seasonal theme — so the same
 * mark reads burgundy in fall, navy in winter, and so on. This is the
 * shop's version of the seasonal Google doodle.
 */
export function MullyWordmark({
  accent,
  className = "",
}: {
  /** Hex color for the period only. Everything else is charcoal. */
  accent: string;
  className?: string;
}) {
  return (
    <span
      className={`font-serif tracking-tight text-charcoal ${className}`}
      style={{ fontWeight: 700 }}
    >
      mully<span style={{ color: accent }}>.</span>
    </span>
  );
}
