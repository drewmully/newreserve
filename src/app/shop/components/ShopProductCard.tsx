"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { ShopifyProduct } from "@/lib/shopify";
import type { ShopSwatch } from "@/lib/shopColorCards";
import { useMembership } from "../../context/MembershipContext";
import { shopProductPhoto, shopProductLabel } from "@/lib/shopProductPhotos";
import { swatchBackground } from "@/lib/shopSwatches";
import { money } from "@/lib/shopOutfit";

type CardProduct = ShopifyProduct & {
  displayKey?: string;
  cardColor?: string;
  cardImage?: string;
  cardImageFit?: "cover";
  preferredVariantId?: string;
  colorCount?: number;
  swatches?: ShopSwatch[];
};

/**
 * V1-style product card: white background, object-contain image with generous
 * padding, brand eyebrow, name, retail price (member price for paid tiers).
 *
 * Category pages pass one card per color (color dot + "+N more colors").
 * Shop all passes one card per product with `swatches`; hovering or tapping a
 * swatch swaps the photo, color name, link and preorder note in place.
 */
export function ShopProductCard({
  product,
  accent,
}: {
  product: CardProduct;
  /** Optional accent hex used for the member-price highlight, per seasonal theme. */
  accent?: string;
}) {
  const { hasShopDiscount: isMember } = useMembership();
  const displayPrice = isMember ? product.reservePrice : product.price;
  const [active, setActive] = useState(0);

  const swatch = product.swatches?.[active];
  const color = swatch?.color ?? product.cardColor;
  const variantId = swatch ? swatch.variantId : product.preferredVariantId;
  const hero = swatch?.image || product.cardImage || shopProductPhoto(product);
  const cover = (swatch ? swatch.fit : product.cardImageFit) === "cover";
  const href = variantId
    ? `/shop/${product.slug}?variant=${encodeURIComponent(variantId)}`
    : `/shop/${product.slug}`;
  const colorVariants = color
    ? product.variants.filter(v => v.selectedOptions?.some(o => /^colou?r$/i.test(o.name) && o.value === color))
    : product.variants;
  const moreColors = !product.swatches && product.colorCount && product.colorCount > 1 ? product.colorCount - 1 : 0;
  const label = `${shopProductLabel(product)}${color ? `, ${color}` : ""}`;

  return (
    <div className="shop-product-card group flex flex-col" data-testid={`shop-card-${product.displayKey ?? product.slug}`}>
      <Link href={href} className="shop-product-card__image block" aria-label={label} tabIndex={-1}>
        {hero && (
          <Image
            src={hero}
            alt={product.imageDetails?.[0]?.altText || label}
            fill
            sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className={cover
              ? "shop-product-card__photo--cover object-cover transition-transform duration-500 group-hover:scale-[1.04]"
              : "object-contain p-4 transition-transform duration-500 group-hover:scale-[1.04] sm:p-6"}
          />
        )}
      </Link>
      {product.swatches && (
        <div
          className="shop-product-card__swatches"
          {...(product.swatches.length > 1
            ? { role: "group", "aria-label": `${shopProductLabel(product)} colors` }
            : { "aria-hidden": true })}
        >
          {product.swatches.map((s, i) => (
            <button
              key={s.color}
              type="button"
              className="shop-swatch"
              aria-label={s.color}
              aria-pressed={i === active}
              style={{ background: swatchBackground(s.color, product.slug) }}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
            />
          ))}
          {product.swatches.length > 1 && (
            <span className="shop-product-card__swatch-count">{product.swatches.length} colors</span>
          )}
        </div>
      )}
      <Link href={href} className="block">
        <p className="shop-product-card__brand">{product.brand}</p>
        <h3>{shopProductLabel(product)}</h3>
        {(color || product.swatches) && (
          <p className="shop-product-card__color">
            {!product.swatches && color && <i aria-hidden="true" style={{ background: swatchBackground(color, product.slug) }} />}
            {color || "\u00a0"}
          </p>
        )}
        <div className="shop-product-card__price">
          {isMember && product.price !== product.reservePrice && (
            <span className="text-[11px] font-mono text-charcoal/40 line-through">
              {money(product.price)}
            </span>
          )}
          <span
            className="text-sm font-semibold"
            style={{ color: accent ?? "var(--color-charcoal)" }}
          >
            {money(displayPrice)}
          </span>
          {moreColors > 0 && (
            <span className="shop-product-card__more">+{moreColors} more {moreColors === 1 ? "color" : "colors"}</span>
          )}
        </div>
        {colorVariants.some(v => v.currentlyNotInStock) && <p className="mt-1 text-xs text-charcoal/60">Preorder · About {product.preOrderEtaWeeks || 2} weeks</p>}
      </Link>
    </div>
  );
}
