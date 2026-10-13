"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const HEADER_OFFSET = 96;
const SETTLE_MS = 8000;

/**
 * Scroll to the top of the page on every SPA route change, or to the
 * `#hash` section when the URL has one.
 *
 * Ported from drewmully/v1sports-storefront (client/src/components/scroll-to-top.tsx).
 * Without this, Next.js App Router preserves scroll position across route
 * transitions — a longstanding UX bug for commerce pages where users expect
 * to land at the top of a new product or collection view.
 *
 * Hash landings (ads link to `/#outfit`) keep re-aligning while the layout
 * settles. On slow mobile loads iOS jumps to the anchor while the page is
 * still unstyled and ~4x taller, then the styled page shrinks and the
 * browser clamps near the bottom (the FAQ). We stop as soon as the shopper
 * scrolls or touches, so we never fight them.
 */
export function ScrollToTop() {
  const pathname = usePathname();

  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const align = () => {
      const target = id ? document.getElementById(id) : null;
      window.scrollTo({
        top: target ? window.scrollY + target.getBoundingClientRect().top - HEADER_OFFSET : 0,
        left: 0,
        behavior: "instant",
      });
    };
    const frame = requestAnimationFrame(align);
    if (!id || !document.getElementById(id)) return () => cancelAnimationFrame(frame);

    let done = false;
    let timer = 0;
    const observer = new ResizeObserver(() => { if (!done) requestAnimationFrame(() => { if (!done) align(); }); });
    const stop = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      window.clearTimeout(timer);
      window.removeEventListener("load", onLoad);
      for (const type of userEvents) window.removeEventListener(type, stop);
    };
    const onLoad = () => { align(); window.clearTimeout(timer); timer = window.setTimeout(stop, 1000); };
    const userEvents = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const type of userEvents) window.addEventListener(type, stop, { passive: true, once: true });
    window.addEventListener("load", onLoad, { once: true });
    observer.observe(document.body);
    timer = window.setTimeout(stop, SETTLE_MS);
    return () => { cancelAnimationFrame(frame); stop(); };
  }, [pathname]);

  return null;
}
