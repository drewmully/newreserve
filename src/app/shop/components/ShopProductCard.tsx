"use client";

import Image from "next/image";
import Link from "next/link";
import type { ShopifyProduct } from "@/lib/shopify";
import { useMembership } from "../../context/MembershipContext";

/**
 * V1-style product card: brand chip top-right, white background,
 * object-contain image with generous padding, category eyebrow,
 * name, retail price (member price when signed-in paid tier).
 *
 * No AI copy, no truncation of the title — full text wraps to two lines.
 */
export function ShopProductCard({ product }: { product: ShopifyProduct }) {
  // Same defensive pattern ShopClient uses for the public /shop.
  let tier: string | null = null;
  try {
    tier = useMembership().tier ?? null;
  } catch {
    tier = null;
  }
  const isMember = tier && tier !== "free";
  const displayPrice = isMember ? product.reservePrice : product.price;

  const hero = product.images[0];

  return (
    <Link
      href={`/shop/${product.slug}`}
      className="group flex flex-col"
      data-testid={`shop-card-${product.slug}`}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-white">
        {hero && (
          <Image
            src={hero}
            alt={product.imageDetails?.[0]?.altText || product.name}
            fill
            sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-contain p-4 transition-transform duration-500 group-hover:scale-[1.04] sm:p-6"
          />
        )}
        {product.brand && (
          <span className="absolute right-3 top-3 border border-charcoal/10 bg-white px-2 py-1 text-[9px] font-mono uppercase tracking-[0.2em] text-charcoal/60">
            {product.brand}
          </span>
        )}
      </div>
      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-charcoal/50">
            {product.collection || "Accessories"}
          </div>
          <h3 className="mt-1 font-serif text-base leading-snug text-forest sm:text-lg">
            {product.name}
          </h3>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          {isMember && product.price !== product.reservePrice && (
            <span className="text-[11px] font-mono text-charcoal/40 line-through">
              ${product.price.toFixed(0)}
            </span>
          )}
          <span className="text-sm font-semibold text-forest">
            ${displayPrice.toFixed(0)}
          </span>
        </div>
      </div>
    </Link>
  );
}
