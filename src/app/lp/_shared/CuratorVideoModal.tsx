"use client";

/**
 * CuratorVideoModal — small thumbnail link that opens a focus-trapped
 * in-page lightbox playing the YouTube video inline. Privacy-friendly
 * (youtube-nocookie), no autoplay until the user clicks, no related-video
 * exit ramps where the embed API allows. Does NOT navigate the user away
 * to youtube.com.
 *
 * a11y:
 *   - Role dialog with aria-modal + aria-labelledby.
 *   - Escape key closes.
 *   - Click on backdrop closes.
 *   - Close button is the initial focus target on open.
 *   - Body scroll locked while open.
 *
 * Analytics:
 *   - Fires `curator_video_opened` once per open via shared trackEvent.
 *     Uses includeAuth:false since LP is anonymous.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { trackEvent } from "@/lib/tracking";

const YT_THUMB = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

export function CuratorVideoModal({ videoId }: { videoId: string }) {
  const [open, setOpen] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const onOpen = useCallback(() => {
    setOpen(true);
    trackEvent(
      "curator_video_opened",
      { properties: { videoId, source: "lp_curator_strip" } },
      { includeAuth: false }
    ).catch(() => {});
  }, [videoId]);

  const onClose = useCallback(() => {
    setOpen(false);
  }, []);

  // Esc to close + body scroll lock while open. Restore focus on close.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);

    // Focus the close button on open for keyboard users.
    const t = window.setTimeout(() => closeBtnRef.current?.focus(), 0);

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(t);
      // Restore focus to the trigger so screen readers don't lose place.
      triggerRef.current?.focus();
    };
  }, [open, onClose]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={onOpen}
        className="group inline-flex items-center gap-3 rounded-md border border-forest/15 bg-bone-dark/40 px-3 py-2 text-left transition hover:border-forest/30 hover:bg-bone-dark/60 focus:outline-none focus:ring-2 focus:ring-ember/60"
        aria-haspopup="dialog"
      >
        <span className="relative block h-12 w-20 flex-shrink-0 overflow-hidden rounded-sm bg-forest/10 sm:h-14 sm:w-24">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={YT_THUMB(videoId)}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover"
            loading="lazy"
          />
          {/* Play glyph overlay */}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-bone/90 shadow-sm transition group-hover:bg-bone sm:h-8 sm:w-8">
              <svg viewBox="0 0 24 24" className="ml-0.5 h-3.5 w-3.5 text-forest" aria-hidden="true">
                <path d="M8 5v14l11-7z" fill="currentColor" />
              </svg>
            </span>
          </span>
        </span>
        <span className="text-sm font-medium text-forest sm:text-base">
          Watch Drew break down a recent edit{" "}
          <span aria-hidden="true" className="text-ember">&rarr;</span>
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="curator-video-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/80 px-4 py-6 backdrop-blur-sm"
          onMouseDown={(e) => {
            // Only close when the backdrop itself is clicked, not when a
            // mousedown started inside the dialog and drifted outward.
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className="relative w-full max-w-4xl">
            <div className="mb-3 flex items-center justify-between">
              <h3
                id="curator-video-title"
                className="font-serif text-base text-bone sm:text-lg"
              >
                Drew on a recent edit
              </h3>
              <button
                ref={closeBtnRef}
                type="button"
                onClick={onClose}
                aria-label="Close video"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-bone/10 text-bone transition hover:bg-bone/20 focus:outline-none focus:ring-2 focus:ring-ember"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black shadow-2xl">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
                title="Drew breaks down a recent Reserve edit"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 h-full w-full border-0"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
