import { SHOPIFY_MEMBERSHIP_PLANS } from "./membershipConfig";
import { buildCheckoutOriginAttributes } from "./shopifyCheckoutOrigin";
import {
  getStoredAttribution,
  attributionToCartAttributes,
} from "./attribution";

export interface CreateMembershipCheckoutOptions {
  /**
   * Pre-fills the Shopify checkout `email` field. Use this when the visitor
   * already gave us their email (EmailCTA / start-account flow / founders
   * invite token). Shopify accepts ?checkout[email]= on the storefront
   * checkout URL.
   */
  email?: string;
  /**
   * Override the post-checkout return URL. Defaults to /auth/callback so
   * Leo's auto-login pattern continues to work.
   */
  returnPath?: string;
  /** Optional Shopify discount code(s) applied at cart creation. */
  discountCodes?: string[];
  /** Optional extra cart attributes (campaign id, invite token, tier, etc.). */
  attributes?: Array<{ key: string; value: string }>;
}

export async function createMembershipCheckout(
  tier: "access" | "member",
  options: CreateMembershipCheckoutOptions = {}
): Promise<void> {
  const PLANS = {
    access: {
      merchandiseId: SHOPIFY_MEMBERSHIP_PLANS.access.merchandiseId,
      sellingPlanId: SHOPIFY_MEMBERSHIP_PLANS.access.sellingPlanGid,
    },
    member: {
      merchandiseId: SHOPIFY_MEMBERSHIP_PLANS.member.merchandiseId,
      sellingPlanId: SHOPIFY_MEMBERSHIP_PLANS.member.sellingPlanGid,
    },
  };
  const { merchandiseId, sellingPlanId } = PLANS[tier];
  const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
  const token = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
  if (!domain || !token) return;

  const returnPath = options.returnPath ?? "/auth/callback";
  const returnTo = `${window.location.origin}${returnPath}`;
  // Pull stored attribution (gclid/gbraid/wbraid/utm_*) from cookie/localStorage
  // so it lands in order.note_attributes for the orders-paid webhook to use
  // when firing the Google Ads / Meta CAPI server-side conversion.
  const attribution = getStoredAttribution();
  // Generate a stable transaction_id BEFORE checkout so client (/auth/callback)
  // and server (orders-paid webhook) can both fire the Google Ads conversion
  // with the same transaction_id — Google dedupes automatically.
  const txnId = (() => {
    try {
      const fresh =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `mully-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem("mully_pending_txn_id", fresh);
      return fresh;
    } catch {
      return `mully-${Date.now()}`;
    }
  })();
  const attributes = [
    ...buildCheckoutOriginAttributes(returnTo),
    ...attributionToCartAttributes(attribution),
    { key: "mully_txn_id", value: txnId },
    { key: "new_user", value: "true" },
    ...(options.attributes ?? []),
  ];

  const discountCodes = (options.discountCodes ?? [])
    .map((code) => code.trim())
    .filter(Boolean);

  const res = await fetch(`https://${domain}/api/2024-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token,
    },
    body: JSON.stringify({
      query: `mutation CreateSubscriptionCart(
        $merchandiseId: ID!
        $sellingPlanId: ID!
        $attributes: [AttributeInput!]
        $discountCodes: [String!]
        $buyerIdentity: CartBuyerIdentityInput
      ) {
        cartCreate(input: {
          lines: [{ merchandiseId: $merchandiseId, quantity: 1, sellingPlanId: $sellingPlanId }],
          attributes: $attributes,
          discountCodes: $discountCodes,
          buyerIdentity: $buyerIdentity
        }) {
          cart { checkoutUrl }
          userErrors { field message }
        }
      }`,
      variables: {
        merchandiseId,
        sellingPlanId,
        attributes,
        discountCodes: discountCodes.length ? discountCodes : null,
        buyerIdentity: options.email ? { email: options.email } : null,
      },
    }),
  });

  const json = await res.json();
  const checkoutUrl = json?.data?.cartCreate?.cart?.checkoutUrl;
  if (!checkoutUrl) {
    console.error(
      "[shopifyCheckout] no checkoutUrl — errors:",
      json?.data?.cartCreate?.userErrors,
      json?.errors
    );
    return;
  }

  // Append `?return_url=` (and email pre-fill) the same way UpgradeModal does.
  // Shopify honors `return_url` query param and bounces the buyer back to
  // /auth/callback as an authenticated session via Leo's pattern.
  try {
    const checkout = new URL(checkoutUrl);
    checkout.searchParams.set("return_url", returnTo);
    if (options.email) {
      checkout.searchParams.set("checkout[email]", options.email);
    }
    window.location.href = checkout.toString();
  } catch {
    const separator = checkoutUrl.includes("?") ? "&" : "?";
    const emailParam = options.email
      ? `&checkout%5Bemail%5D=${encodeURIComponent(options.email)}`
      : "";
    window.location.href = `${checkoutUrl}${separator}return_url=${encodeURIComponent(returnTo)}${emailParam}`;
  }
}
