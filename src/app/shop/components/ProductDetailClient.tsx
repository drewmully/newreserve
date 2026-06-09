"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ShopifyProduct } from "@/lib/shopify";
import { trackEvent } from "@/lib/tracking";
import {
  getInitialVariantSelection,
  resolveVariantBySelection,
  type ProductVariantSelection,
} from "@/lib/productVariants";
import { orderProductImagesBySelection } from "@/lib/shopDisplay";
import {
  ProductImageGallery,
  ProductPriceDisplay,
  AddToCartButton,
} from "./ShopClient";

interface ProductDetailClientProps {
  product: ShopifyProduct;
  initialSelection: ProductVariantSelection;
  /** Rendered inside the right-hand details column, below Add to Cart. */
  detailsFooter?: ReactNode;
}

/**
 * Client wrapper for the PDP that lifts variant selection state above both
 * the gallery and the add-to-cart button. As the user changes color/size,
 * the gallery re-orders so the matching photo appears first.
 */
export function ProductDetailClient({
  product,
  initialSelection,
  detailsFooter,
}: ProductDetailClientProps) {
  const [selection, setSelection] = useState<ProductVariantSelection>(() =>
    getInitialVariantSelection(product, initialSelection)
  );

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

  // Fire proshop_product_viewed once on mount. Captures source (dashboard vs public)
  // via referrer/path so we can attribute PDP traffic back to where members entered.
  const viewedRef = useRef(false);
  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    let source: string = "direct";
    try {
      const ref = typeof document !== "undefined" ? document.referrer : "";
      if (ref) {
        const refUrl = new URL(ref);
        if (refUrl.pathname.startsWith("/dashboard")) source = "dashboard-shop";
        else if (refUrl.pathname.startsWith("/shop")) source = "public-shop";
        else if (refUrl.pathname.startsWith("/account")) source = "account";
        else if (refUrl.hostname && refUrl.hostname !== window.location.hostname) {
          source = `external:${refUrl.hostname}`;
        } else {
          source = `internal:${refUrl.pathname}`;
        }
      }
    } catch {
      /* ignore */
    }
    trackEvent("proshop_product_viewed", {
      properties: {
        product_slug: product.slug,
        variant_id: product.variantId,
        name: product.name,
        brand: product.brand,
        collection: product.collection,
        collection_handle: "reserve-pro-shop",
        price: product.price,
        reserve_price: product.reservePrice,
        source,
      },
    });
  }, [
    product.slug,
    product.variantId,
    product.name,
    product.brand,
    product.collection,
    product.price,
    product.reservePrice,
  ]);

  // Reset gallery to the first image whenever the color changes. We key the
  // gallery by the current color value so its internal activeIndex resets.
  const colorOption = product.options?.find((o) => /^colou?r$/i.test(o.name));
  const galleryKey = colorOption ? selection[colorOption.name] ?? "default" : "default";

  return (
    <div className="grid md:grid-cols-2 gap-8 md:gap-14 lg:gap-20">
      {/* Left - Images */}
      <div>
        <ProductImageGallery
          key={galleryKey}
          images={orderedImages}
          name={product.name}
        />
      </div>

      {/* Right - Details */}
      <div className="flex flex-col">
        <p className="text-xs tracking-[0.25em] uppercase text-sage font-medium mb-2">
          {product.brand}
        </p>
        <h1 className="font-serif text-2xl md:text-3xl text-obsidian leading-tight mb-4">
          {product.name}
        </h1>

        {/* Price */}
        <div className="mb-6 pb-6 border-b border-taupe/20">
          <ProductPriceDisplay
            price={selectedVariant?.price ?? product.price}
            reservePrice={selectedVariant?.reservePrice ?? product.reservePrice}
          />
        </div>

        {/* Short description */}
        <p className="text-sm text-charcoal/60 leading-relaxed mb-8">
          {product.description}
        </p>

        {/* Add to cart — owns the variant selector UI, controlled */}
        <div className="mb-8">
          <AddToCartButton
            product={{
              ...product,
              images: orderedImages,
              variantId: selectedVariant?.id ?? product.variantId,
              initialSelection: selection,
            }}
            selection={selection}
            onSelectionChange={setSelection}
          />
        </div>

        {detailsFooter}
      </div>
    </div>
  );
}
