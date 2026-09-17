"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { ShopifyProduct } from "@/lib/shopify";
import { trackEvent } from "@/lib/tracking";
import { useMembership } from "../../context/MembershipContext";
import {
  getInitialVariantSelection,
  resolveVariantBySelection,
  getDefaultProductVariant,
  hasVariantChoices,
  getProductVariants,
  type ProductVariantSelection,
} from "@/lib/productVariants";
import { orderProductImagesBySelection } from "@/lib/shopDisplay";
import { ProductImageGallery } from "./ShopClient";
import { ShopProductCard } from "./ShopProductCard";
import { getSizeGuide } from "@/lib/sizeCharts";
import { SizeFitChart } from "./SizeFitChart";
import { BreadcrumbTrail } from "./pdp/BreadcrumbTrail";
import { ProofChip } from "./pdp/ProofChip";
import { PromoPill } from "./pdp/PromoPill";
import { PdpVariantGrid } from "./pdp/PdpVariantGrid";
import { BuyBoxAction } from "./pdp/BuyBoxAction";
import { PdpAccordion } from "./pdp/PdpAccordion";
import { WaysToWear } from "./pdp/WaysToWear";

interface ShopPDPClientProps {
  product: ShopifyProduct;
  initialSelection: ProductVariantSelection;
  accent: string;
  relatedProducts?: ShopifyProduct[];
}

/**
 * Huckberry-anatomy PDP.
 *
 * Layout, top → bottom:
 *   1. Breadcrumb funnel (Shop / Category / Subcategory)
 *   2. Two-column grid:
 *        LEFT  → gallery
 *        RIGHT → buy box:
 *                brand · title + price
 *                rating chip + optional bestseller badge
 *                Buy 2 Save 15% promo pill
 *                editorial hook
 *                color swatches (always shown, even 1 color)
 *                fit tile grid + size chip grid + inseam chip grid (all visible
 *                even when a variant is OOS)
 *                Add-to-cart OR Pre-order button with tiny notify-me chip
 *                trust strip
 *   3. Editorial deep-copy band + detail image collage
 *   4. Structured accordion (Features · Fit & Sizing · Materials · About brand)
 *   5. Ways to Wear It (outfit cards → new-tab product drawer)
 *   6. More from Brand + You may also like rails
 */
export function ShopPDPClient({
  product,
  initialSelection,
  accent,
  relatedProducts = [],
}: ShopPDPClientProps) {
  const { addToCart } = useMembership();
  const [selection, setSelection] = useState<ProductVariantSelection>(() =>
    getInitialVariantSelection(product, initialSelection)
  );
  const [added, setAdded] = useState(false);
  const [sizeChartOpen, setSizeChartOpen] = useState(false);

  const selectedVariant = useMemo(
    () => resolveVariantBySelection(product, selection),
    [product, selection]
  );

  const orderedImages = useMemo(
    () =>
      Object.keys(selection).length > 0
        ? orderProductImagesBySelection(product, selection)
        : product.images,
    [product, selection]
  );

  const colorOption = product.options?.find((o) => /^colou?r$/i.test(o.name));
  const galleryKey = colorOption
    ? selection[colorOption.name] ?? "default"
    : "default";

  const displayVariant = selectedVariant ?? getDefaultProductVariant(product);
  const price = displayVariant?.price ?? product.price;
  const retailPrice = displayVariant?.reservePrice ?? product.reservePrice;
  const showStrikethrough =
    typeof retailPrice === "number" && retailPrice > price;

  const editorialHeadline = product.editorialHeadline || product.whyWeLikeIt;
  const editorialBody = product.editorialBody || product.description;
  const detailImages = orderedImages.slice(1, 5);

  const sizeGuide = getSizeGuide(product.slug);
  const productHasVariantChoices = hasVariantChoices(product);
  const allVariantsSoldOut =
    getProductVariants(product).every((v) => v.availableForSale === false);
  const currentVariantUnavailable = displayVariant?.availableForSale === false;
  const unavailable = allVariantsSoldOut || currentVariantUnavailable;
  const sizeKey = Object.keys(selection).find((k) => /^size$/i.test(k));
  const sizeSelected = sizeKey ? selection[sizeKey] : undefined;

  const sameBrandProducts = relatedProducts
    .filter((p) => p.brand === product.brand && p.slug !== product.slug)
    .slice(0, 8);
  const otherProducts = relatedProducts
    .filter((p) => p.brand !== product.brand && p.slug !== product.slug)
    .slice(0, 8);

  const viewedRef = useRef(false);
  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    trackEvent("proshop_product_viewed", {
      properties: {
        product_slug: product.slug,
        variant_id: product.variantId,
        name: product.name,
        brand: product.brand,
        collection: product.collection,
        source: "shop_pdp_v4",
        price: product.price,
        reserve_price: product.reservePrice,
      },
    });
  }, [product]);

  const handleAdd = () => {
    const variant = displayVariant;
    void addToCart({
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      price: variant?.price ?? product.price,
      retailPrice: variant?.reservePrice ?? product.reservePrice,
      variantId: variant?.id ?? product.variantId,
      image: orderedImages?.[0],
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  // Merge current product into the catalog used by Ways to Wear so its own
  // handle resolves for the drawer preview.
  const outfitsCatalog = useMemo(
    () => [product, ...relatedProducts.filter((p) => p.slug !== product.slug)],
    [product, relatedProducts]
  );

  return (
    <div className="mx-auto max-w-7xl">
      {sizeChartOpen && sizeGuide && (
        <SizeFitChart
          guide={sizeGuide}
          productName={product.name}
          onClose={() => setSizeChartOpen(false)}
        />
      )}

      {/* Breadcrumb */}
      <div className="mb-6">
        <BreadcrumbTrail
          productType={product.collection}
          subcategory={product.subcategory}
          brand={product.brand}
        />
      </div>

      {/* Top: gallery + buy box */}
      <div className="grid gap-10 md:grid-cols-2 md:gap-14 lg:gap-20">
        <div>
          <ProductImageGallery
            key={galleryKey}
            images={orderedImages}
            name={product.name}
          />
        </div>

        <div className="flex flex-col">
          <span className="mb-3 inline-flex w-fit text-[11px] font-mono uppercase tracking-[0.24em] text-charcoal/60">
            {product.brand}
          </span>

          <div className="flex items-baseline justify-between gap-4">
            <h1 className="font-serif text-3xl leading-tight tracking-tight text-charcoal md:text-4xl">
              {product.name}
            </h1>
            <div className="flex items-baseline gap-2 whitespace-nowrap">
              {showStrikethrough && (
                <span className="text-sm text-charcoal/40 line-through">
                  ${retailPrice!.toFixed(0)}
                </span>
              )}
              <span className="font-serif text-2xl text-charcoal">
                ${price.toFixed(0)}
              </span>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <ProofChip
              rating={product.rating}
              reviewCount={product.reviewCount}
              reviewsUrl={product.reviewsUrl}
              badge={product.badge}
            />
            <PromoPill />
          </div>

          {editorialHeadline && (
            <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-charcoal/70">
              {editorialHeadline}
            </p>
          )}

          <div className="my-8 border-t border-dashed border-charcoal/15" />

          {/* Variant grid — always show, even if OOS or single color. */}
          <div className="mb-6">
            {sizeGuide && (
              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSizeChartOpen(true)}
                  className="text-[10px] font-mono uppercase tracking-[0.18em] text-charcoal/60 underline underline-offset-4 hover:text-charcoal"
                >
                  Size &amp; fit
                </button>
              </div>
            )}
            {productHasVariantChoices ? (
              <PdpVariantGrid
                product={product}
                selection={selection}
                onChange={(name, value) =>
                  setSelection((current) => ({ ...current, [name]: value }))
                }
                singleColorFallback="Standard"
              />
            ) : sizeGuide ? (
              // Fallback: product should carry sizes but variants aren't wired.
              <div className="space-y-6">
                <div>
                  <p className="mb-3 text-[10px] font-mono uppercase tracking-[0.22em] text-charcoal/50">
                    Color
                  </p>
                  <button
                    type="button"
                    disabled
                    aria-label="Standard color"
                    className="h-10 w-10 rounded-full border border-charcoal/15 opacity-70"
                    style={{ backgroundColor: "#c4c4c4" }}
                  />
                </div>
                <div>
                  <p className="mb-3 text-[10px] font-mono uppercase tracking-[0.22em] text-charcoal/50">
                    Size
                  </p>
                  <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                    {sizeGuide.chart.rows.map((row) => (
                      <span
                        key={row.size}
                        className="flex h-11 cursor-not-allowed items-center justify-center rounded-sm border border-charcoal/10 bg-cream text-[13px] text-charcoal/30"
                      >
                        {row.size}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              // No sizes and no variant choices — still show a single color swatch.
              <div>
                <p className="mb-3 text-[10px] font-mono uppercase tracking-[0.22em] text-charcoal/50">
                  Color
                </p>
                <button
                  type="button"
                  disabled
                  aria-label="Standard color"
                  className="h-10 w-10 rounded-full border border-charcoal/15 opacity-70"
                  style={{ backgroundColor: "#c4c4c4" }}
                />
              </div>
            )}
          </div>

          <BuyBoxAction
            onAddToCart={handleAdd}
            added={added}
            isUnavailable={unavailable}
            preOrderEtaWeeks={product.preOrderEtaWeeks}
            accent={accent}
            productSlug={product.slug}
            productName={product.name}
            variantId={displayVariant?.id}
            selectedSize={sizeSelected}
          />

          {/* Trust strip */}
          <div className="mt-6 grid grid-cols-3 gap-0 border border-charcoal/10 bg-cream/50 text-center">
            {[
              { k: "Free US Shipping", v: "Orders $75+" },
              { k: "Free Returns", v: "Within 30 days" },
              { k: "Real Support", v: "Real people" },
            ].map((item, i) => (
              <div
                key={item.k}
                className={`px-3 py-3 ${i > 0 ? "border-l border-charcoal/10" : ""}`}
              >
                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-charcoal">
                  {item.k}
                </div>
                <div className="mt-0.5 text-[10px] text-charcoal/50">
                  {item.v}
                </div>
              </div>
            ))}
          </div>

          {/* Accordion sits right below the buy box on the right column. */}
          <PdpAccordion
            product={product}
            sizeGuide={sizeGuide}
            onOpenSizeChart={() => setSizeChartOpen(true)}
          />
        </div>
      </div>

      {/* Editorial deep-copy band */}
      {(editorialBody || detailImages.length > 0) && (
        <section className="mt-20 grid gap-12 md:grid-cols-2 md:gap-16">
          {editorialBody && (
            <div>
              <div
                className="text-[10px] font-mono uppercase tracking-[0.28em]"
                style={{ color: accent }}
              >
                The Details
              </div>
              <h2 className="mt-3 font-serif text-3xl leading-[1.15] tracking-tight text-charcoal md:text-4xl">
                Why the {product.name.split(" ").slice(-2).join(" ")} matters.
              </h2>
              <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-charcoal/75">
                {editorialBody.split(/\n\n+/).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
              <p className="mt-8 text-[10px] font-mono uppercase tracking-[0.24em] text-charcoal/40">
                More from{" "}
                <Link
                  href={`/shop/collection/shop-all`}
                  className="underline underline-offset-4 hover:text-charcoal"
                >
                  Shop All
                </Link>
              </p>
            </div>
          )}
          {detailImages.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {detailImages.map((src, i) => (
                <div
                  key={i}
                  className="relative aspect-square overflow-hidden bg-cream"
                >
                  <Image
                    src={src}
                    alt={`${product.name} detail ${i + 1}`}
                    fill
                    sizes="(max-width: 768px) 50vw, 25vw"
                    className="object-contain p-4"
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Ways to Wear It */}
      <WaysToWear currentProduct={product} catalog={outfitsCatalog} />

      {/* Related products */}
      {sameBrandProducts.length > 0 && (
        <section className="mt-20">
          <div className="mb-8 flex items-end justify-between">
            <h2 className="font-serif text-2xl tracking-tight text-charcoal md:text-3xl">
              More from {product.brand}
            </h2>
            <Link
              href="/shop/collection/shop-all"
              className="text-[10px] font-mono uppercase tracking-[0.24em] text-charcoal/50 hover:text-charcoal"
            >
              View all
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
            {sameBrandProducts.slice(0, 4).map((p) => (
              <ShopProductCard key={p.slug} product={p} accent={accent} />
            ))}
          </div>
        </section>
      )}

      {otherProducts.length > 0 && (
        <section className="mt-20 mb-8">
          <div className="mb-8 flex items-end justify-between">
            <h2 className="font-serif text-2xl tracking-tight text-charcoal md:text-3xl">
              You may also like
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
            {otherProducts.slice(0, 4).map((p) => (
              <ShopProductCard key={p.slug} product={p} accent={accent} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
