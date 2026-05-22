"use client";

import Image from "next/image";

/**
 * ReserveHeroImage
 *
 * Renders a hero image inside a container with a forest-dark backdrop.
 * Two visual treatments:
 *
 *   default  — full-bleed object-cover, used for shot-in-frame imagery
 *              (e.g. /reserve-founders-hero.jpg).
 *
 *   flatlay  — for cut-off-edge flat-lay shots that have transparent /
 *              white negative space at the top and clipped items at the
 *              left/right/bottom. We:
 *                1. fit with object-contain anchored bottom-center so the
 *                   turf hits the floor of the card,
 *                2. layer a forest-dark gradient on top to absorb the
 *                   transparent strip into the brand color,
 *                3. mask a soft radial vignette so cut-off items feather
 *                   into shadow at the edges instead of hard-clipping,
 *                4. drop a subtle editorial caption tag in the top
 *                   negative space so it reads as intentional whitespace.
 *
 * sizes & priority are passed through to next/image.
 */
export function ReserveHeroImage({
  src,
  alt,
  treatment = "default",
  sizes,
  priority,
  caption,
  unoptimized,
}: {
  src: string;
  alt: string;
  treatment?: "default" | "flatlay";
  sizes?: string;
  priority?: boolean;
  caption?: string;
  unoptimized?: boolean;
}) {
  if (treatment === "flatlay") {
    return (
      <>
        {/* Forest-dark base — owns the negative space behind the
            transparent areas of the flat-lay PNG (top strip + image
            corners) so the items appear to sit on a deep editorial
            backdrop instead of a stark white frame. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, #0f1f15 0%, #162b1e 38%, #1d3526 78%, #0d1a12 100%)",
          }}
          aria-hidden
        />

        {/* The flat-lay itself — contained, anchored to the bottom so the
            turf hits the floor of the card. Source PNG has the white
            background already keyed out to transparency. */}
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes ?? "(min-width: 1024px) 36rem, (min-width: 768px) 32rem, 100vw"}
          className="object-contain object-bottom"
          priority={priority}
          unoptimized={unoptimized}
        />

        {/* Side vignette — soft forest shadow on the far left/right so the
            items that clip out of frame feather into the backdrop instead
            of hard-cutting at the rounded corners. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 60%, transparent 60%, rgba(15,31,21,0.35) 85%, rgba(13,26,18,0.6) 100%)",
          }}
          aria-hidden
        />

        {/* Subtle gold-accented editorial tag in the top negative space —
            matches the "Mully Reserve" eyebrow style used in the headline,
            and signals to visitors that the empty top isn't an oversight. */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2.5 text-[10px] tracking-[0.38em] uppercase font-medium text-bone/80 whitespace-nowrap">
          <span className="w-8 h-px bg-bone/25" />
          <span className="gold-shimmer-text">{caption ?? "Inside The Reserve"}</span>
          <span className="w-8 h-px bg-bone/25" />
        </div>
      </>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes ?? "(min-width: 1024px) 36rem, (min-width: 768px) 32rem, 100vw"}
      className="object-cover"
      priority={priority}
      unoptimized={unoptimized}
    />
  );
}
