"use client";

/**
 * One product = one editorial post.
 *
 * The card is the whole story. Big image, single sentence of copy, a quiet
 * "Add" affordance. Mobile-first: image is full-bleed and square-ish, text
 * sits underneath. On desktop the image dominates 60% and text lives right.
 *
 * Copy sourcing (in order of preference):
 *   1. `whyWeLikeIt` metafield — the editorial voice from the Shopify admin.
 *   2. First 140 chars of `description` — fallback, still curated.
 *   3. Blank — we'd rather show nothing than filler.
 */

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { EditorialProduct } from "@/lib/shopifyEditorial";
import { resolveTieredPriceDisplay } from "@/lib/productPricing";
import { useMembership } from "../../context/MembershipContext";
import { QuickAddToCartButton } from "../../components/QuickAddToCartButton";
import { trackEvent } from "@/lib/tracking";

interface EditorialCardProps {
  product: EditorialProduct;
  /** Ordinal position in the feed, for editorial numbering (01, 02…). */
  index: number;
  /** Fires when a guest adds — parent uses this to surface the Access upsell. */
  onGuestAddedToCart?: () => void;
}

function excerpt(product: EditorialProduct): string {
  const source =
    product.whyWeLikeIt?.trim() || product.description?.trim() || "";
  if (!source) return "";
  if (source.length <= 160) return source;
  // Cut on the last sentence-ending punctuation within 160.
  const cut = source.slice(0, 160);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return lastStop > 80 ? cut.slice(0, lastStop + 1) : cut.trimEnd() + "…";
}

function ordinal(n: number): string {
  return String(n + 1).padStart(2, "0");
}

export function EditorialCard({ product, index, onGuestAddedToCart }: EditorialCardProps) {
  const { tier, addToCart, isSignedIn } = useMembership();
  const isPaid = tier !== "free";

  const priceDisplay = resolveTieredPriceDisplay(
    { price: product.price, reservePrice: product.reservePrice },
    isPaid
  );

  const isPrivate = product.sourceCollections?.includes("private-releases");
  const primary = product.images[0];
  const secondary = product.images[1] ?? product.images[0];
  const [hover, setHover] = useState(false);

  return (
    <article
      className="group relative"
      // Data attributes let the feed section-jump find & scroll to us.
      data-brand={product.brand}
      data-collection={product.collection}
    >
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10 items-start">
        {/* IMAGE — full bleed on mobile, 7 cols on desktop */}
        <Link
          href={`/shop/${product.slug}`}
          className="col-span-1 md:col-span-7 block relative overflow-hidden bg-bone-dark aspect-[4/5] md:aspect-[5/6]"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={() =>
            void trackEvent("editorial_card_click", {
              properties: {
                product_slug: product.slug,
                brand: product.brand,
                index,
              },
            })
          }
        >
          {primary && (
            <Image
              src={primary}
              alt={product.name}
              fill
              sizes="(max-width: 768px) 100vw, 60vw"
              className={`object-cover transition-opacity duration-700 ${
                hover && secondary && secondary !== primary
                  ? "opacity-0"
                  : "opacity-100"
              }`}
              priority={index < 2}
            />
          )}
          {secondary && secondary !== primary && (
            <Image
              src={secondary}
              alt=""
              fill
              sizes="(max-width: 768px) 100vw, 60vw"
              className={`object-cover transition-opacity duration-700 ${
                hover ? "opacity-100" : "opacity-0"
              }`}
              aria-hidden
            />
          )}

          {/* Corner ordinal, upper left — small, quiet */}
          <div className="absolute top-4 left-4 text-[10px] tracking-[0.25em] uppercase text-bone/85 mix-blend-difference">
            №&nbsp;{ordinal(index)}
          </div>

          {/* Private-release badge, upper right */}
          {isPrivate && (
            <div className="absolute top-4 right-4 px-2 py-1 bg-forest text-bone text-[9px] tracking-[0.22em] uppercase">
              Private Release
            </div>
          )}
        </Link>

        {/* COPY — sits below on mobile, 5 cols on desktop */}
        <div className="col-span-1 md:col-span-5 md:pt-6">
          <div className="text-[10px] tracking-[0.25em] uppercase text-charcoal/50 mb-3">
            {product.brand} <span className="mx-1.5 text-charcoal/25">/</span>{" "}
            {product.collection}
          </div>

          <h2 className="font-serif text-2xl md:text-3xl leading-tight text-forest mb-3">
            <Link
              href={`/shop/${product.slug}`}
              className="hover:text-forest-dark transition-colors"
            >
              {product.name}
            </Link>
          </h2>

          {excerpt(product) && (
            <p className="text-[15px] leading-[1.65] text-charcoal/80 mb-6 max-w-[52ch]">
              {excerpt(product)}
            </p>
          )}

          {/* Price + add row */}
          <div className="flex items-center gap-4 mb-2">
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-xl text-forest">
                ${priceDisplay.activePrice.toFixed(0)}
              </span>
              {priceDisplay.compareAtPrice != null && (
                <span className="text-sm text-charcoal/45 line-through">
                  ${priceDisplay.compareAtPrice.toFixed(0)}
                </span>
              )}
              {priceDisplay.memberPrice != null && (
                <span className="text-[11px] tracking-widest uppercase text-forest/70 ml-1">
                  · ${priceDisplay.memberPrice.toFixed(0)} for members
                </span>
              )}
            </div>
          </div>

          <QuickAddToCartButton
            product={product}
            isPaid={isPaid}
            onAddToCart={async (item) => {
              await addToCart(item);
              void trackEvent("editorial_add_to_cart", {
                properties: {
                  product_slug: product.slug,
                  brand: product.brand,
                  index,
                  is_signed_in: isSignedIn,
                },
              });
              if (!isSignedIn && onGuestAddedToCart) {
                onGuestAddedToCart();
              }
            }}
            idleClassName="mt-3 inline-flex items-center gap-2 text-xs tracking-[0.22em] uppercase text-forest border-b border-forest/40 hover:border-forest pb-1 transition-all cursor-pointer"
            addedClassName="mt-3 inline-flex items-center gap-2 text-xs tracking-[0.22em] uppercase text-sage border-b border-sage pb-1"
            idleContent={
              <>
                <span>Add to Cart</span>
                <span aria-hidden>&rarr;</span>
              </>
            }
            addedContent={<span>Added ✓</span>}
            buttonAriaLabel={`Add ${product.name} to cart`}
            modalTitle={product.name}
          />

          <Link
            href={`/shop/${product.slug}`}
            className="mt-3 md:mt-4 block text-xs tracking-[0.22em] uppercase text-charcoal/45 hover:text-forest transition-colors"
          >
            Read the story &nbsp;·&nbsp; Full details
          </Link>
        </div>
      </div>
    </article>
  );
}
