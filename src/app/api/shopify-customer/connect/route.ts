import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseBearer } from "@/app/api/_lib/loopUserContext";
import { beginCustomerConnection, CUSTOMER_STATE_COOKIE, CustomerAccountError } from "@/app/api/_lib/shopifyCustomerAccount";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  let uid: string;
  try { uid = await verifyFirebaseBearer(request); }
  catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  try {
    const connection = await beginCustomerConnection(uid);
    const response = NextResponse.json({ url: connection.url }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(CUSTOMER_STATE_COOKIE, connection.state, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
    return response;
  } catch (error) {
    const known = error instanceof CustomerAccountError;
    return NextResponse.json({ error: known ? error.message : "Unable to connect Shopify.", code: known ? error.code : "unavailable" }, { status: known ? error.status : 502 });
  }
}
