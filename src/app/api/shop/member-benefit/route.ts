import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { verifyFirebaseBearer } from "@/app/api/_lib/loopUserContext";
import { shopifyGraphQL } from "@/app/api/_lib/shopifyAdmin";

export const dynamic = "force-dynamic";
// Reserve members (15%) and Mully Access members (10%) are separate Shopify
// segments; the matching automatic discounts use the same segments, so the
// rate shown on site always equals the rate charged at checkout.
const RESERVE_SEGMENT = "gid://shopify/Segment/553168044224";
const ACCESS_SEGMENT = "gid://shopify/Segment/553168011456";
const SHOP_BENEFIT_RATES: Record<string, number> = { [RESERVE_SEGMENT]: 0.15, [ACCESS_SEGMENT]: 0.1 };
const reply = (rate: number, status = 200) =>
  NextResponse.json({ eligible: rate > 0, rate }, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: NextRequest) {
  let uid: string;
  try { uid = await verifyFirebaseBearer(request); }
  catch { return reply(0, 401); }
  try {
    // Never accept a client-supplied customer ID, editable profile email or tier.
    const user = await adminAuth.getUser(uid);
    const email = user.email?.trim().toLowerCase();
    if (!email || !user.emailVerified || user.disabled) return reply(0);
    const customers = await shopifyGraphQL<{ customers: { nodes: { id: string; email: string | null }[] } }>(
      `query ShopBenefitCustomer($query: String!) { customers(first: 10, query: $query) { nodes { id email } } }`,
      { query: `email:${JSON.stringify(email)}` },
    );
    const customer = customers.customers.nodes.find(c => c.email?.toLowerCase() === email);
    if (!customer) return reply(0);
    const data = await shopifyGraphQL<{ customerSegmentMembership: { memberships: { segmentId: string; isMember: boolean }[] } }>(
      `query ShopBenefit($customer: ID!, $segments: [ID!]!) {
        customerSegmentMembership(customerId: $customer, segmentIds: $segments) {
          memberships { segmentId isMember }
        }
      }`, { customer: customer.id, segments: Object.keys(SHOP_BENEFIT_RATES) },
    );
    const rate = Math.max(0, ...data.customerSegmentMembership.memberships
      .filter(m => m.isMember)
      .map(m => SHOP_BENEFIT_RATES[m.segmentId] ?? 0));
    return reply(rate);
  } catch {
    // Source unavailable is never permission to display a member discount.
    return reply(0, 503);
  }
}
