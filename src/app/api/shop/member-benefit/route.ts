import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { verifyFirebaseBearer } from "@/app/api/_lib/loopUserContext";
import { shopifyGraphQL } from "@/app/api/_lib/shopifyAdmin";

export const dynamic = "force-dynamic";
const SEGMENT = "gid://shopify/Segment/552166457536";
const reply = (eligible: boolean, status = 200) =>
  NextResponse.json({ eligible }, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: NextRequest) {
  let uid: string;
  try { uid = await verifyFirebaseBearer(request); }
  catch { return reply(false, 401); }
  try {
    // Never accept a client-supplied customer ID, editable profile email or tier.
    const user = await adminAuth.getUser(uid);
    const email = user.email?.trim().toLowerCase();
    if (!email || !user.emailVerified || user.disabled) return reply(false);
    const customers = await shopifyGraphQL<{ customers: { nodes: { id: string; email: string | null }[] } }>(
      `query ShopBenefitCustomer($query: String!) { customers(first: 10, query: $query) { nodes { id email } } }`,
      { query: `email:${JSON.stringify(email)}` },
    );
    const customer = customers.customers.nodes.find(c => c.email?.toLowerCase() === email);
    if (!customer) return reply(false);
    const data = await shopifyGraphQL<{ customerSegmentMembership: { memberships: { segmentId: string; isMember: boolean }[] } }>(
      `query ShopBenefit($customer: ID!, $segments: [ID!]!) {
        customerSegmentMembership(customerId: $customer, segmentIds: $segments) {
          memberships { segmentId isMember }
        }
      }`, { customer: customer.id, segments: [SEGMENT] },
    );
    return reply(data.customerSegmentMembership.memberships.some(m => m.segmentId === SEGMENT && m.isMember));
  } catch {
    // Source unavailable is never permission to display a member discount.
    return reply(false, 503);
  }
}
