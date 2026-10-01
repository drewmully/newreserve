"use client";

import { useEffect, useRef } from "react";
import type { ShopifyProduct } from "@/lib/shopify";
import { useMembership } from "../../context/MembershipContext";
import { trackEvent } from "@/lib/tracking";
import { ShopSlideCart } from "./ShopSlideCart";
import { MysteryBundlePage } from "./MysteryBundlePage";

export function MysteryBundleClient({ product, initialVariantId }: {
  product: ShopifyProduct; initialVariantId?: string;
}) {
  const { addItemsToCart, cartCount, cartOpen, setCartOpen } = useMembership();
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    trackEvent("proshop_product_viewed", { properties: {
      product_slug: product.slug, name: product.name, price: product.price,
      variant_id: product.variantId, source: "mystery_bundle_pdp",
    } });
  }, [product]);
  return <>
    <MysteryBundlePage product={product} initialVariantId={initialVariantId}
      cartCount={cartCount} cartOpen={cartOpen} onOpenBag={() => setCartOpen(true)}
      onAdd={variant => addItemsToCart([{
        slug: product.slug, name: product.name, brand: "Mully",
        price: variant.price, retailPrice: variant.price, variantId: variant.id,
        image: variant.image || product.images[0], variantTitle: variant.title,
      }])} />
    <ShopSlideCart accent="#4A3528" />
  </>;
}
