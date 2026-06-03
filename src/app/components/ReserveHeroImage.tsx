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
  /** Crop tighter on apparel by scaling the contained image up and shifting
   *  the object-position so the small package element at the bottom of
   *  reserve-flatlay-hero.webp moves below the visible frame. Default false
   *  to preserve homepage usage; opt-in on the LP hero. */
  tightCrop = false,
  /** Art-direction overrides. When provided, the component renders a
   *  native <picture> element with <source media="..."> entries so each
   *  viewport gets the asset shot for its aspect ratio. SSR-perfect,
   *  no JS, no layout shift. Only applies to treatment="default". */
  mobileSrc,
  tabletSrc,
}: {
  src: string;
  alt: string;
  treatment?: "default" | "flatlay";
  sizes?: string;
  priority?: boolean;
  caption?: string;
  unoptimized?: boolean;
  tightCrop?: boolean;
  mobileSrc?: string;
  tabletSrc?: string;
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
            background already keyed out to transparency.
            tightCrop: scale up + nudge upward so the small package element at
            the very bottom of the source asset drops below the visible frame.
            We never alter pixels; this is pure CSS framing. */}
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes ?? "(min-width: 1024px) 36rem, (min-width: 768px) 32rem, 100vw"}
          className={
            tightCrop
              ? "object-contain"
              : "object-contain object-bottom"
          }
          style={
            tightCrop
              ? {
                  // Scale up and anchor higher in the frame so the
                  // bottom 18% of the source (which contains the package
                  // element) is pushed below the visible card.
                  transform: "scale(1.18)",
                  transformOrigin: "50% 28%",
                }
              : undefined
          }
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

  // When art-direction sources are supplied, render a native <picture>.
  // We bypass next/image here because next/image doesn't expose the
  // <source media="..."> API — it only varies by srcset density/width.
  // For aspect-ratio-driven art direction, <picture> is the correct tool.
  if (mobileSrc || tabletSrc) {
    return (
      <picture className="absolute inset-0 block h-full w-full">
        {/* Mobile: portrait viewport — use the 4:5 portrait shot. */}
        {mobileSrc && (
          <source media="(max-width: 639px)" srcSet={mobileSrc} />
        )}
        {/* Tablet (sm): landscape-ish container — use the 4:3 landscape shot. */}
        {tabletSrc && (
          <source
            media="(min-width: 640px) and (max-width: 1023px)"
            srcSet={tabletSrc}
          />
        )}
        {/* Desktop (lg+) falls through to the base src. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </picture>
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
