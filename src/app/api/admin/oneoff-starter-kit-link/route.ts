/**
 * ONE-OFF admin endpoint — used to:
 *   1. Attach the Starter Kit variant to the existing selling plan group
 *   2. Return the actual SellingPlan child id inside the group (for cart lines)
 *
 * Token-gated via ?token=$FOUNDING_100_SEED_TOKEN (reusing an existing secret).
 * DELETE THIS ROUTE after the link is done.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const GROUP_ID = "gid://shopify/SellingPlanGroup/1748861120";
const VARIANT_ID = "gid://shopify/ProductVariant/48350696308928";

async function admin<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN!;
  const token = process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_CLIENT_SECRET!;
  const version = process.env.SHOPIFY_ADMIN_API_VERSION ?? "2024-10";
  const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  return (await res.json()) as T;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token || token !== process.env.FOUNDING_100_SEED_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Verify the variant belongs to the expected product and see all variants
  const variantInfo = await admin<{
    data?: {
      product: {
        id: string;
        title: string;
        variants: { edges: { node: { id: string; title: string; price: string; sku: string | null } }[] };
        sellingPlanGroups: { edges: { node: { id: string; name: string } }[] };
      } | null;
    };
  }>(
    `query {
      product(id: "gid://shopify/Product/8592710435008") {
        id
        title
        variants(first: 10) { edges { node { id title price sku } } }
        sellingPlanGroups(first: 5) { edges { node { id name } } }
      }
    }`
  );

  // 1. Inspect the group: get its child SellingPlan ids and current products
  const inspect = await admin<{
    data?: {
      sellingPlanGroup: {
        id: string;
        name: string;
        sellingPlans: { edges: { node: { id: string; name: string } }[] };
        productVariants: { edges: { node: { id: string; title: string; product: { title: string; id: string } } }[] };
        products: { edges: { node: { id: string; title: string } }[] };
      } | null;
    };
    errors?: unknown;
  }>(
    `query($id: ID!) {
      sellingPlanGroup(id: $id) {
        id
        name
        sellingPlans(first: 5) { edges { node { id name } } }
        productVariants(first: 10) { edges { node { id title product { id title } } } }
        products(first: 10) { edges { node { id title } } }
      }
    }`,
    { id: GROUP_ID }
  );

  // 2. Attach the variant to the group (idempotent — Shopify ignores duplicates)
  const link = await admin<{
    data?: {
      sellingPlanGroupAddProductVariants: {
        sellingPlanGroup: { id: string; name: string } | null;
        userErrors: { field: string[] | null; message: string }[];
      };
    };
    errors?: unknown;
  }>(
    `mutation($id: ID!, $variantIds: [ID!]!) {
      sellingPlanGroupAddProductVariants(id: $id, productVariantIds: $variantIds) {
        sellingPlanGroup { id name }
        userErrors { field message }
      }
    }`,
    { id: GROUP_ID, variantIds: [VARIANT_ID] }
  );

  // 3. Re-inspect to confirm
  const verify = await admin<{
    data?: {
      sellingPlanGroup: {
        productVariants: { edges: { node: { id: string; title: string } }[] };
        sellingPlans: { edges: { node: { id: string; name: string } }[] };
      };
    };
  }>(
    `query($id: ID!) {
      sellingPlanGroup(id: $id) {
        productVariants(first: 10) { edges { node { id title } } }
        sellingPlans(first: 5) { edges { node { id name } } }
      }
    }`,
    { id: GROUP_ID }
  );

  return NextResponse.json({
    product: variantInfo.data?.product ?? null,
    inspect: inspect.data?.sellingPlanGroup ?? null,
    inspect_errors: inspect.errors ?? null,
    link_result: link.data?.sellingPlanGroupAddProductVariants ?? null,
    link_errors: link.errors ?? null,
    verify_after: verify.data?.sellingPlanGroup ?? null,
  });
}
