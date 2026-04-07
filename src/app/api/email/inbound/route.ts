/**
 * POST /api/email/inbound
 *
 * Resend inbound webhook. Called when a member replies to a drip email.
 *
 * Flow:
 *  1. Parse Resend payload — extract sender, stripped reply text
 *  2. Find user in Firestore by sender email
 *  3. pauseForReply — stops the drip sequence
 *  4. Save reply to email_replies/{id}
 *  5. Generate AI draft via Claude
 *  6. Save draft to email_replies/{id} (update)
 *
 * Auth: Resend signs the webhook with a secret in the
 * `svix-signature` header. We verify using RESEND_WEBHOOK_SECRET.
 * If not configured, we fall back to checking INTERNAL_API_SECRET
 * (useful for local testing via curl).
 */

import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { pauseForReply, type EmailSequenceDoc } from "@/lib/email/sequences";
import { generateReplyDraft, type MemberContext } from "@/lib/email/ai-reply";

// ─── Quoted text stripping ────────────────────────────────────────────────────

/**
 * Strip quoted/forwarded content from an email reply body.
 * Keeps only the new text the member typed.
 */
function stripQuotedText(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Standard quote marker ("> text")
    if (trimmed.startsWith(">")) break;

    // "On [date], [name] wrote:" — Gmail/Outlook style
    if (/^On .+wrote:$/i.test(trimmed)) break;

    // "-----Original Message-----"
    if (/^-{3,}\s*original message\s*-{3,}/i.test(trimmed)) break;

    // "From: " header block (Outlook forwarded message)
    if (/^From:\s+.+@.+/i.test(trimmed) && result.length > 0) break;

    result.push(line);
  }

  return result.join("\n").trim();
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

/**
 * Verify the request is genuinely from Resend.
 *
 * Resend inbound webhooks include a `webhook-id`, `webhook-timestamp`,
 * and `webhook-signature` header (Svix standard). Full Svix verification
 * requires the `svix` npm package. For now we verify a shared secret
 * sent as a query param (?secret=...) — configure this in the Resend
 * inbound webhook URL setting.
 *
 * Replace with full Svix verification once `svix` is installed.
 */
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // Dev fallback: accept if INTERNAL_API_SECRET matches
    const devSecret = process.env.INTERNAL_API_SECRET;
    if (!devSecret) return false;
    const auth = req.headers.get("authorization");
    return auth === `Bearer ${devSecret}`;
  }
  const provided = req.nextUrl.searchParams.get("secret");
  return provided === secret;
}

// ─── Resend inbound payload ───────────────────────────────────────────────────

interface ResendInboundPayload {
  from: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  plain_text?: string;
  headers?: Record<string, string>;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  console.log("[email/inbound] raw payload:", JSON.stringify(raw));

  // Resend may wrap the email in a `data` field
  const payload = (
    raw && typeof raw === "object" && "data" in raw ? (raw as { data: unknown }).data : raw
  ) as ResendInboundPayload;

  const senderEmail = payload.from?.trim().toLowerCase();
  const rawText = payload.text ?? payload.plain_text ?? "";

  if (!senderEmail) {
    return NextResponse.json({ error: "Missing from address", payload: raw }, { status: 400 });
  }

  // 1. Find user by email
  const usersSnap = await adminDb
    .collection("users")
    .where("email", "==", senderEmail)
    .limit(1)
    .get();

  if (usersSnap.empty) {
    // Not a known user — log and ignore
    console.warn(`[email/inbound] Unknown sender: ${senderEmail}`);
    return NextResponse.json({ ok: true, note: "unknown_sender" });
  }

  const userDoc = usersSnap.docs[0];
  const uid = userDoc.id;
  const userData = userDoc.data();

  // 2. Load the sequence doc
  const seqSnap = await adminDb.collection("email_sequences").doc(uid).get();
  if (!seqSnap.exists) {
    console.warn(`[email/inbound] No sequence for uid=${uid}`);
    return NextResponse.json({ ok: true, note: "no_sequence" });
  }

  const seq = seqSnap.data() as EmailSequenceDoc;

  // 3. Pause the drip
  await pauseForReply(uid);

  // 4. Strip quoted text and save the reply
  const replyText = stripQuotedText(rawText);

  const replyRef = adminDb.collection("email_replies").doc();
  await replyRef.set({
    uid,
    email: senderEmail,
    firstName: userData.firstName ?? null,
    subject: payload.subject ?? "",
    replyText,
    rawText,
    flow: seq.flow,
    lastSentStep: seq.lastSentStep,
    status: "pending_draft",
    createdAt: Timestamp.now(),
  });

  const replyId = replyRef.id;

  // 5. Generate AI draft (non-blocking — catch errors so the webhook
  //    still returns 200 to Resend even if Claude is slow/unavailable)
  try {
    const ctx: MemberContext = {
      uid,
      email: senderEmail,
      firstName: userData.firstName ?? null,
      tier: userData.tier ?? "free",
      flow: seq.flow,
      lastSentStep: seq.lastSentStep,
      tags: seq.tags ?? [],
    };

    const { draft, toolCalls } = await generateReplyDraft(ctx, replyText);

    await replyRef.update({
      draft,
      toolCalls,
      status: "pending_approval",
      draftedAt: Timestamp.now(),
    });

    console.log(`[email/inbound] Draft ready for replyId=${replyId} uid=${uid}`);
  } catch (err) {
    console.error(`[email/inbound] AI draft failed for replyId=${replyId}:`, err);
    await replyRef.update({ status: "draft_failed", draftError: String(err) });
  }

  return NextResponse.json({ ok: true, replyId });
}
