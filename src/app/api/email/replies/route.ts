/**
 * GET /api/email/replies
 *
 * Returns all replies pending Drew's approval, newest first.
 * Secured with INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
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
