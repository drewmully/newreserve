"use client";

import { useState, useCallback, useEffect, type ReactNode } from "react";
import Link from "next/link";
import type { Product } from "../products";

/* ═══════════════════════════════════════════
   SHOP GRID (brand / collection toggle)
   ═══════════════════════════════════════════ */

interface ShopGridProps {
  products: Product[];
  brands: readonly string[];
  collections: readonly string[];
}

export function ShopGrid({ products, brands, collections }: ShopGridProps) {
  const [view, setView] = useState<"brand" | "collection">("brand");

  const grouped =
    view === "brand"
      ? brands.map((b) => ({
          label: b,
          items: products.filter((p) => p.brand === b),
        }))
      : collections.map((c) => ({
          label: c,
          items: products.filter((p) => p.collection === c),
        }));

  return (
    <>
      {/* Toggle */}
      <div className="flex items-center justify-center gap-1 mb-12 md:mb-16">
        <button
          onClick={() => setView("brand")}
          className={`px-5 py-2 text-xs tracking-[0.2em] uppercase font-medium rounded-full transition-all duration-300 cursor-pointer ${
            view === "brand"
              ? "bg-forest text-bone"
              : "text-charcoal/50 hover:text-charcoal"
          }`}
        >
          By Brand
        </button>
        <button
          onClick={() => setView("collection")}
          className={`px-5 py-2 text-xs tracking-[0.2em] uppercase font-medium rounded-full transition-all duration-300 cursor-pointer ${
            view === "collection"
              ? "bg-forest text-bone"
              : "text-charcoal/50 hover:text-charcoal"
          }`}
        >
          By Collection
        </button>
      </div>

      {/* Grid with brand/collection separators */}
      {grouped.map((group) => (
        <div key={group.label} className="mb-16 last:mb-0">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
            {/* Separator tile */}
            <div className="aspect-[3/4] flex flex-col items-start justify-end p-5 md:p-7">
              <span className="text-xs tracking-[0.25em] uppercase text-sage font-medium mb-2">
                {view === "brand" ? "Brand" : "Collection"}
              </span>
              <h2 className="font-serif text-2xl md:text-3xl text-obsidian leading-tight">
                {group.label}
              </h2>
              <span className="text-xs text-charcoal/40 mt-1">
                {group.items.length} product{group.items.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Product tiles */}
            {group.items.map((product) => (
              <ProductTile key={product.slug} product={product} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/* ─── PRODUCT TILE ─── */

function ProductTile({ product }: { product: Product }) {
  return (
    <Link
      href={`/shop/${product.slug}`}
      className="group block"
    >
      <div className="aspect-[3/4] bg-cream rounded-lg overflow-hidden mb-3 relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.images[0]}
          alt={product.name}
          className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
          draggable={false}
        />
        {product.reservePrice < product.price && (
          <span className="absolute top-3 left-3 bg-forest/90 text-bone text-[10px] tracking-[0.15em] uppercase font-medium px-2.5 py-1 rounded-full">
            Reserve
          </span>
        )}
      </div>
      <div className="px-0.5">
        <p className="text-xs text-charcoal/40 tracking-wide uppercase mb-0.5">
          {product.brand}
        </p>
        <h3 className="text-sm text-obsidian font-medium leading-snug mb-1.5 group-hover:text-forest transition-colors duration-300">
          {product.name}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-sm text-forest font-medium">
            ${product.reservePrice}
          </span>
          {product.reservePrice < product.price && (
            <span className="text-xs text-charcoal/30 line-through">
              ${product.price}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

/* ═══════════════════════════════════════════
   ACCORDION
   ═══════════════════════════════════════════ */

interface AccordionItem {
  title: string;
  content: string;
}

export function Accordion({ items }: { items: AccordionItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="border-t border-taupe/20">
      {items.map((item, i) => (
        <div key={i} className="border-b border-taupe/20">
          <button
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
            className="w-full flex items-center justify-between py-4 text-left group cursor-pointer"
          >
            <span className="text-sm font-medium text-obsidian tracking-wide">
              {item.title}
            </span>
            <svg
              className={`w-4 h-4 text-charcoal/40 transition-transform duration-300 ${
                openIndex === i ? "rotate-45" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
          <div
            className="overflow-hidden transition-all duration-300 ease-out"
            style={{
              maxHeight: openIndex === i ? "300px" : "0",
              opacity: openIndex === i ? 1 : 0,
            }}
          >
            <p className="text-sm text-charcoal/60 leading-relaxed pb-5">
              {item.content}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════
   IMAGE MODAL (scrollable gallery)
   ═══════════════════════════════════════════ */

export function ProductImageGallery({ images, name }: { images: string[]; name: string }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const closeModal = useCallback(() => setModalOpen(false), []);

  useEffect(() => {
    if (!modalOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKey);
    };
  }, [modalOpen, closeModal]);

  return (
    <>
      {/* Main image */}
      <div
        className="aspect-[3/4] bg-cream rounded-lg overflow-hidden cursor-zoom-in mb-3"
        onClick={() => {
          setActiveIndex(0);
          setModalOpen(true);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[activeIndex]}
          alt={name}
          className="w-full h-full object-cover"
          draggable={false}
        />
      </div>

      {/* Thumbnails */}
      {images.length > 1 && (
        <div className="flex gap-2">
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => setActiveIndex(i)}
              className={`w-16 h-20 md:w-20 md:h-24 rounded overflow-hidden border-2 transition-all duration-200 cursor-pointer ${
                activeIndex === i
                  ? "border-forest"
                  : "border-transparent opacity-60 hover:opacity-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img}
                alt=""
                className="w-full h-full object-cover"
                draggable={false}
              />
            </button>
          ))}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-[100] bg-obsidian/95 flex flex-col"
          onClick={closeModal}
        >
          {/* Close button */}
          <div className="flex justify-end p-4 md:p-6 shrink-0">
            <button
              onClick={closeModal}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors duration-200 cursor-pointer"
            >
              <svg
                className="w-5 h-5 text-bone"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Scrollable image list */}
          <div
            className="flex-1 overflow-y-auto px-4 md:px-8 pb-8 space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            {images.map((img, i) => (
              <div
                key={i}
                className="max-w-2xl mx-auto rounded-lg overflow-hidden"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img}
                  alt={`${name} — image ${i + 1}`}
                  className="w-full h-auto"
                  draggable={false}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════
   ADD TO CART BUTTON
   ═══════════════════════════════════════════ */

export function AddToCartButton() {
  const [added, setAdded] = useState(false);

  return (
    <button
      onClick={() => {
        setAdded(true);
        setTimeout(() => setAdded(false), 2000);
      }}
      className={`w-full h-13 rounded-xl text-sm font-medium tracking-wider uppercase transition-all duration-300 cursor-pointer ${
        added
          ? "bg-sage text-bone"
          : "bg-forest text-bone hover:bg-forest-dark"
      }`}
    >
      {added ? "Added to Cart" : "Add to Cart"}
    </button>
  );
}

/* ═══════════════════════════════════════════
   BACK LINK
   ═══════════════════════════════════════════ */

export function BackLink({ children }: { children: ReactNode }) {
  return (
    <Link
      href="/shop"
      className="inline-flex items-center gap-2 text-sm text-charcoal/50 hover:text-forest transition-colors duration-300 mb-8 md:mb-12"
    >
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
        />
      </svg>
      {children}
    </Link>
  );
}
