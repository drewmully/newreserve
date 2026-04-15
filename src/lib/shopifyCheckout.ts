import { SHOPIFY_MEMBERSHIP_PLANS } from "./membershipConfig";
import { buildCheckoutOriginAttributes } from "./shopifyCheckoutOrigin";

export async function createMembershipCheckout(tier: "access" | "member"): Promise<void> {
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

  const returnTo = `${window.location.origin}/auth/callback`;
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
  if (checkoutUrl) {
    window.location.href = checkoutUrl;
  }
}
