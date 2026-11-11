"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Full-screen PDP image viewer. Swipes on touch (CSS scroll-snap), arrow
 * buttons and the arrow keys on desktop, Esc or the close button to exit.
 * Body scroll is locked while open and focus returns to the opener.
 * Portaled to <body> with the top z-index so third-party widgets (support
 * chat) and the shop's overflow-clipped wrappers never sit over it.
 */
export function PdpLightbox({
  images,
  name,
  startIndex,
  onClose,
}: {
  images: string[];
  name: string;
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const track = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const frame = useRef(0);
  const count = images.length;

  const goTo = useCallback((next: number, smooth = true) => {
    const el = track.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(count - 1, next));
    el.scrollTo({
      left: clamped * el.clientWidth,
      behavior: smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "instant",
    });
    setIndex(clamped);
  }, [count]);

  // Jump to the tapped image before first paint.
  useLayoutEffect(() => {
    const el = track.current;
    if (el) el.scrollLeft = startIndex * el.clientWidth;
  }, [startIndex]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const html = document.documentElement;
    const prev = { body: document.body.style.overflow, html: html.style.overflow };
    document.body.style.overflow = "hidden";
    html.style.overflow = "hidden";
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prev.body;
      html.style.overflow = prev.html;
      cancelAnimationFrame(frame.current);
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); goTo(index + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); goTo(index - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, index, onClose]);

  function onScroll() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = track.current;
      if (!el || !el.clientWidth) return;
      setIndex(Math.max(0, Math.min(count - 1, Math.round(el.scrollLeft / el.clientWidth))));
    });
  }

  const arrow = "absolute top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-bone transition-colors duration-200 hover:bg-white/20 disabled:pointer-events-none disabled:opacity-0 md:flex";

  return createPortal(
    <div
      className="fixed inset-0 z-[2147483647] flex flex-col bg-obsidian"
      role="dialog"
      aria-modal="true"
      aria-label={`${name} photos`}
      data-testid="pdp-lightbox"
    >
      <div className="flex shrink-0 items-center justify-between p-4 md:p-6">
        <span className="font-mono text-[11px] tracking-[0.14em] text-bone/70" aria-live="polite">
          {index + 1} / {count}
        </span>
        <button
          ref={closeButton}
          type="button"
          onClick={onClose}
          aria-label="Close photos"
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-white/10 transition-colors duration-200 hover:bg-white/20"
        >
          <svg className="h-5 w-5 text-bone" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={track}
          onScroll={onScroll}
          className="flex h-full snap-x snap-mandatory overflow-x-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {images.map((src, i) => (
            <div
              key={`${src}-${i}`}
              className="flex h-full w-full shrink-0 snap-center snap-always items-center justify-center px-2 pb-6 md:px-20 md:pb-10"
              onClick={e => { if (e.target === e.currentTarget) onClose(); }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`${name} image ${i + 1}`}
                className="max-h-full max-w-full select-none object-contain"
                draggable={false}
                loading={Math.abs(i - startIndex) <= 1 ? "eager" : "lazy"}
              />
            </div>
          ))}
        </div>
        {count > 1 && (
          <>
            <button type="button" className={`${arrow} left-4`} onClick={() => goTo(index - 1)} disabled={index === 0} aria-label="Previous photo">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <button type="button" className={`${arrow} right-4`} onClick={() => goTo(index + 1)} disabled={index === count - 1} aria-label="Next photo">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
