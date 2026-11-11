/**
 * The regular quarterly Reserve price, read live from Shopify (Storefront API)
 * so the "renewals bill at" line on reward screens never drifts from checkout.
 * Variant and selling plan come from SHOPIFY_MEMBERSHIP_PLANS.member (the
 * same ones createMembershipCheckout sells). Cached per tab. Client only.
 */
import { SHOPIFY_MEMBERSHIP_PLANS } from "@/lib/membershipConfig";

const CACHE_KEY = "mully_reserve_quarter_price_v1";
const QUERY = `query ReservePrice($id: ID!) {
  node(id: $id) { ... on ProductVariant {
    price { amount currencyCode }
    sellingPlanAllocations(first: 10) { nodes { sellingPlan { id } priceAdjustments { price { amount currencyCode } } } }
  } }
}`;

type Money = { amount?: string; currencyCode?: string };
type VariantNode = {
  price?: Money;
  sellingPlanAllocations?: { nodes?: { sellingPlan?: { id?: string }; priceAdjustments?: { price?: Money }[] }[] };
};

export function formatQuarterPrice(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Renewal price for the plan: the plan's recurring price when the plan sets
 * one (last adjustment, i.e. after any intro cycles), else the variant price.
 */
export function quarterPriceFrom(node: VariantNode | null | undefined, sellingPlanGid: string): string | null {
  if (!node) return null;
  const allocation = node.sellingPlanAllocations?.nodes?.find((a) => a.sellingPlan?.id === sellingPlanGid);
  const adjustments = allocation?.priceAdjustments ?? [];
  const money = adjustments.length ? adjustments[adjustments.length - 1]?.price : node.price;
  const amount = Number(money?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return formatQuarterPrice(amount, money?.currencyCode || "USD");
}

export function renewalLine(price: string | null): string {
  return price
    ? `Reserve renewals bill at the regular ${price} quarterly price.`
    : "Reserve renewals bill at the regular quarterly price.";
}

let pending: Promise<string | null> | null = null;

export function fetchReserveQuarterPrice(): Promise<string | null> {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) return Promise.resolve(cached);
  } catch { /* storage unavailable */ }
  if (pending) return pending;
  const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
  const token = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
  if (!domain || !token) return Promise.resolve(null);
  const plan = SHOPIFY_MEMBERSHIP_PLANS.member;
  pending = fetch(`https://${domain}/api/2024-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": token },
    body: JSON.stringify({ query: QUERY, variables: { id: plan.merchandiseId } }),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      const price = quarterPriceFrom(json?.data?.node, plan.sellingPlanGid);
      if (price) { try { sessionStorage.setItem(CACHE_KEY, price); } catch { /* storage unavailable */ } }
      return price;
    })
    .catch(() => null)
    .finally(() => { pending = null; });
  return pending;
}
