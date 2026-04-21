import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { getLoopRawSubscriptions } from "@/app/api/_lib/loopAdmin";
import { resolveCustomerByEmail } from "@/app/api/_lib/shopifyAdmin";

async function verifyAdmin(request: NextRequest): Promise<string> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw Object.assign(new Error("Missing token"), { status: 401 });
  const decoded = await adminAuth.verifyIdToken(token);
  if (!isAllowedAdminEmail(decoded.email ?? ""))
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  return decoded.uid;
}

export async function GET(request: NextRequest) {
  try {
    await verifyAdmin(request);
    const email = request.nextUrl.searchParams.get("email");
    if (!email) return NextResponse.json({ error: "email param required" }, { status: 400 });

    const customer = await resolveCustomerByEmail(email);
    if (!customer) return NextResponse.json({ error: "Shopify customer not found" }, { status: 404 });

    const subs = await getLoopRawSubscriptions(customer.id);
    return NextResponse.json({ customerId: customer.id, subscriptions: subs });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
