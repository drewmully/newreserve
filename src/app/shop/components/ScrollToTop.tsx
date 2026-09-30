"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Scroll to the top of the page on every SPA route change.
 *
 * Ported from drewmully/v1sports-storefront (client/src/components/scroll-to-top.tsx).
 * Without this, Next.js App Router preserves scroll position across route
 * transitions — a longstanding UX bug for commerce pages where users expect
 * to land at the top of a new product or collection view.
 *
 * `behavior: "instant"` avoids a visible scroll animation on nav.
 */
export function ScrollToTop() {
  const pathname = usePathname();

  useEffect(() => {
    // Respect collection/support → shop section links instead of resetting
    // their anchor scroll to the top during client-side navigation.
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(window.location.hash.slice(1));
      window.scrollTo({
        top: target ? window.scrollY + target.getBoundingClientRect().top - 96 : 0,
        left: 0,
        behavior: "instant",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return null;
}
