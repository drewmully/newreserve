/**
 * POST /api/email/replies/[id]/approve
 *
 * Drew approves (and optionally edits) a draft reply.
 * Actions:
 *  1. Persist a durable sendAttemptId + approved draft
 *  2. Send the reply via Resend using an idempotency key
 *  3. Mark the reply as sent
 *  4. Execute AI tool calls exactly once
 *  5. Resume the member's drip sequence exactly once
 *
 * Body: { draft?: string } - pass edited draft, or omit to use the stored draft
 *
 * Secured with a Firebase Admin-verified bearer token
 * and server-side admin email allowlist.
 */

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { sendPlainText } from "@/lib/email/resend";
import { completeSequence } from "@/lib/email/sequences";
import { executeToolCalls } from "@/lib/email/ai-reply";
import { verifyAdminRequest } from "@/app/api/_lib/adminAuth";

type ReplyRecord = Record<string, unknown>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getStoredDraft(reply: ReplyRecord): string {
  const candidates = [reply.approvedDraft, reply.finalDraft, reply.draft];
  for (const candidate of candidates) {
    if (isNonEmptyString(candidate)) {
      return candidate.trim();
    }
  }
  return "";
}

function shouldReplaySideEffect(reply: ReplyRecord, field: "toolCallsCompleted" | "sequenceResumed"): boolean {
  if (reply.status === "sent" && reply[field] === undefined) {
    return false;
  }
  return reply[field] !== true;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminRequest(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const replyRef = adminDb.collection("email_replies").doc(id);

  let body: { draft?: string } = {};
  try {
    body = await req.json();
  } catch {
    // No body is fine - use stored draft
  }

  const requestedDraft = typeof body.draft === "string" ? body.draft.trim() : "";

  let state: {
    reply: ReplyRecord;
    textToSend: string;
    sendAttemptId: string;
    alreadySent: boolean;
  };

  try {
    state = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(replyRef);
      if (!snap.exists) {
        throw new Error("Reply not found");
      }

      const reply = (snap.data() ?? {}) as ReplyRecord;
      const storedDraft = getStoredDraft(reply);
      const textToSend = requestedDraft || storedDraft;

      if (!textToSend) {
        throw new Error("No draft content to send");
      }

      const existingAttemptId = isNonEmptyString(reply.sendAttemptId)
        ? reply.sendAttemptId.trim()
        : null;
      const existingApprovedDraft = isNonEmptyString(reply.approvedDraft)
        ? reply.approvedDraft.trim()
        : "";

      if (
        existingAttemptId &&
        requestedDraft &&
        existingApprovedDraft &&
        existingApprovedDraft !== requestedDraft
      ) {
        throw new Error("Reply is already in-flight with a different approved draft");
      }

      if (reply.status === "sent") {
        return {
          reply,
          textToSend,
          sendAttemptId: existingAttemptId ?? `${id}-sent`,
          alreadySent: true,
        };
      }

      const sendAttemptId = existingAttemptId ?? randomUUID();
      tx.update(replyRef, {
        approvedDraft: existingApprovedDraft || textToSend,
        sendAttemptId,
        toolCallsCompleted: reply.toolCallsCompleted === true,
        sequenceResumed: reply.sequenceResumed === true,
        updatedAt: Timestamp.now(),
      });

      return {
        reply: {
          ...reply,
          approvedDraft: existingApprovedDraft || textToSend,
          sendAttemptId,
          toolCallsCompleted: reply.toolCallsCompleted === true,
          sequenceResumed: reply.sequenceResumed === true,
        },
        textToSend,
        sendAttemptId,
        alreadySent: false,
      };
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to approve reply";

    if (message === "Reply not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    if (message === "No draft content to send") {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (message.includes("different approved draft")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }

    throw error;
  }

  const reply = state.reply;
  const email = isNonEmptyString(reply.email) ? reply.email.trim() : "";
  const uid = isNonEmptyString(reply.uid) ? reply.uid.trim() : "";
  const subjectBase = isNonEmptyString(reply.subject)
    ? reply.subject.trim()
    : "Your message";

  if (!email || !uid) {
    return NextResponse.json(
      { error: "Reply is missing required delivery fields" },
      { status: 400 }
    );
  }

  const subject = subjectBase.startsWith("Re:")
    ? subjectBase
    : `Re: ${subjectBase}`;

  if (!state.alreadySent) {
    const providerMessageId = await sendPlainText({
      to: email,
      subject,
      text: state.textToSend,
      idempotencyKey: state.sendAttemptId,
      utmCampaign: "reply_drew",
      // Human-approved 1:1 reply — exempt from the marketing frequency cap.
      sendClass: "transactional",
      category: "reply_drew",
    });

    await replyRef.update({
      status: "sent",
      sentAt: Timestamp.now(),
      finalDraft: state.textToSend,
      approvedDraft: state.textToSend,
      providerMessageId,
    });
  }

  const toolCalls = Array.isArray(reply.toolCalls) ? reply.toolCalls : [];
  if (shouldReplaySideEffect(reply, "toolCallsCompleted")) {
    if (toolCalls.length > 0) {
      await executeToolCalls(uid, id, toolCalls, email);
    }
    await replyRef.update({ toolCallsCompleted: true });
  }

  if (shouldReplaySideEffect(reply, "sequenceResumed")) {
    await completeSequence(uid);
    await replyRef.update({ sequenceResumed: true });
  }

  console.log(`[email/replies] Approved and sent replyId=${id} uid=${uid}`);
  return NextResponse.json({ ok: true, alreadySent: state.alreadySent });
}
