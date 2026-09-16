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
import { ProductVariantSelector } from "../../components/ProductVariantSelector";
import { orderProductImagesBySelection } from "@/lib/shopDisplay";
import { ProductImageGallery } from "./ShopClient";
import { ShopProductCard } from "./ShopProductCard";
import { getSizeGuide } from "@/lib/sizeCharts";
import { SizeFitChart } from "./SizeFitChart";
import { NotifyMeInline } from "./NotifyMeInline";

interface ShopPDPClientProps {
  product: ShopifyProduct;
  initialSelection: ProductVariantSelection;
  accent: string;
  relatedProducts?: ShopifyProduct[];
}

/**
 * Huckberry-style PDP anatomy:
 *  - Left: gallery
 *  - Right: brand chip → title + price → editorial subhead → variant chips
 *      → Add to cart → trust badges → delivery estimate
 *  - Below: big editorial section with H2 headline + long body
 *  - Detail image grid (if 2+ images)
 *  - Accordion: Sizing, Materials & Care, About the Brand
 *  - Related-brand and related-collection carousels (if provided)
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
  const [openAccordion, setOpenAccordion] = useState<string | null>("sizing");
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
  // Show size chips when the product genuinely has choices, OR when we know
  // the product should have sizes (curated size guide present) so shoppers
  // still see the fit story even before variants are wired.
  const showVariantSelector = productHasVariantChoices || Boolean(sizeGuide);
  const allVariantsSoldOut =
    getProductVariants(product).every((v) => v.availableForSale === false);
  const currentVariantUnavailable = displayVariant?.availableForSale === false;
  const sizeSelected = sizeGuide
    ? selection[
        Object.keys(selection).find((k) => /^size$/i.test(k)) ?? "Size"
      ]
    : undefined;
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
        source: "shop_pdp_v3",
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

  const toggleAccordion = (id: string) =>
    setOpenAccordion(openAccordion === id ? null : id);

  return (
    <div className="mx-auto max-w-7xl">
      {sizeChartOpen && sizeGuide && (
        <SizeFitChart
          guide={sizeGuide}
          productName={product.name}
          onClose={() => setSizeChartOpen(false)}
        />
      )}
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
          <span className="mb-4 inline-flex w-fit border border-charcoal/15 bg-white px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.24em] text-charcoal/70">
            {product.brand}
          </span>

          <h1 className="font-serif text-3xl leading-tight tracking-tight text-charcoal md:text-4xl">
            {product.name}
          </h1>

          <div className="mt-4 flex items-baseline gap-3">
            {showStrikethrough && (
              <span className="text-sm text-charcoal/40 line-through">
                ${retailPrice!.toFixed(2)}
              </span>
            )}
            <span className="font-serif text-2xl text-charcoal">
              ${price.toFixed(2)}
            </span>
          </div>

          {editorialHeadline && (
            <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-charcoal/70">
              {editorialHeadline}
            </p>
          )}

          <div className="my-8 border-t border-dashed border-charcoal/15" />

          {showVariantSelector && (
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
              ) : (
                // Fallback greyed chips when we know the product should carry
                // sizes but Shopify hasn't been set up yet. Non-interactive.
                <div className="flex flex-wrap gap-2">
                  {sizeGuide!.chart.rows.map((row) => (
                    <span
                      key={row.size}
                      className="cursor-not-allowed rounded-full border border-charcoal/10 bg-cream px-3 py-2 text-xs font-medium text-charcoal/30"
                    >
                      {row.size}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {allVariantsSoldOut ? (
            <NotifyMeInline
              productSlug={product.slug}
              productName={product.name}
              variantId={displayVariant?.id}
              selectedSize={sizeSelected}
              accent={accent}
            />
          ) : (
            <button
              onClick={handleAdd}
              disabled={currentVariantUnavailable}
              className="flex w-full items-center justify-center py-4 text-[11px] font-mono uppercase tracking-[0.28em] text-white transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                backgroundColor: currentVariantUnavailable
                  ? "#8a8a8a"
                  : accent,
              }}
            >
              {currentVariantUnavailable
                ? "Sold out"
                : added
                  ? "Added to cart"
                  : "Add to cart"}
            </button>
          )}

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

      {/* Accordion */}
      <section className="mt-20 border-t border-charcoal/10">
        {[
          { id: "sizing", label: "Sizing & Fit", body: product.sizing },
          {
            id: "materials",
            label: "Materials & Care",
            body: product.material,
          },
          { id: "brand", label: `About ${product.brand}`, body: product.aboutBrand },
        ]
          .filter((row) => row.body && row.body.trim().length > 0)
          .map((row) => (
            <div key={row.id} className="border-b border-charcoal/10">
              <button
                onClick={() => toggleAccordion(row.id)}
                className="flex w-full items-center justify-between py-6 text-left transition-colors hover:bg-cream/40"
              >
                <span className="font-serif text-lg tracking-tight text-charcoal md:text-xl">
                  {row.label}
                </span>
                <span
                  className="text-2xl text-charcoal/40"
                  aria-hidden="true"
                >
                  {openAccordion === row.id ? "−" : "+"}
                </span>
              </button>
              {openAccordion === row.id && (
                <div className="pb-6 pr-8 text-[15px] leading-relaxed text-charcoal/70">
                  {row.body}
                </div>
              )}
            </div>
          ))}
      </section>

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
