"use client";

/**
 * PostHog events for the gift guide, through the shared trackEvent helper
 * (/api/analytics/track). One listener on the page, driven by data attributes
 * set in the server-rendered markup:
 *
 *   gift_guide_view           on mount            { page }
 *   gift_guide_tier_click     [data-gg-tier-link] { tier, page, placement }
 *   gift_guide_product_click  [data-gg-product]   { product, brand, tier, position, page, placement }
 *   gift_a_season_click       [data-gg-season]    { page, placement }
 */

import { useEffect } from "react";
import { trackEvent } from "@/lib/tracking";

export function GiftGuideTracker({ page }: { page: string }) {
  useEffect(() => {
    void trackEvent("gift_guide_view", { properties: { page } });

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("a")) return;

      const season = target.closest<HTMLElement>("[data-gg-season]");
      if (season) {
        void trackEvent("gift_a_season_click", { properties: { page, placement: season.dataset.ggSeason } });
        return;
      }
      const tier = target.closest<HTMLElement>("[data-gg-tier-link]");
      if (tier) {
        void trackEvent("gift_guide_tier_click", {
          properties: { page, tier: tier.dataset.ggTierLink, placement: tier.dataset.ggPlacement },
        });
        return;
      }
      const product = target.closest<HTMLElement>("[data-gg-product]");
      if (product) {
        void trackEvent("gift_guide_product_click", {
          properties: {
            page,
            product: product.dataset.ggProduct,
            brand: product.dataset.ggBrand,
            tier: product.dataset.ggTier,
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
