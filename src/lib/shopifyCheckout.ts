import { SHOPIFY_MEMBERSHIP_PLANS } from "./membershipConfig";
import { buildCheckoutOriginAttributes } from "./shopifyCheckoutOrigin";

export interface CreateMembershipCheckoutOptions {
  /**
   * Pre-fills the Shopify checkout `email` field. Use this when the visitor
   * already gave us their email (EmailCTA / start-account flow). Shopify
   * accepts ?checkout[email]= on the storefront checkout URL.
   */
  email?: string;
  /**
   * Override the post-checkout return URL. Defaults to /auth/callback so
   * Leo's auto-login pattern continues to work.
   */
  returnPath?: string;
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
  const attributes = [
    ...buildCheckoutOriginAttributes(returnTo),
    { key: "new_user", value: "true" },
  ];

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
      ) {
        cartCreate(input: {
          lines: [{ merchandiseId: $merchandiseId, quantity: 1, sellingPlanId: $sellingPlanId }],
          attributes: $attributes
        }) {
          cart { checkoutUrl }
          userErrors { field message }
        }
      }`,
      variables: { merchandiseId, sellingPlanId, attributes },
    }),
  });

  const json = await res.json();
  const checkoutUrl = json?.data?.cartCreate?.cart?.checkoutUrl;
  if (!checkoutUrl) {
    console.error(
      "[shopifyCheckout] no checkoutUrl \u2014 errors:",
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
