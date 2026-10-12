import { NextResponse } from "next/server";
import { getFirstSellingPlanId } from "@/lib/shopify";
import { MULLY_ACCESS_MONTHLY } from "@/lib/membershipConfig";

export const revalidate = 300;

/** Public Mully Access offer details. `sellingPlanId` is null until the
 * monthly plan exists in Shopify Subscriptions, which hides the bag offer. */
export async function GET() {
  let sellingPlanId: string | null = null;
  try { sellingPlanId = await getFirstSellingPlanId(MULLY_ACCESS_MONTHLY.productHandle); }
  catch (err) { console.error("[mully-access] selling plan lookup failed:", err); }
  return NextResponse.json({
    merchandiseId: MULLY_ACCESS_MONTHLY.merchandiseId,
    sellingPlanId,
    monthlyPrice: MULLY_ACCESS_MONTHLY.monthlyPrice,
    discountRate: MULLY_ACCESS_MONTHLY.discountRate,
  });
}
