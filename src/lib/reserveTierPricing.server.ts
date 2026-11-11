/**
 * Live first-quarter Reserve prices per reveal tier, read from Shopify:
 * the RES-MEM variant price (Admin API) and each tier's discount code
 * (Admin API, discount token). Cached for 15 minutes. Server only.
 *
 * Used for the Meta AddToCart value on the reveal CTA, so it follows the
 * real checkout price when the variant price or a discount code changes.
 * Returns null on any read problem; the CTA then falls back to the
 * static TIER_META.firstBoxValue.
 */
import { unstable_cache } from "next/cache";
import { shopifyGraphQL } from "@/app/api/_lib/shopifyAdmin";
import { discountGraphQL } from "@/lib/takeAShot/discountToken";
import { SHOPIFY_MEMBERSHIP_PLANS } from "@/lib/membershipConfig";
import {
  RESERVE_TIER_CODES,
  computeReserveTierValues,
  type ReserveTierValues,
  type TierDiscount,
} from "@/lib/reserveTierPricing";

const VARIANT_PRICE_QUERY = `query ReserveMemberPrice($id: ID!) {
  productVariant(id: $id) { price }
}`;

const DISCOUNT_QUERY = `query ReserveTierDiscount($code: String!) {
  codeDiscountNodeByCode(code: $code) {
    codeDiscount {
      __typename
      ... on DiscountCodeBasic {
        status
        customerGets {
          value {
            __typename
            ... on DiscountAmount { amount { amount } }
            ... on DiscountPercentage { percentage }
          }
        }
      }
    }
  }
}`;

/** Normalize the Admin discount response; inactive or unknown = null. */
export function parseTierDiscount(data: unknown): TierDiscount | null {
  const d = (data as {
    codeDiscountNodeByCode?: { codeDiscount?: Record<string, unknown> } | null;
  } | null)?.codeDiscountNodeByCode?.codeDiscount as
    | {
        __typename?: string;
        status?: string;
        customerGets?: {
          value?: {
            __typename?: string;
            amount?: { amount?: string | number };
            percentage?: number;
          };
        };
      }
    | undefined;
  if (!d || d.__typename !== "DiscountCodeBasic" || d.status !== "ACTIVE") return null;
  const v = d.customerGets?.value;
  if (v?.__typename === "DiscountAmount") {
    const amount = Number(v.amount?.amount);
    return Number.isFinite(amount) ? { kind: "amount", amount } : null;
  }
  if (v?.__typename === "DiscountPercentage" && typeof v.percentage === "number") {
    return { kind: "percent", percentage: v.percentage };
  }
  return null;
}

/** Throws on any problem so a failed read is not cached. */
async function readLiveTierValues(): Promise<ReserveTierValues> {
  const variant = await shopifyGraphQL<{ productVariant?: { price?: string } | null }>(
    VARIANT_PRICE_QUERY,
    { id: SHOPIFY_MEMBERSHIP_PLANS.member.merchandiseId }
  );
  const base = Number(variant?.productVariant?.price);
  const discounts: Record<string, TierDiscount | null> = {};
  await Promise.all(
    Object.values(RESERVE_TIER_CODES)
      .filter(Boolean)
      .map(async (code) => {
        discounts[code] = parseTierDiscount(await discountGraphQL(DISCOUNT_QUERY, { code }));
      })
  );
  const values = computeReserveTierValues(Number.isFinite(base) ? base : null, discounts);
  if (!values) throw new Error("live tier price incomplete");
  return values;
}

const cachedLiveTierValues = unstable_cache(readLiveTierValues, ["reserve-tier-values-v1"], {
  revalidate: 900,
});

export async function getLiveReserveTierValues(): Promise<ReserveTierValues | null> {
  try {
    return await cachedLiveTierValues();
  } catch (err) {
    console.warn("[reserveTierPricing] live tier price unavailable; using fallback", err);
    return null;
  }
}
