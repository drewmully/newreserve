"use client";

import { useEffect, useRef, useState } from "react";

/**
 * PDP gallery.
 *
 * Mobile (< md): a horizontal CSS scroll-snap track, one image per view at
 * the same 3:4 object-cover crop as before, with a "1 / 5" counter and dots.
 * Paid traffic swiped the single hero image expecting more photos
 * ($dead_swipe in PostHog); the track gives that swipe somewhere to go.
 *
 * Desktop (md+): unchanged main image + thumbnail row.
 *
 * Every image opens the lightbox via onOpen(index). The parent remounts this
 * component with `key` when the color changes, which resets it to image 1.
 */
export function PdpGallery({
  images,
  name,
  onOpen,
  onFirstSwipe,
}: {
  images: string[];
  name: string;
  onOpen: (index: number) => void;
  /** Called once, the first time the shopper swipes to another image. */
  onFirstSwipe?: (index: number) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [slideIndex, setSlideIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const swiped = useRef(false);
  const frame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function onScroll() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = track.current;
      if (!el || !el.clientWidth) return;
      const index = Math.max(0, Math.min(images.length - 1, Math.round(el.scrollLeft / el.clientWidth)));
      setSlideIndex(index);
      if (index > 0 && !swiped.current) {
        swiped.current = true;
        onFirstSwipe?.(index);
      }
    });
  }

  function goTo(index: number) {
    const el = track.current;
    if (!el) return;
    el.scrollTo({
      left: index * el.clientWidth,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }

  const count = images.length;

  return (
    <>
      {/* Mobile: swipeable track */}
      <div className="relative mb-3 md:hidden" data-testid="pdp-gallery-mobile">
        <div
          ref={track}
          onScroll={onScroll}
          className="flex aspect-[3/4] snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-lg bg-cream [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="region"
          aria-roledescription="carousel"
          aria-label={`${name} photos`}
        >
          {images.map((src, i) => (
            <button
              key={`${src}-${i}`}
              type="button"
              onClick={() => onOpen(i)}
              className="relative h-full w-full shrink-0 snap-center snap-always cursor-zoom-in"
              aria-label={`Enlarge ${name} photo ${i + 1} of ${count}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={i === 0 ? name : `${name} image ${i + 1}`}
                className="h-full w-full object-cover"
                draggable={false}
                loading={i === 0 ? "eager" : "lazy"}
                fetchPriority={i === 0 ? "high" : "auto"}
                decoding={i === 0 ? "sync" : "async"}
              />
            </button>
          ))}
        </div>
        {count > 1 && (
          <>
            <span
              className="pointer-events-none absolute right-3 top-3 rounded-full bg-bone/90 px-2.5 py-1 font-mono text-[10px] tracking-[0.12em] text-charcoal/80 shadow-sm"
              aria-live="polite"
            >
              {slideIndex + 1} / {count}
            </span>
            <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5" aria-hidden="true">
              {images.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  tabIndex={-1}
                  onClick={() => goTo(i)}
                  className={`h-1.5 rounded-full transition-all duration-200 ${
                    i === slideIndex ? "w-4 bg-charcoal/70" : "w-1.5 bg-charcoal/25"
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Desktop: main image + thumbnails, as before */}
      <div className="hidden md:block">
        <button
          type="button"
          className="mb-3 block aspect-[3/4] w-full cursor-zoom-in overflow-hidden rounded-lg bg-cream"
          onClick={() => onOpen(activeIndex)}
          aria-label={`Enlarge ${name} photo ${activeIndex + 1} of ${count}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={images[activeIndex]}
            alt={name}
            className="h-full w-full object-cover"
            draggable={false}
          />
        </button>

        {count > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {images.map((img, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setActiveIndex(i)}
                aria-label={`Show ${name} photo ${i + 1}`}
                aria-pressed={activeIndex === i}
                className={`h-24 w-20 shrink-0 cursor-pointer overflow-hidden rounded border-2 transition-all duration-200 ${
                  activeIndex === i
                    ? "border-forest"
                    : "border-transparent opacity-60 hover:opacity-100"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img} alt="" className="h-full w-full object-cover" draggable={false} loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
