import { NextRequest, NextResponse } from "next/server";
import { verifyHs256 } from "./jwt";
import { shopifyGraphQL } from "@/app/api/_lib/shopifyAdmin";
import { getFirstSellingPlanId } from "@/lib/shopify";
import { MULLY_ACCESS_MONTHLY } from "@/lib/membershipConfig";

const RESERVE_SEGMENT = "gid://shopify/Segment/553168044224";
const ACCESS_SEGMENT = "gid://shopify/Segment/553168011456";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { ...CORS, "Cache-Control": "no-store" } });

export function appCredentials() {
  // Public client ID of the "Mully Internal Extensions" app; only the secret is private.
  const apiKey = process.env.SHOPIFY_INTERNAL_EXT_API_KEY || "47d5739bdadce8acae4a9ee0962339d4";
  const secret = process.env.SHOPIFY_INTERNAL_EXT_API_SECRET;
  if (!apiKey || !secret) throw new Error("post-purchase app credentials missing");
  return { apiKey, secret };
}

interface PostPurchaseClaims {
  input_data?: { initialPurchase?: { referenceId?: string; customerId?: number | string } };
}

/** Verify the extension's bearer token and return the purchase it belongs to. */
export function verifyExtensionRequest(req: NextRequest, referenceId: unknown) {
  const { secret } = appCredentials();
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const claims = verifyHs256<PostPurchaseClaims>(token, secret);
  const purchase = claims.input_data?.initialPurchase;
  if (!purchase?.referenceId || purchase.referenceId !== referenceId) throw new Error("reference mismatch");
  return purchase;
}

const numericId = (gid: string) => Number(gid.split("/").pop());

export async function isExistingMember(customerId: number | string | undefined): Promise<boolean> {
  if (!customerId) return false;
  const data = await shopifyGraphQL<{ customerSegmentMembership: { memberships: { isMember: boolean }[] } }>(
    `query PostPurchaseMember($customer: ID!, $segments: [ID!]!) {
      customerSegmentMembership(customerId: $customer, segmentIds: $segments) { memberships { isMember } }
    }`,
    { customer: `gid://shopify/Customer/${customerId}`, segments: [RESERVE_SEGMENT, ACCESS_SEGMENT] },
  );
  return data.customerSegmentMembership.memberships.some(m => m.isMember);
}

/** Server-owned changeset: Mully Access monthly, first month free. The
 * client never supplies the changes, so the offer can't be tampered with. */
export async function mullyAccessChanges() {
  const plan = await getFirstSellingPlanId(MULLY_ACCESS_MONTHLY.productHandle);
  if (!plan) return null;
  return [{
    type: "add_subscription",
    variantID: MULLY_ACCESS_MONTHLY.variantId,
    sellingPlanId: numericId(plan),
    quantity: 1,
    initialShippingPrice: 0,
    recurringShippingPrice: 0,
    shippingOption: { title: "Mully Access (no shipment)", presentmentTitle: "Membership, nothing ships" },
    discount: { value: 100, valueType: "percentage", title: "First month free" },
  }];
}
