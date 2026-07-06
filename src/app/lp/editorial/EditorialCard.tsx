"use client";

/**
 * One editorial card — Uncrate-Supply pattern (rebuild, July 2026).
 *
 * Layout (top to bottom, all centered):
 *   ─────────────────────────────────
 *   [ product image, generous whitespace, no border ]
 *   ─────────────────────────────────
 *   TAG CHIP:  PARENT / CHILD   (tan, tracked, uppercase, 10px)
 *   TITLE (serif Playfair, uppercase, bold, ~20px)
 *   Deck (serif Playfair regular, ~15px, price ends the deck sentence)
 *   [ Read More ]  or  [ Buy from Vendor ]      (tan links, italic serif "or")
 *   ─────────────────────────────────
 *
 * The "Read More" link toggles an inline expansion of `editorialBody`.
 *
 * Copy source order (editorial voice only — never leak raw Shopify
 * product description into the card):
 *   1. `editorialHeadline` metafield (custom.editorial_headline)
 *   2. `whyWeLikeIt` metafield  (custom.why_we_like_it) — legacy fallback
 *   3. Blank — card renders name + price only.
 */

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { EditorialProduct } from "@/lib/shopifyEditorial";
import { resolveTieredPriceDisplay } from "@/lib/productPricing";
import { useMembership } from "../../context/MembershipContext";
import { QuickAddToCartButton } from "../../components/QuickAddToCartButton";
import { trackEvent } from "@/lib/tracking";
import { EDITORIAL_CATEGORY_LABELS } from "@/lib/shopifyEditorial";

interface EditorialCardProps {
  product: EditorialProduct;
  /**
   * Editorial issue number shown on the card. Undefined for destination
   * cards — they're editorial breaks, not numbered inventory. Currently
   * only used for analytics; not rendered on the card itself in the
   * Uncrate rebuild.
   */
  ordinal?: number;
  /** Ordinal position in the feed, used for analytics. */
  index: number;
  /**
   * Layout variant.
   * - `grid`  (default) — standard column card in the interleaved feed.
   * - `hero`  — full-width first card. Bigger image, longer deck.
   */
  variant?: "grid" | "hero";
  /**
   * Optional "Updated on ..." label rendered vertically along the left
   * edge of the hero image (Uncrate pattern). Only shown on `variant=hero`.
   */
  updatedAtLabel?: string;
  /** Fires when a guest adds — parent uses this to surface the Access upsell. */
  onGuestAddedToCart?: () => void;
}

/**
 * Short deck shown directly under the title, before the Read More expansion.
 * ~240 chars keeps two lines of serif copy at desktop. Editorial voice only,
 * never Shopify product body.
 */
function excerpt(product: EditorialProduct): string {
  const source =
    product.editorialHeadline?.trim() ||
    product.whyWeLikeIt?.trim() ||
    "";
  if (!source) return "";
  if (source.length <= 240) return source;
  const cut = source.slice(0, 240);
  const lastStop = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("? "),
    cut.lastIndexOf("! ")
  );
  return lastStop > 120 ? cut.slice(0, lastStop + 1) : cut.trimEnd() + "…";
}

/**
 * The `PARENT / CHILD` chip that sits above the title.
 *
 * PARENT = the editorial category (Style, Gear, Tech, Destinations,
 * Golf-Adjacent). CHILD = brand for merch, region for destinations,
 * or a subcategory hint for golf-adjacent items. If we don't have a
 * good child, we render the parent alone.
 */
function tagChipLabel(product: EditorialProduct): string {
  const cat = product.editorialCategory;
  const parent = cat ? EDITORIAL_CATEGORY_LABELS[cat] : "Featured";
  const isDestination = cat === "destinations";
  const isAffiliate = Boolean(product.affiliateVendor);
  // Affiliates use vendor as the child (already the same value as brand,
  // but stated explicitly here so the intent is obvious to future editors).
  const child = isDestination
    ? product.collection || product.brand
    : isAffiliate
    ? product.affiliateVendor
    : product.brand;
  if (child && child.trim() && child.toLowerCase() !== parent.toLowerCase()) {
    return `${parent} / ${child}`;
  }
  return parent;
}

/**
 * Human-readable vendor name for the outbound secondary link.
 * - Destinations render "Visit [Hostname]"
 * - Affiliates render "Buy at [Vendor]"
 * - Everything else (Shopify SKUs) uses the local Add-to-Cart flow.
 */
function vendorLinkLabel(product: EditorialProduct): string {
  if (product.editorialCategory === "destinations") {
    try {
      const host = new URL(product.destinationUrl).hostname
        .replace(/^www\./, "")
        .split(".")[0];
      return host ? `Visit ${host[0].toUpperCase()}${host.slice(1)}` : "Visit Site";
    } catch {
      return "Visit Site";
    }
  }
  if (product.affiliateVendor) {
    return `Buy at ${product.affiliateVendor}`;
  }
  return "Buy Now";
}

export function EditorialCard({
  product,
  ordinal,
  index,
  variant = "grid",
  updatedAtLabel,
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
  const isAffiliate = Boolean(product.affiliateVendor);
  // "Outbound" = the card's main link goes off-site in a new tab, not to
  // a local /shop/<slug> PDP. Both destinations and affiliates behave this
  // way. Everything else is a normal Shopify product with a local PDP.
  const isOutbound = isDestination || isAffiliate;
  const isHero = variant === "hero";
  const primary = product.images[0];
  const secondaryRaw = product.images[1];
  const hasSecondary = Boolean(secondaryRaw && secondaryRaw !== primary);
  const [hover, setHover] = useState(false);
  const [everHovered, setEverHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const chip = tagChipLabel(product);
  const shortDeck = excerpt(product);
  const longBody = (product.editorialBody || "").trim();
  const hasLongBody = longBody.length > shortDeck.length + 20;

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

  // Image tile height: hero is nearly full-viewport-width tall but ~30%
  // shorter than the original 16:9 pass so the copy below reads without
  // scrolling. Grid tiles stay square. All cards use object-cover so the
  // image fills the tile edge-to-edge — no double-background look
  // regardless of whether the source is a destination photo, an affiliate
  // vendor shot, or a Shopify product image on its own backdrop.
  const imageWrapperClass = isHero
    ? "block relative w-full aspect-[16/7] md:aspect-[21/8] bg-[#f7f6f2] overflow-hidden"
    : "block relative aspect-square bg-[#f7f6f2] overflow-hidden";

  const imageFitClass = "object-cover";

  const imageSizes = isHero
    ? "(max-width: 1023px) 100vw, 1000px"
    : "(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 360px";

  // ─── Event handlers wrapping the two image branches ────────────────────
  const onImageEnter = () => {
    setHover(true);
    if (hasSecondary) setEverHovered(true);
  };
  const onImageLeave = () => setHover(false);
  const onImageClick = () =>
    void trackEvent("editorial_card_click", {
      properties: {
        product_slug: product.slug,
        brand: product.brand,
        ordinal,
        index,
        variant,
        category: product.editorialCategory || "",
      },
    });

  const showUpdatedLabel = isHero && Boolean(updatedAtLabel);

  return (
    <article
      className={`group flex flex-col ${isHero ? "col-span-full" : ""}`}
      data-brand={product.brand}
      data-collection={product.collection}
      data-variant={variant}
    >
      {/* IMAGE TILE ─── wrapped in a positioning shell on hero so the
          vertical "Updated on ..." label can sit outside the image bounds. */}
      <div className={isHero ? "relative" : "contents"}>
        {showUpdatedLabel && (
          <span
            aria-label={updatedAtLabel}
            className="hidden md:flex absolute top-1/2 -translate-y-1/2 left-0 md:-left-2 lg:-left-4 -translate-x-full items-center gap-2 text-[10px] tracking-[0.32em] uppercase text-charcoal/50 select-none whitespace-nowrap origin-center rotate-180 [writing-mode:vertical-rl]"
          >
            <span aria-hidden className="inline-block h-[1px] w-6 bg-charcoal/25" />
            <span>{updatedAtLabel}</span>
          </span>
        )}
      {isOutbound ? (
        <a
          href={product.destinationUrl || "#"}
          target="_blank"
          rel={
            isAffiliate
              ? "noopener noreferrer sponsored"
              : "noopener noreferrer"
          }
          className={imageWrapperClass}
          onMouseEnter={onImageEnter}
          onMouseLeave={onImageLeave}
          onClick={onImageClick}
        >
          {primary && (
            <Image
              src={primary}
              alt={product.name}
              fill
              sizes={imageSizes}
              className={`${imageFitClass} transition-opacity duration-500 ${
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
              sizes={imageSizes}
              className={`${imageFitClass} transition-opacity duration-500 ${
                hover ? "opacity-100" : "opacity-0"
              }`}
              aria-hidden
              loading="lazy"
            />
          )}
        </a>
      ) : (
        <Link
          href={`/shop/${product.slug}`}
          className={imageWrapperClass}
          onMouseEnter={onImageEnter}
          onMouseLeave={onImageLeave}
          onClick={onImageClick}
        >
          {primary && (
            <Image
              src={primary}
              alt={product.name}
              fill
              sizes={imageSizes}
              className={`${imageFitClass} transition-opacity duration-500 ${
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
              sizes={imageSizes}
              className={`${imageFitClass} transition-opacity duration-500 ${
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
      </div>

      {/* COPY BLOCK ─── centered under image */}
      <div
        className={`text-center ${
          isHero
            ? "pt-8 md:pt-10 px-6 md:px-16 max-w-4xl mx-auto"
            : "pt-6 md:pt-7 px-2"
        }`}
      >
        {/* Tag chip: PARENT / CHILD */}
        <div className="text-[10px] md:text-[11px] tracking-[0.28em] uppercase text-taupe mb-3 md:mb-4">
          {chip}
        </div>

        {/* Title */}
        <h2
          className={`font-serif font-bold uppercase text-charcoal leading-[1.15] mb-3 ${
            isHero
              ? "text-[26px] md:text-[38px] tracking-[0.02em]"
              : "text-[17px] md:text-[19px] tracking-[0.03em]"
          }`}
        >
          {isOutbound ? (
            <a
              href={product.destinationUrl || "#"}
              target="_blank"
              rel={
                isAffiliate
                  ? "noopener noreferrer sponsored"
                  : "noopener noreferrer"
              }
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

        {/* Deck: excerpt sentence ending with price for merch, or a
            display-only price string for affiliates. Destinations get
            no price line at all. */}
        {(shortDeck || !isDestination) && (
          <p
            className={`font-serif text-charcoal/85 mx-auto ${
              isHero
                ? "text-[16px] md:text-[18px] leading-[1.55] max-w-[52ch] mb-6"
                : "text-[14.5px] md:text-[15px] leading-[1.6] max-w-[38ch] mb-5"
            }`}
          >
            {shortDeck}
            {shortDeck && !isDestination && " "}
            {!isDestination && isAffiliate && product.affiliateDisplayPrice && (
              <span className="whitespace-nowrap font-medium">
                {product.affiliateDisplayPrice}.
              </span>
            )}
            {!isDestination && !isAffiliate && (
              <span className="whitespace-nowrap">
                {priceDisplay.compareAtPrice != null ? (
                  <>
                    <span className="text-charcoal/45 line-through">
                      ${priceDisplay.compareAtPrice.toFixed(0)}
                    </span>{" "}
                    <span className="text-ember font-medium">
                      ${priceDisplay.activePrice.toFixed(0)}.
                    </span>
                  </>
                ) : (
                  <span className="font-medium">
                    ${priceDisplay.activePrice.toFixed(0)}.
                  </span>
                )}
              </span>
            )}
          </p>
        )}

        {/* Expanded editorial body */}
        {expanded && hasLongBody && (
          <div
            className={`font-serif text-charcoal/80 mx-auto text-left mb-6 space-y-4 ${
              isHero
                ? "text-[15.5px] leading-[1.7] max-w-[62ch]"
                : "text-[14px] leading-[1.7] max-w-[46ch]"
            }`}
          >
            {longBody.split(/\n{2,}/).map((para, i) => (
              <p key={i}>{para.trim()}</p>
            ))}
          </div>
        )}

        {/* Actions: Read More  or  Buy Now / Visit ─── */}
        <div className="flex items-baseline justify-center gap-3 text-[13px] md:text-[14px] font-serif">
          {hasLongBody && (
            <>
              <button
                type="button"
                onClick={() => {
                  setExpanded((v) => !v);
                  void trackEvent("editorial_read_more_toggle", {
                    properties: {
                      product_slug: product.slug,
                      expanded: !expanded,
                      variant,
                    },
                  });
                }}
                className="text-taupe hover:text-forest underline underline-offset-4 decoration-taupe/50 hover:decoration-forest/70 transition-colors cursor-pointer"
                aria-expanded={expanded}
              >
                {expanded ? "Less" : "Read More"}
              </button>
              <span className="italic text-charcoal/50">or</span>
            </>
          )}

          {isOutbound ? (
            <a
              href={product.destinationUrl || "#"}
              target="_blank"
              rel={
                isAffiliate
                  ? "noopener noreferrer sponsored"
                  : "noopener noreferrer"
              }
              onClick={() =>
                void trackEvent(
                  isAffiliate
                    ? "editorial_affiliate_click"
                    : "editorial_destination_click",
                  {
                    properties: {
                      product_slug: product.slug,
                      brand: product.brand,
                      vendor: product.affiliateVendor ?? undefined,
                      ordinal,
                      index,
                    },
                  }
                )
              }
              className="text-taupe hover:text-forest underline underline-offset-4 decoration-taupe/50 hover:decoration-forest/70 transition-colors"
            >
              {vendorLinkLabel(product)}
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
                    variant,
                  },
                });
                if (!isSignedIn && onGuestAddedToCart) {
                  onGuestAddedToCart();
                }
              }}
              idleClassName="text-taupe hover:text-forest underline underline-offset-4 decoration-taupe/50 hover:decoration-forest/70 transition-colors cursor-pointer"
              addedClassName="text-sage underline underline-offset-4 decoration-sage/60"
              idleContent={<span>Add to Cart</span>}
              addedContent={<span>Added ✓</span>}
              buttonAriaLabel={`Add ${product.name} to cart`}
              modalTitle={product.name}
            />
          )}
        </div>
      </div>
    </article>
  );
}
