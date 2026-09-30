"use client";

import { useEffect, useState, type RefObject } from "react";
import type { ShopifyProduct } from "@/lib/shopify";
import { projectHeroPoint, SHOP_HERO_HOTSPOTS } from "@/lib/shopHeroHotspots";

type Placement = { slug: string; x: number; y: number };

export function ShopHeroHotspots({ imageRef, products, onSelect }: {
  imageRef: RefObject<HTMLImageElement | null>;
  products: ShopifyProduct[];
  onSelect: (product: ShopifyProduct) => void;
}) {
  const [placements, setPlacements] = useState<Placement[]>([]);
  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    let frame = 0;
    function update() {
      if (!image?.complete || !image.naturalWidth) { setPlacements([]); return; }
      const box = image.getBoundingClientRect();
      const portrait = image.currentSrc.includes("fall-firepit-mobile");
      const [xPosition, yPosition] = getComputedStyle(image).objectPosition.split(" ");
      const percent = (value: string | undefined, fallback: number) =>
        value?.endsWith("%") ? parseFloat(value) / 100 : fallback;
      setPlacements(SHOP_HERO_HOTSPOTS.flatMap(hotspot => {
        const point = projectHeroPoint({
          width: box.width, height: box.height,
          naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
          point: portrait ? hotspot.mobile : hotspot.desktop,
          positionX: percent(xPosition, .5), positionY: percent(yPosition, .5),
        });
        return point ? [{ slug: hotspot.slug, ...point }] : [];
      }));
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    observer?.observe(image);
    image.addEventListener("load", schedule);
    image.addEventListener("error", schedule);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      image.removeEventListener("load", schedule);
      image.removeEventListener("error", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [imageRef]);

  return <div className="shop-hero-hotspots" role="group" aria-label="Shop the hero look">
    {SHOP_HERO_HOTSPOTS.map(hotspot => {
      const product = products.find(p => p.slug === hotspot.slug);
      const placement = placements.find(p => p.slug === hotspot.slug);
      if (!product || !placement) return null;
      return <button
        key={hotspot.slug}
        type="button"
        className="shop-hero-hotspot"
        style={{ left: placement.x, top: placement.y }}
        data-product={hotspot.slug}
        aria-label={`Shop ${hotspot.label}`}
        aria-haspopup="dialog"
        aria-controls="shop-quick-dialog"
        onClick={() => onSelect(product)}
      >
        <span className="shop-hero-hotspot__plus" aria-hidden="true">+</span>
        <span className="shop-hero-hotspot__label" aria-hidden="true">{hotspot.label}</span>
      </button>;
    })}
  </div>;
}
