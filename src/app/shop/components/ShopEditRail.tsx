"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

/** Native horizontal scrolling: touch, trackpad, keyboard and explicit arrows.
 * Never auto-advances or translates merchandise in response to vertical scrolling.
 */
export function ShopEditRail({ children, count, season }: { children: ReactNode; count: number; season: string }) {
  const rail = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: count < 2 });
  const update = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    // Allow the small focus-outline inset and fractional snap rounding.
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [count, update]);
  function move(direction: number) {
    const el = rail.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    const step = (card?.getBoundingClientRect().width || el.clientWidth) + (parseFloat(getComputedStyle(el).columnGap) || 0);
    const distance = step * Math.max(1, Math.floor(el.clientWidth / step));
    el.scrollBy({ left: direction * distance, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  return <>
    <div className="sechead">
      <h2 className="h2" id="mullyEditTitle">The Mully Edit</h2>
      <div className="shop-edit-actions">
        <Link className="ulink shop-edit-all" href="/shop/collection/shop-all">Shop all</Link>
        <div className="shop-edit-arrows" role="group" aria-label="Browse the edit">
          <button type="button" aria-label="Previous products" aria-controls="mully-edit-rail" disabled={edges.start} onClick={() => move(-1)}>←</button>
          <button type="button" aria-label="Next products" aria-controls="mully-edit-rail" disabled={edges.end} onClick={() => move(1)}>→</button>
        </div>
      </div>
    </div>
    <div ref={rail} id="mully-edit-rail" className="shop-edit-rail" role="region" aria-label={`The full ${season} edit`} tabIndex={0} onKeyDown={e => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault(); move(e.key === "ArrowLeft" ? -1 : 1);
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        e.currentTarget.scrollTo({ left: e.key === "Home" ? 0 : e.currentTarget.scrollWidth, behavior: "auto" });
      }
    }}>
      {children}
    </div>
  </>;
}
