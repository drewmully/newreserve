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
 * Copy source order (editorial voice only — never leak raw Shopify
 * product description into the card):
 *   1. `editorialHeadline` metafield (custom.editorial_headline)
 *   2. `whyWeLikeIt` metafield  (custom.why_we_like_it)  — legacy fallback
 *   3. Blank  — forces editorial discipline. If a product has no
 *      editorial copy set, the card renders name + price only.
 */

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { EditorialProduct } from "@/lib/shopifyEditorial";
import { resolveTieredPriceDisplay } from "@/lib/productPricing";
import { useMembership } from "../../context/MembershipContext";
import { QuickAddToCartButton } from "../../components/QuickAddToCartButton";
import { trackEvent } from "@/lib/tracking";

interface EditorialCardProps {
  product: EditorialProduct;
  /**
   * Editorial issue number shown on the card. Undefined for destination
   * cards — they're editorial breaks, not numbered inventory.
   */
  ordinal?: number;
  /** Ordinal position in the feed, used for analytics. */
  index: number;
  /** Fires when a guest adds — parent uses this to surface the Access upsell. */
  onGuestAddedToCart?: () => void;
}

function excerpt(product: EditorialProduct): string {
  // Editorial-only sources. Raw `product.description` is intentionally NOT
  // a fallback — vendor copy is usually spec-sheet or marketing fluff and
  // breaks the Uncrate-style voice we want on this page.
  const source =
    product.editorialHeadline?.trim() ||
    product.whyWeLikeIt?.trim() ||
    "";
  if (!source) return "";
  if (source.length <= 160) return source;
  const cut = source.slice(0, 160);
  const lastStop = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("? "),
    cut.lastIndexOf("! ")
  );
  return lastStop > 80 ? cut.slice(0, lastStop + 1) : cut.trimEnd() + "…";
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
  const isDestination = product.editorialCategory === "destinations";
  const primary = product.images[0];
  const secondaryRaw = product.images[1];
  const hasSecondary = Boolean(secondaryRaw && secondaryRaw !== primary);
  const [hover, setHover] = useState(false);
  // Only actually mount the secondary <Image> once the user hovers. Prevents
  // paying for a second Shopify request per card on initial load.
  const [everHovered, setEverHovered] = useState(false);

  // Shopify CDN can synthesize a tiny blurred placeholder by appending a
  // `width` param. 24px is ~1KB and gives us instant paint under a blur-up.
  const blurUrl = useMemo(() => {
    if (!primary) return undefined;
    try {
      const u = new URL(primary);
      if (u.hostname === "cdn.shopify.com") {
        u.searchParams.set("width", "24");
        return u.toString();
      }
    } catch {}
    return undefined;
  }, [primary]);

  return (
    <article
      className="group flex flex-col"
      data-brand={product.brand}
      data-collection={product.collection}
    >
      {/* IMAGE TILE ─── */}
      {isDestination ? (
        <a
          href={product.destinationUrl || "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="block relative aspect-square bg-[#f7f6f2] border border-charcoal/[0.08] overflow-hidden"
          onMouseEnter={() => {
            setHover(true);
            if (hasSecondary) setEverHovered(true);
          }}
          onMouseLeave={() => setHover(false)}
          onClick={() =>
            void trackEvent("editorial_card_click", {
              properties: {
                product_slug: product.slug,
                brand: product.brand,
                ordinal,
                index,
                category: "destinations",
              },
            })
          }
        >
          {primary && (
            <Image
              src={primary}
              alt={product.name}
              fill
              sizes="(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 360px"
              className={`object-cover transition-opacity duration-500 ${
                hover && hasSecondary ? "opacity-0" : "opacity-100"
              }`}
              priority={index < 3}
              loading={index < 3 ? undefined : "lazy"}
              placeholder={blurUrl ? "blur" : "empty"}
              blurDataURL={blurUrl}
            />
          )}
          {hasSecondary && everHovered && (
            <Image
              src={secondaryRaw!}
              alt=""
              fill
              sizes="(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 360px"
              className={`object-cover transition-opacity duration-500 ${
                hover ? "opacity-100" : "opacity-0"
              }`}
              aria-hidden
              loading="lazy"
            />
          )}
          <div className="absolute top-3 right-3 px-2 py-1 bg-forest text-bone text-[9px] tracking-[0.22em] uppercase">
            Destination
          </div>
        </a>
      ) : (
      <Link
        href={`/shop/${product.slug}`}
        className="block relative aspect-square bg-[#f7f6f2] border border-charcoal/[0.08] overflow-hidden"
        onMouseEnter={() => {
          setHover(true);
          if (hasSecondary) setEverHovered(true);
        }}
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
            // Tight sizes so the browser fetches the smallest usable width.
            // Mobile is single column (100vw), tablet 2-col (50vw), desktop 3-col (~360px).
            sizes="(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 360px"
            className={`object-contain p-5 md:p-6 transition-opacity duration-500 ${
              hover && hasSecondary ? "opacity-0" : "opacity-100"
            }`}
            // Only the first row above the fold is priority; everything else
            // lazy-loads as it enters the viewport.
            priority={index < 3}
            loading={index < 3 ? undefined : "lazy"}
            placeholder={blurUrl ? "blur" : "empty"}
            blurDataURL={blurUrl}
          />
        )}
        {hasSecondary && everHovered && (
          <Image
            src={secondaryRaw!}
            alt=""
            fill
            sizes="(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 360px"
            className={`object-contain p-5 md:p-6 transition-opacity duration-500 ${
              hover ? "opacity-100" : "opacity-0"
            }`}
            aria-hidden
            loading="lazy"
          />
        )}

        {isPrivate && (
          <div className="absolute top-3 right-3 px-2 py-1 bg-forest text-bone text-[9px] tracking-[0.22em] uppercase">
            Private
          </div>
        )}
      </Link>
      )}

      {/* COPY BLOCK — centered under image ─── */}
      <div className="pt-6 md:pt-7 text-center px-2">
        <div className="text-[10px] tracking-[0.28em] uppercase text-charcoal/40 mb-3">
          {isDestination ? (
            <span>Destination &nbsp;·&nbsp; {product.collection}</span>
          ) : (
            <span>
              № {pad(ordinal ?? 0)} &nbsp;·&nbsp; {product.brand}
            </span>
          )}
        </div>

        <h2 className="font-sans text-[13px] md:text-[14px] font-semibold tracking-[0.08em] uppercase leading-[1.35] text-charcoal mb-2">
          {isDestination ? (
            <a
              href={product.destinationUrl || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-forest transition-colors"
            >
              {product.name}
            </a>
          ) : (
            <Link
              href={`/shop/${product.slug}`}
              className="hover:text-forest transition-colors"
            >
              {product.name}
            </Link>
          )}
        </h2>

        {/* Price line — retail slash reserve, Uncrate-style. Hidden for destinations. */}
        {isDestination ? (
          <div className="text-[11px] tracking-[0.24em] uppercase text-charcoal/50 mb-4">
            {product.collection || "Golf Resort"}
          </div>
        ) : (
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
        )}

        {excerpt(product) && (
          <p className="text-[13.5px] leading-[1.6] text-charcoal/70 max-w-[34ch] mx-auto mb-5">
            {excerpt(product)}
          </p>
        )}

        {isDestination ? (
          <a
            href={product.destinationUrl || "#"}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
              void trackEvent("editorial_destination_click", {
                properties: {
                  product_slug: product.slug,
                  brand: product.brand,
                  ordinal,
                  index,
                },
              })
            }
            className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-charcoal/70 border-b border-charcoal/30 hover:border-charcoal hover:text-charcoal pb-1 transition-all"
          >
            <span>Visit Course</span>
            <span aria-hidden>&rarr;</span>
          </a>
        ) : (
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
        )}
      </div>
    </article>
  );
}
