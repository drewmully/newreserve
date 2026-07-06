/**
 * Editorial masthead — celebrates Mully's 8th year.
 *
 * Modeled on the Uncrate 20 masthead (uncrate.com): the wordmark set
 * over a giant numeral watermark, with a small "YEARS" caption. Pure
 * typography, server-rendered, no JavaScript. This is a magazine cover,
 * not a product carousel.
 *
 * The "8" is a background element — the `mully` wordmark sits on top,
 * with the tail of the `y` running through the counter of the 8 so the
 * two shapes lock together rather than sit next to each other.
 *
 * Sizes:
 *  - The wordmark scales fluidly (clamp) so it reads confidently on
 *    phone, tablet, and desktop.
 *  - The "8" is roughly 1.7x the wordmark height and centered behind.
 *  - "YEARS" is small caps, tracked wide, sitting under the right edge
 *    of the 8 (matching Uncrate).
 */

interface EditorialMastheadProps {
  /** Number of years to display in the watermark. Default 8. */
  years?: number;
}

export function EditorialMasthead({ years = 8 }: EditorialMastheadProps) {
  return (
    <section
      aria-label={`Mully — celebrating ${years} years`}
      className="relative bg-forest text-bone border-b border-forest overflow-hidden"
    >
      {/* Height reduced ~40% from original masthead. Vertical padding,
          watermark size, wordmark size, and subhead gap all trimmed. */}
      <div className="max-w-6xl mx-auto px-6 md:px-10 pt-8 md:pt-12 pb-6 md:pb-8">
        {/* Wordmark + watermark stack.
            The wrapper is inline-block so its width tracks the wordmark
            width, keeping the watermark visually anchored to the mark. */}
        <div className="relative flex justify-center">
          <div className="relative inline-block leading-none">
            {/* Watermark "8" — sits behind the wordmark. Uses currentColor
                so it inherits the section text color, then knocks its
                opacity down for the parchment/gold impression. */}
            <span
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[52%] font-serif font-black leading-none text-[#B08D57]/70 select-none"
              style={{
                fontSize: "clamp(108px, 20vw, 276px)",
                letterSpacing: "-0.04em",
              }}
            >
              {years}
            </span>

            {/* Wordmark on top. Playfair Display, low case, tight tracking. */}
            <h1
              className="relative font-serif font-bold leading-none tracking-[-0.03em] text-bone"
              style={{ fontSize: "clamp(44px, 9vw, 120px)" }}
            >
              mully
              <span className="text-[#B08D57]">.</span>
            </h1>
          </div>
        </div>

        {/* YEARS caption — small caps, wide track, offset right like Uncrate. */}
        <div className="mt-2 md:mt-3 flex justify-center">
          <div className="relative w-full max-w-[520px]">
            <span
              className="absolute right-2 md:right-6 -top-3 md:-top-6 text-[10px] md:text-[12px] tracking-[0.42em] uppercase text-bone/60"
              aria-hidden
            >
              Years
            </span>
          </div>
        </div>

        {/* Subhead + eyebrow */}
        <div className="mt-6 md:mt-8 text-center max-w-2xl mx-auto">
          <p className="text-[10px] tracking-[0.3em] uppercase text-bone/50 mb-3">
            The Shelf &nbsp;·&nbsp; Curated by Mully
          </p>
          <p className="font-serif italic text-xl md:text-2xl text-bone leading-[1.25]">
            Eight years of finding the golf goods{" "}
            <span className="text-[#D9B786]">most golfers</span> haven't
            found yet.
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * Backwards-compat alias. The page.tsx still imports `Mully8Hero`; keep
 * it exported so we don't have to touch the page. If you clean this up
 * later, swap the import name over there instead.
 */
export { EditorialMasthead as Mully8Hero };
