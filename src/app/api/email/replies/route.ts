/**
 * GET /api/email/replies
 *
 * Returns all replies pending Drew's approval, newest first.
 * Secured with a Firebase Admin-verified bearer token
 * and server-side admin email allowlist.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyAdminRequest } from "@/app/api/_lib/adminAuth";

export async function GET(req: NextRequest) {
  if (!(await verifyAdminRequest(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snap = await adminDb
    .collection("email_replies")
    .where("status", "in", ["pending_approval", "draft_failed", "pending_draft"])
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  const replies = snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toMillis?.() ?? null,
    draftedAt: doc.data().draftedAt?.toMillis?.() ?? null,
  }));

  return NextResponse.json({ replies });
}
