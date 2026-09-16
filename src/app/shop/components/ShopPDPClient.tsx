"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ShopifyProduct } from "@/lib/shopify";
import { trackEvent } from "@/lib/tracking";
import { useMembership } from "../../context/MembershipContext";
import {
  getInitialVariantSelection,
  resolveVariantBySelection,
  getDefaultProductVariant,
  hasVariantChoices,
  type ProductVariantSelection,
} from "@/lib/productVariants";
import { ProductVariantSelector } from "../../components/ProductVariantSelector";
import { orderProductImagesBySelection } from "@/lib/shopDisplay";
import { ProductImageGallery } from "./ShopClient";

interface ShopPDPClientProps {
  product: ShopifyProduct;
  initialSelection: ProductVariantSelection;
  accent: string;
}

/**
 * V1-storefront-style PDP:
 *  - Two-column grid, white background
 *  - Brand chip eyebrow, large serif title, price on the same row when possible
 *  - Description block, hairline, variant selector chips
 *  - Full-width rectangular Add to Cart button in the seasonal accent color
 *  - Optional dashed hairline and details accordion below
 */
export function ShopPDPClient({
  product,
  initialSelection,
  accent,
}: ShopPDPClientProps) {
  const { addToCart } = useMembership();
  const [selection, setSelection] = useState<ProductVariantSelection>(() =>
    getInitialVariantSelection(product, initialSelection)
  );
  const [added, setAdded] = useState(false);

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

  // Fire product_viewed once
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
        source: "shop_pdp_v2",
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

  return (
    <div className="grid gap-10 md:grid-cols-2 md:gap-14 lg:gap-20">
      {/* Left — Gallery */}
      <div>
        <ProductImageGallery
          key={galleryKey}
          images={orderedImages}
          name={product.name}
        />
      </div>

      {/* Right — Details */}
      <div className="flex flex-col">
        {/* Brand chip */}
        <span
          className="mb-4 inline-flex w-fit border border-charcoal/15 bg-white px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.24em] text-charcoal/70"
        >
          {product.brand}
        </span>

        {/* Title */}
        <h1 className="font-serif text-3xl leading-tight tracking-tight text-charcoal md:text-5xl">
          {product.name}
        </h1>

        {/* Short editorial description (why-we-like-it or description fallback) */}
        {(product.whyWeLikeIt || product.description) && (
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-charcoal/70">
            {product.whyWeLikeIt || product.description}
          </p>
        )}

        {/* Price */}
        <div className="mt-6 flex items-baseline gap-3">
          {showStrikethrough && (
            <span className="text-sm text-charcoal/40 line-through">
              ${retailPrice!.toFixed(2)}
            </span>
          )}
          <span className="font-serif text-3xl text-charcoal">
            ${price.toFixed(2)}
          </span>
        </div>

        {/* Dashed hairline */}
        <div className="my-8 border-t border-dashed border-charcoal/15" />

        {/* Variant selector */}
        {hasVariantChoices(product) && (
          <div className="mb-8">
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
          </div>
        )}

        {/* Add to cart — rectangular, accent color */}
        <button
          onClick={handleAdd}
          disabled={displayVariant?.availableForSale === false}
          className="flex w-full items-center justify-center py-4 text-[11px] font-mono uppercase tracking-[0.28em] text-white transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            backgroundColor:
              displayVariant?.availableForSale === false
                ? "#8a8a8a"
                : accent,
          }}
        >
          {displayVariant?.availableForSale === false
            ? "Unavailable"
            : added
              ? "Added to cart"
              : "Add to cart"}
        </button>
      </div>
    </div>
  );
}
