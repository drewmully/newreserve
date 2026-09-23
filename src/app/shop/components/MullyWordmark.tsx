/**
 * The Mully Shop wordmark.
 *
 * Deliberately different from the parent-site `mully.` lockup: no
 * bird-of-prey glyph, just the wordmark. The period is the only tinted
 * glyph, and its color is driven by the seasonal theme — so the same
 * mark reads burgundy in fall, navy in winter, and so on. This is the
 * shop's version of the seasonal Google doodle.
 *
 * `tone` switches the letter color for use on dark hero backgrounds. The
 * accent-colored period always keeps its brand color for continuity.
 */
export function MullyWordmark({
  accent,
  className = "",
  tone = "dark",
}: {
  /** Hex color for the period only. Everything else follows `tone`. */
  accent: string;
  className?: string;
  /** "dark" = charcoal letters (default), "light" = white letters. */
  tone?: "dark" | "light";
}) {
  const letterColor = tone === "light" ? "text-white" : "text-charcoal";
  return (
    <span
      className={`font-serif tracking-tight ${letterColor} ${className}`}
      style={{ fontWeight: 700 }}
    >
      mully<span style={{ color: accent }}>.</span>
    </span>
  );
}
