import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseBearer } from "@/app/api/_lib/loopUserContext";
import { CustomerAccountError, customerGraphQL, getCustomerOutfitContracts } from "@/app/api/_lib/shopifyCustomerAccount";
import { CUSTOMER_CONTRACT_ACTIONS, canActOnContract, type CustomerContractAction } from "@/lib/shopifyCustomerContracts";
export const runtime = "nodejs";
export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  let uid: string;
  try { uid = await verifyFirebaseBearer(request); }
  catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const { action } = await params;
  if (!Object.hasOwn(CUSTOMER_CONTRACT_ACTIONS, action)) return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  let body: { contractId?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  if (!body || typeof body.contractId !== "string" || !/^gid:\/\/shopify\/SubscriptionContract\/\d+$/.test(body.contractId)) {
    return NextResponse.json({ error: "Choose a subscription." }, { status: 400 });
  }
  try {
    // Always look up the authenticated customer's live, matching contracts.
    // Never trust a requested contract ID or a client-supplied customer ID.
    const { contracts, session } = await getCustomerOutfitContracts(uid);
    const contract = contracts.find(item => item.id === body.contractId);
    if (!contract) return NextResponse.json({ error: "Subscription not found." }, { status: 404 });
    if (!canActOnContract(action as CustomerContractAction, contract.status)) {
      return NextResponse.json({ error: "This action is unavailable for the subscription’s current status." }, { status: 409 });
    }
    const data = await customerGraphQL<Record<string, { contract: { id: string; status: string } | null; userErrors: Array<{ message: string }> }>>(
      session.accessToken, CUSTOMER_CONTRACT_ACTIONS[action as CustomerContractAction], { id: contract.id },
    );
    const payload = Object.values(data)[0];
    if (!payload?.contract || payload.userErrors?.length) {
      return NextResponse.json({ error: payload?.userErrors?.[0]?.message || "Shopify could not update this subscription." }, { status: 422 });
    }
    return NextResponse.json({ ok: true, contract: payload.contract }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof CustomerAccountError;
    return NextResponse.json({ error: known ? error.message : "Shopify could not confirm the update. Refresh before trying again.", code: known ? error.code : "unavailable" }, { status: known ? error.status : 502 });
  }
}
