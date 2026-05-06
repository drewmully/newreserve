/**
 * POST /api/email/replies/[id]/reject
 *
 * Drew dismisses a reply without sending a response.
 * The drip sequence resumes (with the 24h buffer from resumeSequence).
 *
 * Body: { note?: string }  — optional reason for the dismissal log
 *
 * Secured with a Firebase Admin-verified bearer token
 * and server-side admin email allowlist.
 */

import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { completeSequence } from "@/lib/email/sequences";
import { verifyAdminRequest } from "@/app/api/_lib/adminAuth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminRequest(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const replyRef = adminDb.collection("email_replies").doc(id);
  const snap = await replyRef.get();

  if (!snap.exists) {
    return NextResponse.json({ error: "Reply not found" }, { status: 404 });
  }

  const reply = snap.data()!;

  if (reply.status === "sent" || reply.status === "dismissed") {
    return NextResponse.json({ error: "Already resolved" }, { status: 409 });
  }

  let body: { note?: string } = {};
  try {
    body = await req.json();
  } catch {
    // No body is fine
  }

  await replyRef.update({
    status: "dismissed",
    dismissedAt: Timestamp.now(),
    dismissNote: body.note ?? null,
  });

  // End the drip — once a member replies, they're out of the flow
  await completeSequence(reply.uid);

  console.log(`[email/replies] Dismissed replyId=${id} uid=${reply.uid}`);
  return NextResponse.json({ ok: true });
}
