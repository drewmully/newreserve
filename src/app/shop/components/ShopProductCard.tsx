"use client";

import Image from "next/image";
import Link from "next/link";
import type { ShopifyProduct } from "@/lib/shopify";
import { useMembership } from "../../context/MembershipContext";
import { shopProductPhoto, shopProductLabel } from "@/lib/shopProductPhotos";
import { money } from "@/lib/shopOutfit";

/**
 * V1-style product card: brand chip top-right, white background,
 * object-contain image with generous padding, category eyebrow,
 * name, retail price (member price when signed-in paid tier).
 *
 * No AI copy, no truncation of the title — full text wraps to two lines.
 */
export function ShopProductCard({
  product,
  accent,
}: {
  product: ShopifyProduct;
  /** Optional accent hex used for the member-price highlight, per seasonal theme. */
  accent?: string;
}) {
  const { tier } = useMembership();
  const isMember = tier && tier !== "free";
  const displayPrice = isMember ? product.reservePrice : product.price;

  const hero = shopProductPhoto(product);

  return (
    <Link
      href={`/shop/${product.slug}`}
      className="shop-product-card group flex flex-col"
      data-testid={`shop-card-${product.slug}`}
    >
      <div className="shop-product-card__image">
        {hero && (
          <Image
            src={hero}
            alt={product.imageDetails?.[0]?.altText || product.name}
            fill
            sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-contain p-4 transition-transform duration-500 group-hover:scale-[1.04] sm:p-6"
          />
        )}
      </div>
      <div>
        <p className="shop-product-card__brand">{product.brand}</p>
        <h3>{shopProductLabel(product)}</h3>
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
        </div>
        {product.variants.some(v => v.currentlyNotInStock) && <p className="mt-1 text-xs text-charcoal/60">Preorder · About {product.preOrderEtaWeeks || 2} weeks</p>}
      </div>
    </Link>
  );
}
