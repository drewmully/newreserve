import type { CartAttributeInput } from "@/lib/shopify";

export const SHOPIFY_CHECKOUT_ORIGIN_APP = "newreserve";
export const SHOPIFY_CHECKOUT_ORIGIN_APP_KEY = "origin_app";
export const SHOPIFY_CHECKOUT_RETURN_URL_KEY = "origin_return_url";

export function buildCheckoutOriginAttributes(
  returnUrl: string
): CartAttributeInput[] {
  const normalizedReturnUrl = returnUrl.trim();
  const attributes: CartAttributeInput[] = [
    {
      key: SHOPIFY_CHECKOUT_ORIGIN_APP_KEY,
      value: SHOPIFY_CHECKOUT_ORIGIN_APP,
    },
  ];

  if (normalizedReturnUrl) {
    attributes.push({
      key: SHOPIFY_CHECKOUT_RETURN_URL_KEY,
      value: normalizedReturnUrl,
    });
  }

  return attributes;
}
