/**
 * POST /api/email/replies/[id]/regenerate
 *
 * Re-generates the AI draft for an existing reply using human feedback.
 * Body: { feedback: string, saveToKnowledge?: boolean }
 *
 * Loads original context from Firestore, calls Claude with the previous
 * draft + feedback, and updates the reply doc with the new draft.
 * If saveToKnowledge=true, persists the feedback as a member note for
 * future replies.
 */

import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { verifyAdminRequest } from "@/app/api/_lib/adminAuth";
import {
  generateReplyDraft,
  loadMemberKnowledge,
  saveMemberNote,
  type MemberContext,
} from "@/lib/email/ai-reply";
import { resolveCustomerByEmail, getStoreCreditByCustomerId } from "@/app/api/_lib/shopifyAdmin";
import type { EmailFlow } from "@/lib/email/sequences";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminRequest(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: { feedback?: string; saveToKnowledge?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const feedback = body.feedback?.trim();
  if (!feedback) {
    return NextResponse.json({ error: "feedback is required" }, { status: 400 });
  }

  const replyRef = adminDb.collection("email_replies").doc(id);
  const snap = await replyRef.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Reply not found" }, { status: 404 });
  }

  const reply = snap.data()!;
  if (reply.status === "sent") {
    return NextResponse.json({ error: "Cannot regenerate a sent reply" }, { status: 409 });
  }

  const uid = reply.uid as string;
  const email = reply.email as string;
  const previousDraft = (reply.draft as string) ?? "";

  const [userSnap, seqSnap, memberNotes, storeCreditBalance] = await Promise.all([
    adminDb.collection("users").doc(uid).get(),
    adminDb.collection("email_sequences").doc(uid).get(),
    loadMemberKnowledge(uid),
    resolveCustomerByEmail(email)
      .then((shopifyId) => (shopifyId ? getStoreCreditByCustomerId(shopifyId) : null))
      .catch(() => null),
  ]);
  const storeCredit = storeCreditBalance?.balance_cents ?? null;

  const userData = (userSnap.data() ?? {}) as Record<string, string | undefined>;
  const seq = seqSnap.data() ?? {};

  const ctx: MemberContext = {
    uid,
    email,
    firstName: (reply.firstName as string | null) ?? null,
    tier: userData.tier ?? "free",
    flow: (seq.flow as EmailFlow) ?? "free",
    lastSentStep: (seq.lastSentStep as number) ?? 0,
    tags: (seq.tags as string[]) ?? [],
    memberNotes: memberNotes.length > 0 ? memberNotes : undefined,
    storeCredit: storeCredit ?? null,
  };

  const { draft, toolCalls } = await generateReplyDraft(
    ctx,
    reply.replyText as string,
    { previousDraft, feedback }
  );

  await replyRef.update({
    draft,
    toolCalls,
    status: "pending_approval",
    draftedAt: Timestamp.now(),
    lastFeedback: feedback,
  });

  if (body.saveToKnowledge && feedback) {
    await saveMemberNote(uid, feedback);
  }

  console.log(`[email/replies] Regenerated draft for replyId=${id} uid=${uid}`);
  return NextResponse.json({ ok: true, draft, toolCalls });
}
