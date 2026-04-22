/**
 * POST /api/email/welcome
 *
 * Called client-side from MembershipContext after first sign-in.
 * Idempotent: only starts the free flow if no sequence exists yet.
 * Accepts Firebase ID token for auth.
 */

import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb, adminAuth } from "@/lib/firebase-admin";
import { startFlow, type EmailFlow } from "@/lib/email/sequences";

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
  const tier = (userData.tier as string | undefined) ?? "free";
  const isLegacy = (userData.isLegacy as boolean | undefined) ?? false;

  // Legacy members (Back 9, etc.) have been members for years — skip onboarding
  if (isLegacy) {
    await adminDb.collection("email_sequences").doc(uid).set({
      flow: "member",
      status: "completed",
      nextStep: 0,
      startedAt: Timestamp.now(),
      nextSendAt: null,
      lastSentStep: -1,
      skippedSteps: [],
      tags: ["legacy_skip"],
      email,
      firstName,
    });
    console.log(`[email/welcome] legacy user uid=${uid} — marked completed, no sequence`);
    return NextResponse.json({ ok: true, skipped: "legacy" });
  }

  let flow: EmailFlow = "free";
  if (tier === "member" || tier === "black") flow = "member";
  else if (tier === "access") flow = "access";

  await startFlow(uid, email, firstName, flow);

  console.log(`[email/welcome] ${flow} flow started for uid=${uid} (tier=${tier})`);
  return NextResponse.json({ ok: true });
}
