/**
 * POST /api/email/replies/[id]/approve
 *
 * Drew approves (and optionally edits) a draft reply.
 * Actions:
 *  1. Send the (edited) draft via Resend
 *  2. Execute AI tool calls (tag_member, log_feedback, create_task, etc.)
 *  3. Mark reply as sent
 *  4. Resume the member's drip sequence
 *
 * Body: { draft?: string }  — pass edited draft, or omit to use AI draft as-is
 *
 * Secured with INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { sendPlainText } from "@/lib/email/resend";
import { resumeSequence } from "@/lib/email/sequences";
import { executeToolCalls } from "@/lib/email/ai-reply";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const replyRef = adminDb.collection("email_replies").doc(id);
  const snap = await replyRef.get();

  if (!snap.exists) {
    return NextResponse.json({ error: "Reply not found" }, { status: 404 });
  }

  const reply = snap.data()!;

  if (reply.status === "sent") {
    return NextResponse.json({ error: "Already sent" }, { status: 409 });
  }

  let body: { draft?: string } = {};
  try {
    body = await req.json();
  } catch {
    // No body is fine — use AI draft
  }

  const textToSend = (body.draft ?? reply.draft ?? "").trim();

  if (!textToSend) {
    return NextResponse.json({ error: "No draft content to send" }, { status: 400 });
  }

  // 1. Send the email
  const subject = reply.subject?.startsWith("Re:")
    ? reply.subject
    : `Re: ${reply.subject ?? "Your message"}`;

  await sendPlainText({
    to: reply.email,
    subject,
    text: textToSend,
  });

  // 2. Execute AI tool calls
  const toolCalls = reply.toolCalls ?? [];
  if (toolCalls.length > 0) {
    await executeToolCalls(reply.uid, id, toolCalls);
  }

  // 3. Mark as sent
  await replyRef.update({
    status: "sent",
    sentAt: Timestamp.now(),
    finalDraft: textToSend,
  });

  // 4. Resume the drip sequence
  await resumeSequence(reply.uid);

  console.log(`[email/replies] Approved and sent replyId=${id} uid=${reply.uid}`);
  return NextResponse.json({ ok: true });
}
