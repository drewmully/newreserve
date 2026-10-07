/**
 * Back-in-stock detection for the site's own "Notify me" waitlist.
 *
 * Requests live in Firestore `back_in_stock_requests` (one doc per email +
 * product + variant). An hourly cron checks each waiting request against the
 * live Storefront catalog and, once the requested variant can be bought
 * again, sends a "Mully Back in Stock" event to Klaviyo (unique_id per
 * request, so a retry never double-notifies) and marks the doc notified.
 *
 * Klaviyo's native back-in-stock feature needs a Klaviyo-hosted catalog and
 * its onsite form; this keeps our headless form and Firestore as the source.
 */

import type { ShopifyProduct, ShopifyProductVariant } from "@/lib/shopify";
import { klaviyoRequest, KlaviyoError } from "./client";
import { LIFECYCLE_METRICS, RESTOCK_MAX_AGE_DAYS, SITE_URL } from "./lifecycleConfig";

export interface RestockRequest {
  id: string;
  email: string;
  productSlug: string;
  productName?: string | null;
  variantId?: string | null;
  size?: string | null;
  createdAt?: Date | null;
}

export type RestockDecision =
  | { action: "notify"; variant: ShopifyProductVariant }
  | { action: "wait" }
  | { action: "expire"; reason: "too_old" | "product_gone" };

function matchVariant(product: ShopifyProduct, req: RestockRequest): ShopifyProductVariant[] {
  if (req.variantId) {
    const exact = product.variants.filter((v) => v.id === req.variantId);
    if (exact.length) return exact;
  }
  if (req.size) {
    const size = req.size.trim().toLowerCase();
    const bySize = product.variants.filter((v) =>
      v.selectedOptions.some((o) => /^size$/i.test(o.name) && o.value.trim().toLowerCase() === size),
    );
    if (bySize.length) return bySize;
  }
  return req.variantId || req.size ? [] : product.variants;
}

export function decideRestock(
  req: RestockRequest,
  product: ShopifyProduct | null,
  now = new Date(),
): RestockDecision {
  if (req.createdAt && now.getTime() - req.createdAt.getTime() > RESTOCK_MAX_AGE_DAYS * 86_400_000) {
    return { action: "expire", reason: "too_old" };
  }
  if (!product) return { action: "expire", reason: "product_gone" };
  const candidates = matchVariant(product, req);
  const available = candidates.find((v) => v.availableForSale);
  return available ? { action: "notify", variant: available } : { action: "wait" };
}

export function backInStockEventProperties(product: ShopifyProduct, variant: ShopifyProductVariant, req: RestockRequest) {
  const image = variant.image || product.images[0];
  return Object.fromEntries(
    Object.entries({
      ProductID: product.slug,
      ProductName: product.name,
      Brand: product.brand,
      VariantID: variant.id,
      VariantTitle: variant.title,
      Size: req.size ?? undefined,
      Price: variant.price,
      MemberPrice: variant.reservePrice,
      URL: `${SITE_URL}/shop/${product.slug}`,
      ImageURL: image,
      /** True when the item can be ordered but ships later (preorder). */
      Preorder: variant.currentlyNotInStock === true,
      RequestedAt: req.createdAt?.toISOString(),
    }).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );
}

export async function sendBackInStockEvent(
  req: RestockRequest,
  product: ShopifyProduct,
  variant: ShopifyProductVariant,
): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    await klaviyoRequest("/api/events", {
      body: {
        data: {
          type: "event",
          attributes: {
            metric: { data: { type: "metric", attributes: { name: LIFECYCLE_METRICS.backInStock } } },
            profile: { data: { type: "profile", attributes: { email: req.email } } },
            properties: backInStockEventProperties(product, variant, req),
            value: variant.price,
            value_currency: "USD",
            unique_id: `bis:${req.id}`,
          },
        },
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, code: err instanceof KlaviyoError ? err.message : "unexpected" };
  }
}
