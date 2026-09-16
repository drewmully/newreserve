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
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);

  return null;
}
