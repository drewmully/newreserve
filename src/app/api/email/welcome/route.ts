/**
 * POST /api/email/welcome
 *
 * Called client-side from MembershipContext after first sign-in.
 * Idempotent — skips if a non-legacy-skip sequence already exists.
 * Legacy users previously marked legacy_skip are upgraded to Flow 4 (back9).
 * Accepts Firebase ID token for auth.
 */

import { NextRequest, NextResponse } from "next/server";
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

  const existing = await adminDb.collection("email_sequences").doc(uid).get();
  const isLegacySkip =
    existing.exists && existing.data()?.tags?.includes("legacy_skip");

  // Already has an active/completed flow — skip (idempotent)
  if (existing.exists && !isLegacySkip) {
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

  // Legacy Back 9 members get Flow 4 — replaces any prior legacy_skip doc
  if (isLegacy) {
    await startFlow(uid, email, firstName, "back9");
    console.log(
      `[email/welcome] back9 flow started for uid=${uid}${isLegacySkip ? " (was legacy_skip)" : ""}`
    );
    return NextResponse.json({ ok: true });
  }

  let flow: EmailFlow = "free";
  if (tier === "member" || tier === "black") flow = "member";
  else if (tier === "access") flow = "access";

  await startFlow(uid, email, firstName, flow);

  console.log(`[email/welcome] ${flow} flow started for uid=${uid} (tier=${tier})`);
  return NextResponse.json({ ok: true });
}
