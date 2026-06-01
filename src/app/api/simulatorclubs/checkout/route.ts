/**
 * POST /api/simulatorclubs/checkout
 *
 * Server endpoint that creates a Shopify Storefront cart for the Mully Starter
 * Kit subscription and returns the checkout URL.
 *
 * The Starter Kit product + selling plan must already exist in Shopify (Drew
 * sets these up in the admin once). We reference them by env-var GIDs:
 *
 *   SHOPIFY_STARTER_KIT_VARIANT_GID       e.g. gid://shopify/ProductVariant/...
 *   SHOPIFY_STARTER_KIT_SELLING_PLAN_GID  e.g. gid://shopify/SellingPlan/...
 *
 * Cart attributes carry the application id and lead context so the Shopify
 * orders-paid webhook can flip `converted = true` on the Supabase row.
 *
 * Body (JSON):
 *   email            - required, used as cart buyer identity + return key
 *   applicationId    - Supabase row id (numeric string), for webhook reconciliation
 *   clubName         - optional, attached to the cart attributes for ops visibility
 *
 * Returns: { checkoutUrl } - caller should redirect the browser to it.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SHOPIFY_API_VERSION = "2024-10";

interface CheckoutBody {
  email?: string;
  applicationId?: string | number;
  clubName?: string;
}

export async function POST(req: Request) {
  let body: CheckoutBody;
  try {
    body = (await req.json()) as CheckoutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const domain =
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
    process.env.SHOPIFY_STORE_DOMAIN;
  const token =
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN ||
    process.env.SHOPIFY_STOREFRONT_TOKEN;
  const variantGid = process.env.SHOPIFY_STARTER_KIT_VARIANT_GID;
  const sellingPlanGid = process.env.SHOPIFY_STARTER_KIT_SELLING_PLAN_GID;

  if (!domain || !token) {
    return NextResponse.json(
      { error: "Shopify storefront not configured." },
      { status: 503 }
    );
  }
  if (!variantGid || !sellingPlanGid) {
    return NextResponse.json(
      {
        error:
          "Starter Kit product not configured yet. Drew is creating the subscription product in Shopify. Try again shortly or email drew@mymully.com.",
      },
      { status: 503 }
    );
  }

  const attributes: Array<{ key: string; value: string }> = [
    { key: "starter_kit", value: "true" },
    { key: "source", value: "simulatorclubs_lp" },
  ];
  if (body.applicationId !== undefined && body.applicationId !== null) {
    attributes.push({ key: "application_id", value: String(body.applicationId) });
  }
  if (body.clubName) {
    attributes.push({ key: "club_name", value: body.clubName.slice(0, 200) });
  }

  const lines = [
    { merchandiseId: variantGid, quantity: 1, sellingPlanId: sellingPlanGid },
  ];

  const res = await fetch(
    `https://${domain}/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": token,
      },
      body: JSON.stringify({
        query: `mutation CreateStarterKitCart(
          $lines: [CartLineInput!]!
          $attributes: [AttributeInput!]
          $buyerIdentity: CartBuyerIdentityInput
        ) {
          cartCreate(input: {
            lines: $lines,
            attributes: $attributes,
            buyerIdentity: $buyerIdentity
          }) {
            cart { checkoutUrl }
            userErrors { field message code }
          }
        }`,
        variables: {
          lines,
          attributes,
          buyerIdentity: { email },
        },
      }),
    }
  );

  const json = await res.json();
  const checkoutUrl: string | undefined = json?.data?.cartCreate?.cart?.checkoutUrl;

  if (!checkoutUrl) {
    const userErrors = json?.data?.cartCreate?.userErrors ?? [];
    const gqlErrors = json?.errors ?? [];
    console.error("[simulatorclubs/checkout] cartCreate failed", {
      userErrors,
      gqlErrors,
    });
    const firstMessage =
      userErrors[0]?.message ??
      gqlErrors[0]?.message ??
      "Could not start checkout.";
    return NextResponse.json({ error: firstMessage }, { status: 502 });
  }

  // Append email pre-fill to the checkout URL so Shopify skips the email step.
  let finalUrl = checkoutUrl;
  try {
    const u = new URL(checkoutUrl);
    u.searchParams.set("checkout[email]", email);
    finalUrl = u.toString();
  } catch {
    const sep = checkoutUrl.includes("?") ? "&" : "?";
    finalUrl = `${checkoutUrl}${sep}checkout%5Bemail%5D=${encodeURIComponent(email)}`;
  }

  return NextResponse.json({ checkoutUrl: finalUrl });
}
