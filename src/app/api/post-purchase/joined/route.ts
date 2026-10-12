import { NextRequest } from "next/server";
import { CORS, json, verifyExtensionRequest } from "@/lib/postPurchase/mullyAccessOffer";
import { shopifyGraphQL } from "@/app/api/_lib/shopifyAdmin";
import { MULLY_ACCESS_MONTHLY } from "@/lib/membershipConfig";

export const dynamic = "force-dynamic";
export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });

/** Called after applyChangeset succeeds. The post-purchase join never fires
 * orders/paid for the Access line, so tag here; the customer ID comes from
 * Shopify's signed token. The Access segment also requires an active
 * subscription, so the tag alone grants nothing. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  let purchase;
  try { purchase = verifyExtensionRequest(req, body.referenceId); }
  catch { return json({ ok: false }, 401); }
  if (!purchase.customerId) return json({ ok: false }, 400);
  try {
    const res = await shopifyGraphQL<{ tagsAdd: { userErrors: { message: string }[] } }>(
      `mutation TagAccess($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`,
      { id: `gid://shopify/Customer/${purchase.customerId}`, tags: [MULLY_ACCESS_MONTHLY.customerTag] },
    );
    if (res.tagsAdd.userErrors.length) throw new Error(res.tagsAdd.userErrors[0].message);
    return json({ ok: true });
  } catch (err) {
    console.error("[post-purchase/joined]", err);
    return json({ ok: false }, 503);
  }
}
