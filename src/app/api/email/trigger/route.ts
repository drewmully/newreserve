/**
 * POST /api/email/trigger
 *
 * Starts or switches a user's email flow.
 * Called on:
 *   - New free signup (from MembershipContext after first sign-in)
 *   - Tier upgrade (from Shopify orders-paid webhook)
 *
 * Body: { uid: string; email: string; firstName?: string | null; flow: EmailFlow }
 *
 * Secured with INTERNAL_API_SECRET to prevent public abuse.
 */

import { NextRequest, NextResponse } from "next/server";
import { startFlow, type EmailFlow } from "@/lib/email/sequences";
import { adminDb } from "@/lib/firebase-admin";

// `free` retired 2026-06-04. Manual trigger now only accepts paid tier flows
// + the pre-checkout `reserve` flow (which is also started automatically by
// /api/quiz/complete, but this endpoint lets admins force-enroll a profile).
const VALID_FLOWS: EmailFlow[] = ["access", "member", "reserve"];

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { uid: string; email: string; firstName?: string | null; flow: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { uid, email, flow } = body;
  const firstName = body.firstName ?? null;

  if (!uid || !email || !flow) {
    return NextResponse.json({ error: "uid, email, and flow are required" }, { status: 400 });
  }
  if (!VALID_FLOWS.includes(flow as EmailFlow)) {
    return NextResponse.json({ error: `Invalid flow. Must be one of: ${VALID_FLOWS.join(", ")}` }, { status: 400 });
  }

  // Verify the user exists in Firestore before starting a flow
  const userSnap = await adminDb.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await startFlow(uid, email, firstName, flow as EmailFlow);

  console.log(`[email/trigger] Started flow=${flow} for uid=${uid}`);
  return NextResponse.json({ ok: true });
}
