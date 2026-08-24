/**
 * Swing Box (Founding 100) pre-sale checkout.
 *
 * The Swing Box variant is subscription-only (`requiresSellingPlan: true`),
 * so plain cart permalinks fail with "Variant can only be purchased with
 * a selling plan." Shopify docs are explicit: cart permalinks do NOT
 * support selling plans. Instead we use the Storefront API `cartCreate`
 * mutation to build a cart with the sellingPlanId attached, then redirect
 * to the returned `checkoutUrl`.
 */

// Product: Swing Box (Founding 100)
// Variant + Selling Plan (monthly membership, required)
const SWINGBOX_VARIANT_GID = "gid://shopify/ProductVariant/48885734637760";
const SWINGBOX_SELLING_PLAN_GID = "gid://shopify/SellingPlan/3654713536";

export async function startSwingBoxCheckout(): Promise<void> {
  const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
  const token = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN;

  if (!domain || !token) {
    // Fallback: send the shopper to the product page so they can still buy.
    window.location.href =
      "https://checkout.mymully.com/products/swing-box-founding-100";
    return;
  }

  try {
    const res = await fetch(`https://${domain}/api/2024-10/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": token,
      },
      body: JSON.stringify({
        query: `
          mutation CreateSwingBoxCart(
            $lines: [CartLineInput!]!
            $attributes: [AttributeInput!]
          ) {
            cartCreate(input: {
              lines: $lines
              attributes: $attributes
            }) {
              cart { checkoutUrl }
              userErrors { field message code }
            }
          }
        `,
        variables: {
          lines: [
            {
              merchandiseId: SWINGBOX_VARIANT_GID,
              quantity: 1,
              sellingPlanId: SWINGBOX_SELLING_PLAN_GID,
            },
          ],
          attributes: [
            { key: "landing_page", value: "swingbox" },
            { key: "presale_cohort", value: "founding_100" },
          ],
        },
      }),
    });

    const json = await res.json();
    const checkoutUrl: string | undefined =
      json?.data?.cartCreate?.cart?.checkoutUrl;

    if (checkoutUrl) {
      window.location.href = checkoutUrl;
      return;
    }

    // Surface the exact error so we can debug from console.
    console.error(
      "[swingBoxCheckout] cartCreate failed",
      JSON.stringify(
        {
          userErrors: json?.data?.cartCreate?.userErrors ?? [],
          gqlErrors: json?.errors ?? [],
        },
        null,
        2
      )
    );
  } catch (err) {
    console.error("[swingBoxCheckout] request failed", err);
  }

  // Any failure: send the shopper to the product page as a graceful fallback.
  window.location.href =
    "https://checkout.mymully.com/products/swing-box-founding-100";
}
