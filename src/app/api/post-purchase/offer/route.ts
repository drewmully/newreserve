import { NextRequest } from "next/server";
import { CORS, json, isExistingMember, mullyAccessChanges, verifyExtensionRequest } from "@/lib/postPurchase/mullyAccessOffer";
import { MULLY_ACCESS_MONTHLY } from "@/lib/membershipConfig";

export const dynamic = "force-dynamic";
export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });

/** ShouldRender: offer Mully Access only to non-members, only once the plan exists. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  let purchase;
  try { purchase = verifyExtensionRequest(req, body.referenceId); }
  catch { return json({ render: false }, 401); }
  try {
    if (await isExistingMember(purchase.customerId)) return json({ render: false });
    const changes = await mullyAccessChanges();
    if (!changes) return json({ render: false });
    return json({
      render: true,
      offer: {
        title: MULLY_ACCESS_MONTHLY.label,
        monthlyPrice: MULLY_ACCESS_MONTHLY.monthlyPrice,
        discountPercent: Math.round(MULLY_ACCESS_MONTHLY.discountRate * 100),
        changes,
      },
    });
  } catch (err) {
    console.error("[post-purchase/offer]", err);
    return json({ render: false });
  }
}
