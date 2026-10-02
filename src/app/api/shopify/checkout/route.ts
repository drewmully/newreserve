import { NextResponse } from "next/server";

/** Retired: draft orders trusted stale Firestore tiers and client-supplied prices.
 * All retail carts now use Shopify's checkout with server-enforced eligibility.
 * Old open tabs can fall back to their original Storefront checkout URL. */
export async function POST() {
  return NextResponse.json(
    { error: "Checkout has moved. Refresh your bag and try again." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
