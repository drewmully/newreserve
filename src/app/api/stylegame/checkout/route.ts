/**
 * Style Game checkout entry point.
 *
 * The authored quiz redirects finale visitors here with query params it built
 * from the user's answers (`stylegame_profile`, `stylegame_stage`, `gift`,
 * UTMs, etc.). We build a Shopify Storefront `cartCreate` server-side —
 * cart permalinks do not support selling plans — attach the Style Game
 * selling plan, pass the quiz result as cart attributes for the checkout
 * extension + orders/paid webhook to pick up, and 302 the customer to the
 * returned `checkoutUrl`.
 *
 * Environment:
 *   NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN     — e.g. mullybox-store.myshopify.com
 *   NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN — public storefront token (matches swingBoxCheckout)
 *   SHOPIFY_STYLEGAME_VARIANT_ID         — variant GID, defaults to RES-MEM 47601025122496
 *   SHOPIFY_STYLEGAME_SELLING_PLAN_ID    — selling plan GID for cycle-1-$5 plan
 *
 * If SHOPIFY_STYLEGAME_SELLING_PLAN_ID is missing the route returns a 503
 * with a clear message (per PR #109's "fail loudly" preference) so we notice
 * the moment the Style Game funnel is misconfigured, instead of silently
 * routing shoppers to the wrong plan.
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_VARIANT_GID = "gid://shopify/ProductVariant/47601025122496"; // RES-MEM Reserve Quarterly

function toVariantGid(raw: string | undefined | null): string {
  if (!raw) return DEFAULT_VARIANT_GID;
  if (raw.startsWith("gid://")) return raw;
  return `gid://shopify/ProductVariant/${raw}`;
}

function toSellingPlanGid(raw: string | undefined | null): string | null {
  if (!raw) return null;
  if (raw.startsWith("gid://")) return raw;
  return `gid://shopify/SellingPlan/${raw}`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const search = url.searchParams;

  const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
  const token = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
  const sellingPlanGid = toSellingPlanGid(
    process.env.SHOPIFY_STYLEGAME_SELLING_PLAN_ID
  );
  const variantGid = toVariantGid(process.env.SHOPIFY_STYLEGAME_VARIANT_ID);

  if (!domain || !token) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Shopify Storefront credentials missing (NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN or NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN).",
      },
      { status: 500 }
    );
  }
  if (!sellingPlanGid) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "SHOPIFY_STYLEGAME_SELLING_PLAN_ID is not set. Create the Style Game selling plan in Loop (cycle 1 = $5, cycle 2+ = $250) and set this env var to its Shopify SellingPlan ID.",
      },
      { status: 503 }
    );
  }

  // The authored game hands us profile + axis percentages + fit/color values.
  // We repackage them into cart attributes so the order carries the full quiz
  // result. Attribute keys are prefixed `stylegame_` for downstream indexing.
  const profile = search.get("profile") || "";
  const name = search.get("name") || "";
  const confidence = search.get("confidence") || "";
  const prep = search.get("prep") || "";
  const modern = search.get("modern") || "";
  const classic = search.get("classic") || "";
  const athletic = search.get("athletic") || "";
  const color = search.get("color") || "";
  const fit = search.get("fit") || "";
  const gift = search.get("gift") || "";

  // A compact JSON blob so the whole quiz result is one attribute for
  // downstream consumers that don't want to reassemble 8 separate fields.
  const pcts = { prep, modern, classic, athletic };
  const quizJson = JSON.stringify({
    profile,
    name,
    confidence: Number(confidence) || null,
    pcts,
    color: Number(color) || null,
    fit: Number(fit) || null,
    gift: gift === "1" || gift === "true",
  });

  const attributes: { key: string; value: string }[] = [
    { key: "funnel", value: "stylegame" },
    { key: "stylegame_stage", value: "vaulted" },
  ];
  if (profile) attributes.push({ key: "stylegame_profile", value: profile });
  if (name) attributes.push({ key: "stylegame_profile_name", value: name });
  attributes.push({ key: "stylegame_result", value: quizJson });
  if (gift) attributes.push({ key: "gift", value: gift });

  // UTMs + anon id — pass-through if present.
  for (const key of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "mully_anon_id",
  ]) {
    const value = search.get(key);
    if (value) attributes.push({ key, value });
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
          mutation CreateStyleGameCart(
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
              merchandiseId: variantGid,
              quantity: 1,
              sellingPlanId: sellingPlanGid,
              attributes: attributes.filter((attr) =>
                [
                  "stylegame_profile",
                  "stylegame_profile_name",
                  "stylegame_stage",
                  "gift",
                ].includes(attr.key)
              ),
            },
          ],
          attributes,
        },
      }),
    });

    const json = await res.json();
    const checkoutUrl: string | undefined =
      json?.data?.cartCreate?.cart?.checkoutUrl;
    const userErrors = json?.data?.cartCreate?.userErrors ?? [];
    const gqlErrors = json?.errors ?? [];

    if (checkoutUrl) {
      return NextResponse.redirect(checkoutUrl, 303);
    }

    console.error("[stylegame/checkout] cartCreate failed", {
      userErrors,
      gqlErrors,
    });
    return NextResponse.json(
      { ok: false, userErrors, gqlErrors },
      { status: 502 }
    );
  } catch (err) {
    console.error("[stylegame/checkout] request failed", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message ?? "unknown error" },
      { status: 502 }
    );
  }
}
