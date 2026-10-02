import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseBearer } from "@/app/api/_lib/loopUserContext";
import { CustomerAccountError, getCustomerOutfitContracts } from "@/app/api/_lib/shopifyCustomerAccount";
import { customerContractForUi } from "@/lib/shopifyCustomerContracts";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  let uid: string;
  try { uid = await verifyFirebaseBearer(request); }
  catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  try {
    const { contracts } = await getCustomerOutfitContracts(uid);
    return NextResponse.json({ subscriptions: contracts.map(customerContractForUi), source: "shopify" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof CustomerAccountError;
    return NextResponse.json({
      error: known ? error.message : "Shopify is temporarily unavailable.",
      code: known ? error.code : "unavailable",
      needsConnection: known && error.code === "connect_required",
    }, { status: known ? error.status : 502, headers: { "Cache-Control": "no-store" } });
  }
}
