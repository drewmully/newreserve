"use client";

import { useState, useCallback, useEffect, type ReactNode } from "react";
import Link from "next/link";
import type { Product } from "../products";
import { BRAND_INFO, COLLECTION_INFO } from "../products";
import { useMembership } from "../../context/MembershipContext";
import { ProductVariantSelector } from "../../components/ProductVariantSelector";
import { QuickAddToCartButton } from "../../components/QuickAddToCartButton";
import {
  formatVariantSummary,
  getDefaultProductVariant,
  getInitialVariantSelection,
  hasVariantChoices,
  resolveVariantBySelection,
} from "@/lib/productVariants";

/* Safe membership hook — returns null when used outside the provider (e.g. public /shop) */
function useMembershipSafe() {
  try {
    return useMembership();
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════════
   SHOP GRID (brand / collection toggle)
   ═══════════════════════════════════════════ */

interface ShopGridProps {
  products: Product[];
  brands: readonly string[];
  collections: readonly string[];
  sourceContext?: "public-shop" | "dashboard-shop";
  privateReleasesHandle?: string;
}

export function ShopGrid({
  products,
  brands,
  collections,
  sourceContext = "public-shop",
  privateReleasesHandle = "private-releases",
}: ShopGridProps) {
  const [view, setView] = useState<"brand" | "collection">("brand");
  const [modalInfo, setModalInfo] = useState<{
    name: string;
    description: string;
    image: string;
  } | null>(null);

  const filteredProducts = products;

  const activeBrands = brands.filter((brand) =>
    filteredProducts.some((product) => product.brand === brand)
  );
  const activeCollections = collections.filter((collection) =>
    filteredProducts.some((product) => product.collection === collection)
  );

  const fallbackBrands = [
    ...new Set(filteredProducts.map((product) => product.brand)),
  ];
  const fallbackCollections = [
    ...new Set(filteredProducts.map((product) => product.collection)),
  ];

  const grouped =
    view === "brand"
      ? (activeBrands.length > 0 ? activeBrands : fallbackBrands).map((b) => ({
          label: b,
          items: filteredProducts.filter((p) => p.brand === b),
        }))
      : (activeCollections.length > 0
          ? activeCollections
          : fallbackCollections
        ).map((c) => ({
          label: c,
          items: filteredProducts.filter((p) => p.collection === c),
        }));

  return (
    <>
      {/* Grouping control */}
      <div className="flex items-center justify-center gap-2 mb-2">
        {(["brand", "collection"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setView(mode)}
            className={`px-4 py-2 rounded-full text-xs tracking-wider uppercase transition-colors duration-200 cursor-pointer ${
              view === mode
                ? "bg-forest text-bone"
                : "bg-taupe/20 text-charcoal/45 hover:text-forest"
            }`}
          >
            {mode === "brand" ? "Brand" : "Collection"}
          </button>
        ))}
      </div>
      <p className="text-center text-[11px] text-charcoal/40 mb-8">
        Organize products by {view === "brand" ? "brand" : "collection"}.
      </p>

      {grouped.length === 0 && (
        <div className="mb-10 text-center text-sm text-charcoal/50">
          No products found for this filter.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
        {grouped.map((group) => (
          <SeparatorAndProducts
            key={group.label}
            group={group}
            view={view}
            sourceContext={sourceContext}
            privateReleasesHandle={privateReleasesHandle}
            onCardClick={(label) => {
              const info =
                view === "brand"
                  ? BRAND_INFO[label]
                  : COLLECTION_INFO[label];
              if (info) setModalInfo(info);
            }}
          />
        ))}
      </div>

      {/* Brand / Collection modal */}
      {modalInfo && (
        <InfoModal info={modalInfo} onClose={() => setModalInfo(null)} />
      )}
    </>
  );
}

function SeparatorAndProducts({
  group,
  view,
  sourceContext,
  privateReleasesHandle,
  onCardClick,
}: {
  group: { label: string; items: Product[] };
  view: "brand" | "collection";
  sourceContext: "public-shop" | "dashboard-shop";
  privateReleasesHandle: string;
  onCardClick: (label: string) => void;
}) {
  const info =
    view === "brand" ? BRAND_INFO[group.label] : COLLECTION_INFO[group.label];
  const blurb = info?.blurb ?? "";

  return (
    <>
      {/* Separator card — same size as product cards */}
      <button
        onClick={() => onCardClick(group.label)}
        className="aspect-[3/4] rounded-lg bg-forest relative overflow-hidden flex flex-col items-start justify-end p-5 md:p-7 text-left cursor-pointer group transition-all duration-300 hover:bg-forest-dark"
      >
        {/* Decorative pattern */}
        <div
          className="absolute inset-0 opacity-[0.06] pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, #F5F1E8 0.5px, transparent 0)`,
            backgroundSize: "20px 20px",
          }}
        />
        <div className="relative z-10">
          <span className="text-[10px] tracking-[0.3em] uppercase text-sage/70 font-medium block mb-2">
            {view === "brand" ? "Brand" : "Collection"}
          </span>
          <h2 className="font-serif text-xl md:text-2xl text-bone leading-tight mb-2">
            {group.label}
          </h2>
          {blurb && (
            <p className="text-[11px] md:text-xs text-bone/50 leading-relaxed line-clamp-3 mb-3">
              {blurb}
            </p>
          )}
          <span className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-sage/50 group-hover:text-sage transition-colors duration-300">
            Learn more
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </span>
        </div>
      </button>

      {/* Product tiles */}
      {group.items.map((product) => (
        <ProductTile
          key={product.slug}
          product={product}
          sourceContext={sourceContext}
          privateReleasesHandle={privateReleasesHandle}
        />
      ))}
    </>
  );
}

/* ─── INFO MODAL ─── */

function InfoModal({
  info,
  onClose,
}: {
  info: { name: string; description: string; image: string };
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-obsidian/80 backdrop-blur-sm animate-modal-backdrop" />

      {/* Card */}
      <div
        className="relative bg-bone rounded-2xl overflow-hidden max-w-lg w-full shadow-2xl animate-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-obsidian/10 hover:bg-obsidian/20 transition-colors duration-200 cursor-pointer"
        >
          <svg className="w-4 h-4 text-obsidian" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Image */}
        <div className="aspect-[16/9] bg-forest relative overflow-hidden">
          <div
            className="absolute inset-0 opacity-[0.06] pointer-events-none"
            style={{
              backgroundImage: `radial-gradient(circle at 1px 1px, #F5F1E8 0.5px, transparent 0)`,
              backgroundSize: "24px 24px",
            }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={info.image}
            alt={info.name}
            className="w-full h-full object-cover"
            draggable={false}
          />
        </div>

        {/* Content */}
        <div className="p-6 md:p-8">
          <h2 className="font-serif text-2xl md:text-3xl text-obsidian mb-4">
            {info.name}
          </h2>
          <p className="text-sm md:text-base text-charcoal/65 leading-relaxed">
            {info.description}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── PRODUCT TILE ─── */

function ProductTile({
  product,
  sourceContext,
  privateReleasesHandle,
}: {
  product: Product;
  sourceContext: "public-shop" | "dashboard-shop";
  privateReleasesHandle: string;
}) {
  const ctx = useMembershipSafe();
  const tier = ctx?.tier ?? "free";
  const isPaid = tier !== "free";
  const productHref =
    sourceContext === "dashboard-shop"
      ? `/shop/${product.slug}?from=dashboard`
      : `/shop/${product.slug}`;
  const isPrivateRelease = (product.sourceCollections ?? []).includes(
    privateReleasesHandle
  );

  const handleQuickAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (ctx) {
      void ctx.addToCart({
        slug: product.slug,
        name: product.name,
        brand: product.brand,
        price: isPaid ? product.reservePrice : product.price,
        retailPrice: product.price,
        variantId: product.variantId,
        image: product.images?.[0],
      });
    }
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1500);
  };

  const hasImages = product.images && product.images.length > 0;
  const hasSecondImage = product.images && product.images.length > 1;

  return (
    <Link
      href={productHref}
      className="group block product-tile-hover"
    >
      <div className="aspect-[3/4] bg-cream rounded-lg overflow-hidden mb-3 relative product-img-wrap">
        {isPrivateRelease && (
          <span className="absolute top-2 left-2 z-10 px-2 py-1 rounded bg-obsidian/80 text-bone text-[10px] tracking-[0.12em] uppercase">
            Private
          </span>
        )}
        {hasImages ? (
          <>
            {/* Primary image */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={product.images[0]}
              alt={product.name}
              className="w-full h-full object-cover product-img-primary"
              draggable={false}
            />
            {/* Secondary image — shown on hover */}
            {hasSecondImage && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={product.images[1]}
                alt={`${product.name} alternate view`}
                className="w-full h-full object-cover product-img-secondary"
                draggable={false}
                loading="lazy"
              />
            )}
          </>
        ) : (
          /* Fallback placeholder icon */
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-taupe/30 group-hover:text-taupe/45 transition-colors duration-500">
            <ProductPlaceholderIcon collection={product.collection} />
            <span className="text-[10px] tracking-[0.2em] uppercase">{product.collection}</span>
          </div>
        )}

        {/* Quick-add to cart */}
        <QuickAddToCartButton
          product={product}
          isPaid={isPaid}
          onAddToCart={async (item) => {
            if (!ctx) return;
            await ctx.addToCart(item);
          }}
          idleClassName="absolute bottom-3 right-3 w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 cursor-pointer shadow-sm btn-press bg-forest text-bone opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 hover:bg-forest-dark"
          addedClassName="absolute bottom-3 right-3 w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 cursor-pointer shadow-sm btn-press bg-sage text-bone scale-110"
          idleContent={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          }
          addedContent={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          }
        />
      </div>
      <div className="px-0.5">
        <p className="text-xs text-charcoal/40 tracking-wide uppercase mb-0.5">
          {product.brand}
        </p>
        <h3 className="text-sm text-obsidian font-medium leading-snug mb-1.5 group-hover:text-forest transition-colors duration-300">
          {product.name}
        </h3>
        <div className="flex items-center gap-2">
          {isPaid ? (
            <>
              {product.price !== product.reservePrice && (
                <span className="text-sm text-charcoal/40 line-through">${product.price}</span>
              )}
              <span className="text-sm text-forest font-medium">${product.reservePrice}</span>
              {product.price !== product.reservePrice && (
                <span className="text-[10px] tracking-wide uppercase text-forest bg-forest/10 px-1.5 py-0.5 rounded font-medium">
                  Member Price
                </span>
              )}
            </>
          ) : (
            <>
              <span className="text-sm text-charcoal/40 line-through">${product.price}</span>
              <span className="text-sm text-forest font-medium">${product.reservePrice}</span>
              <span className="text-[10px] tracking-wide uppercase text-sage bg-sage/10 px-1.5 py-0.5 rounded">
                Mill River
              </span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}

function ProductPlaceholderIcon({ collection }: { collection: string }) {
  const cls = "w-8 h-8 md:w-10 md:h-10";
  switch (collection) {
    case "Apparel":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 2l-4 4 3 1.5V20a1 1 0 001 1h12a1 1 0 001-1V7.5L22 6l-4-4-3 3h-6L6 2z" />
        </svg>
      );
    case "Accessories":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
        </svg>
      );
    case "Equipment":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
          <circle cx="12" cy="12" r="4" />
          <path strokeLinecap="round" d="M12 2v4m0 12v4m10-10h-4M6 12H2m17.07-7.07l-2.83 2.83M9.76 14.24l-2.83 2.83m14.14 0l-2.83-2.83M9.76 9.76L6.93 6.93" />
        </svg>
      );
    default:
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
        </svg>
      );
  }
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
                  alt={`${name} image ${i + 1}`}
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

export function AddToCartButton({
  product,
}: {
  product?: {
    slug: string;
    name: string;
    brand: string;
    reservePrice: number;
    price: number;
    variantId?: string;
    images?: string[];
    options?: Product["options"];
    variants?: Product["variants"];
  };
}) {
  const [added, setAdded] = useState(false);
  const ctx = useMembershipSafe();
  const [selection, setSelection] = useState(() =>
    product ? getInitialVariantSelection(product) : {}
  );

  useEffect(() => {
    setSelection(product ? getInitialVariantSelection(product) : {});
  }, [product]);

  const selectedVariant =
    product && resolveVariantBySelection(product, selection);
  const defaultVariant =
    product && (selectedVariant ?? getDefaultProductVariant(product));
  const variantSummary =
    product && hasVariantChoices(product)
      ? formatVariantSummary(defaultVariant ?? null)
      : "";

  return (
    <div className="space-y-4">
      {product && (
        <ProductVariantSelector
          product={product}
          selection={selection}
          onChange={(optionName, optionValue) =>
            setSelection((current) => ({
              ...current,
              [optionName]: optionValue,
            }))
          }
        />
      )}

      {variantSummary && (
        <p className="text-xs text-charcoal/45">
          Selected:{" "}
          <span className="font-medium text-obsidian">{variantSummary}</span>
        </p>
      )}

      <button
        onClick={() => {
          if (ctx && product) {
            const isPaid = ctx.tier !== "free";
            const variant =
              resolveVariantBySelection(product, selection) ??
              getDefaultProductVariant(product);

            void ctx.addToCart({
              slug: product.slug,
              name: product.name,
              brand: product.brand,
              price: isPaid
                ? variant?.reservePrice ?? product.reservePrice
                : variant?.price ?? product.price,
              variantId: variant?.id ?? product.variantId,
              image: product.images?.[0],
            });
          }
          setAdded(true);
          setTimeout(() => setAdded(false), 2000);
        }}
        disabled={defaultVariant?.availableForSale === false}
        className={`w-full h-13 rounded-xl text-sm font-medium tracking-wider uppercase transition-all duration-300 cursor-pointer btn-press disabled:cursor-not-allowed disabled:opacity-60 ${
          added
            ? "bg-sage text-bone"
            : "bg-forest text-bone hover:bg-forest-dark"
        }`}
      >
        {defaultVariant?.availableForSale === false
          ? "Unavailable"
          : added
            ? "Added to Cart"
            : "Add to Cart"}
      </button>
    </div>
    <button
      onClick={() => {
        if (ctx && product) {
          const isPaid = ctx.tier !== "free";
          void ctx.addToCart({
            slug: product.slug,
            name: product.name,
            brand: product.brand,
            price: isPaid ? product.reservePrice : product.price,
            retailPrice: product.price,
            variantId: product.variantId,
            image: product.images?.[0],
          });
        }
        setAdded(true);
        setTimeout(() => setAdded(false), 2000);
      }}
      className={`w-full h-13 rounded-xl text-sm font-medium tracking-wider uppercase transition-all duration-300 cursor-pointer btn-press ${
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
   PRODUCT PRICE DISPLAY (tier-aware, for product detail page)
   ═══════════════════════════════════════════ */

export function ProductPriceDisplay({
  price,
  reservePrice,
}: {
  price: number;
  reservePrice: number;
}) {
  const ctx = useMembershipSafe();
  const isPaid = (ctx?.tier ?? "free") !== "free";
  const hasDiscount = price !== reservePrice;

  return (
    <div className="flex items-center gap-3">
      {hasDiscount && (
        <span className="text-sm text-charcoal/40 line-through">${price}</span>
      )}
      <span className="font-serif text-2xl text-forest">${reservePrice}</span>
      {hasDiscount && (
        <span className={`text-[10px] tracking-wide uppercase px-2 py-1 rounded font-medium ${isPaid ? "text-forest bg-forest/10" : "text-sage bg-sage/10"}`}>
          {isPaid ? "Member Price" : "Mill River Price"}
        </span>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   BACK LINK
   ═══════════════════════════════════════════ */

export function BackLink({
  children,
  href = "/shop",
}: {
  children: ReactNode;
  href?: string;
}) {
  return (
    <Link
      href={href}
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
