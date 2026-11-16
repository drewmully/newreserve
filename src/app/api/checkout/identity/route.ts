/**
 * POST /api/checkout/identity
 *
 * Auth: `Authorization: Bearer <Firebase ID token>`.
 * Returns the signed-in user's lowercased email (for Shopify cart
 * buyerIdentity) and a signed uid token for the `_mully_uid_token` cart
 * attribute, which the orders-paid webhook uses to link the order to this
 * account before falling back to email matching. See src/lib/checkoutIdentity.ts.
 *
 * Read-only: no Firestore or Shopify writes.
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { normalizeAccountEmail, signCheckoutUid } from "@/lib/checkoutIdentity";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const header = request.headers.get("Authorization") ?? "";
  const idToken = header.replace(/^Bearer\s+/i, "").trim();
  if (!idToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let decoded: { uid: string; email?: string };
  try {
    decoded = await adminAuth.verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    {
      email: normalizeAccountEmail(decoded.email),
      uidToken: signCheckoutUid(decoded.uid),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
