"use client";

/**
 * PostHog events for the gift guide, through the shared trackEvent helper
 * (/api/analytics/track). One listener on the page, driven by data attributes
 * set in the server-rendered markup:
 *
 *   gift_guide_view           on mount            { page, tier }
 *   gift_guide_tier_click     [data-gg-tier-link] { page, tier, from_tier, placement }
 *   gift_guide_product_click  [data-gg-product]   { page, tier, product_id, handle, price, brand, position, placement }
 *   gift_a_season_click       [data-gg-season]    { page, tier, placement }
 *   gift_card_click           [data-gg-giftcard]  { page, tier, placement }
 *
 * `page` is "hub" or the tier slug the shopper is on. `tier` is the tier the
 * clicked element belongs to (a slug, "hub", or "outfit-<key>" for the
 * outfit sets). `price` is the live Shopify retail price at render time.
 * email_submitted is fired by GiftReminderSignup, not here.
 */

import { useEffect } from "react";
import { trackEvent } from "@/lib/tracking";

export function GiftGuideTracker({ page }: { page: string }) {
  useEffect(() => {
    void trackEvent("gift_guide_view", { properties: { page, tier: page } });

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("a")) return;

      const season = target.closest<HTMLElement>("[data-gg-season]");
      if (season) {
        void trackEvent("gift_a_season_click", { properties: { page, tier: season.dataset.ggTier ?? page, placement: season.dataset.ggSeason } });
        return;
      }
      const giftCard = target.closest<HTMLElement>("[data-gg-giftcard]");
      if (giftCard) {
        void trackEvent("gift_card_click", { properties: { page, tier: giftCard.dataset.ggTier ?? page, placement: giftCard.dataset.ggGiftcard } });
        return;
      }
      const tier = target.closest<HTMLElement>("[data-gg-tier-link]");
      if (tier) {
        void trackEvent("gift_guide_tier_click", {
          properties: { page, tier: tier.dataset.ggTierLink, from_tier: page, placement: tier.dataset.ggPlacement },
        });
        return;
      }
      const product = target.closest<HTMLElement>("[data-gg-product]");
      if (product) {
        void trackEvent("gift_guide_product_click", {
          properties: {
            page,
            tier: product.dataset.ggTier,
            product_id: product.dataset.ggProductId,
            handle: product.dataset.ggProduct,
            price: product.dataset.ggPrice ? Number(product.dataset.ggPrice) : undefined,
            brand: product.dataset.ggBrand,
            position: Number(product.dataset.ggPosition) || undefined,
            placement: product.dataset.ggPlacement,
          },
        });
      }
    };

    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [page]);

  return null;
}
