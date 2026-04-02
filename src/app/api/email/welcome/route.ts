/**
 * POST /api/email/welcome
 *
 * Called client-side from MembershipContext after first sign-in.
 * Idempotent: only starts the free flow if no sequence exists yet.
 * Accepts Firebase ID token for auth.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminAuth } from "@/lib/firebase-admin";
import { startFlow } from "@/lib/email/sequences";

async function verifyBearer(req: NextRequest): Promise<string | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(header.slice(7));
    return decoded.uid;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const uid = await verifyBearer(req);
  if (!uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Don't start if a sequence already exists (idempotency)
  const existing = await adminDb.collection("email_sequences").doc(uid).get();
  if (existing.exists) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const userSnap = await adminDb.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const userData = userSnap.data()!;
  const email = userData.email as string;
  const firstName = (userData.username as string | undefined) ?? null;

  await startFlow(uid, email, firstName, "free");

  console.log(`[email/welcome] free flow started for uid=${uid}`);
  return NextResponse.json({ ok: true });
}
