import { NextResponse } from "next/server";
import {
  getFoundingHundredStatus,
  getFoundingHundredVariantGid,
} from "@/lib/foundingHundred";

// Cache at the edge for 30s. The LP tracker doesn't need real-time
// numbers, and a short cache prevents Firestore from getting hammered
// by ad traffic.
export const revalidate = 30;
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getFoundingHundredStatus();
  const variantGid = getFoundingHundredVariantGid();
  // Only expose the variant GID when the offer is actually available so
  // the checkout client never tries to attach a sold-out gift.
  const payload = {
    ...status,
    variantGid: status.available ? variantGid : null,
  };
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
