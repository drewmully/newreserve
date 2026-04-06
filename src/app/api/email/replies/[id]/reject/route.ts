/**
 * POST /api/email/replies/[id]/reject
 *
 * Drew dismisses a reply without sending a response.
 * The drip sequence resumes (with the 24h buffer from resumeSequence).
 *
 * Body: { note?: string }  — optional reason for the dismissal log
 *
 * Secured with INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { resumeSequence } from "@/lib/email/sequences";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = params;
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

  // Resume the drip so it's not stuck paused
  await resumeSequence(reply.uid);

  console.log(`[email/replies] Dismissed replyId=${id} uid=${reply.uid}`);
  return NextResponse.json({ ok: true });
}
