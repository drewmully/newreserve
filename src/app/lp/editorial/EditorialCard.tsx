"use client";

/**
 * One editorial card — Uncrate-Supply pattern.
 *
 * Structure (top to bottom, all centered):
 *   - Bordered image tile, subtle backdrop, hover cross-fade to secondary
 *   - Ordinal (small, uppercase, tracked)
 *   - Product name (BOLD UPPERCASE, condensed line-height)
 *   - Price line: retail  /  reserve (like "$198 / $138" on Uncrate sale)
 *   - 1-2 sentence editorial excerpt
 *   - Quiet "Add to Cart" underline link
 *
 * Copy source order:
 *   1. `whyWeLikeIt` metafield
 *   2. First sentence of `description`
 *   3. Blank
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
  /** Editorial issue number shown on the card. */
  ordinal: number;
  /** Ordinal position in the feed, used for analytics. */
  index: number;
  /** Fires when a guest adds — parent uses this to surface the Access upsell. */
  onGuestAddedToCart?: () => void;
}

function excerpt(product: EditorialProduct): string {
  const source =
    product.whyWeLikeIt?.trim() || product.description?.trim() || "";
  if (!source) return "";
  if (source.length <= 140) return source;
  const cut = source.slice(0, 140);
  const lastStop = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("? "),
    cut.lastIndexOf("! ")
  );
  return lastStop > 70 ? cut.slice(0, lastStop + 1) : cut.trimEnd() + "…";
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function EditorialCard({
  product,
  ordinal,
  index,
  onGuestAddedToCart,
}: EditorialCardProps) {
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
      className="group flex flex-col"
      data-brand={product.brand}
      data-collection={product.collection}
    >
      {/* IMAGE TILE ─── */}
      <Link
        href={`/shop/${product.slug}`}
        className="block relative aspect-square bg-[#f7f6f2] border border-charcoal/[0.08] overflow-hidden"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() =>
          void trackEvent("editorial_card_click", {
            properties: {
              product_slug: product.slug,
              brand: product.brand,
              ordinal,
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
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className={`object-contain p-6 md:p-8 transition-opacity duration-500 ${
              hover && secondary && secondary !== primary
                ? "opacity-0"
                : "opacity-100"
            }`}
            priority={index < 3}
          />
        )}
        {secondary && secondary !== primary && (
          <Image
            src={secondary}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className={`object-contain p-6 md:p-8 transition-opacity duration-500 ${
              hover ? "opacity-100" : "opacity-0"
            }`}
            aria-hidden
          />
        )}

        {isPrivate && (
          <div className="absolute top-3 right-3 px-2 py-1 bg-forest text-bone text-[9px] tracking-[0.22em] uppercase">
            Private
          </div>
        )}
      </Link>

      {/* COPY BLOCK — centered under image ─── */}
      <div className="pt-6 md:pt-7 text-center px-2">
        <div className="text-[10px] tracking-[0.28em] uppercase text-charcoal/40 mb-3">
          № {pad(ordinal)} &nbsp;·&nbsp; {product.brand}
        </div>

        <h2 className="font-sans text-[13px] md:text-[14px] font-semibold tracking-[0.08em] uppercase leading-[1.35] text-charcoal mb-2">
          <Link
            href={`/shop/${product.slug}`}
            className="hover:text-forest transition-colors"
          >
            {product.name}
          </Link>
        </h2>

        {/* Price line — retail slash reserve, Uncrate-style */}
        <div className="text-[13px] text-charcoal mb-4 flex items-baseline justify-center gap-1.5">
          {priceDisplay.compareAtPrice != null ? (
            <>
              <span className="text-charcoal/45 line-through">
                ${priceDisplay.compareAtPrice.toFixed(0)}
              </span>
              <span className="text-charcoal/30">/</span>
              <span className="text-ember font-medium">
                ${priceDisplay.activePrice.toFixed(0)}
              </span>
            </>
          ) : priceDisplay.memberPrice != null ? (
            <>
              <span>${priceDisplay.activePrice.toFixed(0)}</span>
              <span className="text-charcoal/30">/</span>
              <span className="text-forest/80 text-[11px] tracking-widest uppercase">
                ${priceDisplay.memberPrice.toFixed(0)} member
              </span>
            </>
          ) : (
            <span>${priceDisplay.activePrice.toFixed(0)}</span>
          )}
        </div>

        {excerpt(product) && (
          <p className="text-[13.5px] leading-[1.6] text-charcoal/70 max-w-[34ch] mx-auto mb-5">
            {excerpt(product)}
          </p>
        )}

        <QuickAddToCartButton
          product={product}
          isPaid={isPaid}
          onAddToCart={async (item) => {
            await addToCart(item);
            void trackEvent("editorial_add_to_cart", {
              properties: {
                product_slug: product.slug,
                brand: product.brand,
                ordinal,
                index,
                is_signed_in: isSignedIn,
              },
            });
            if (!isSignedIn && onGuestAddedToCart) {
              onGuestAddedToCart();
            }
          }}
          idleClassName="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-charcoal/70 border-b border-charcoal/30 hover:border-charcoal hover:text-charcoal pb-1 transition-all cursor-pointer"
          addedClassName="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-sage border-b border-sage pb-1"
          idleContent={
            <>
              <span>Add to Cart</span>
              <span aria-hidden>+</span>
            </>
          }
          addedContent={<span>Added ✓</span>}
          buttonAriaLabel={`Add ${product.name} to cart`}
          modalTitle={product.name}
        />
      </div>
    </article>
  );
}
