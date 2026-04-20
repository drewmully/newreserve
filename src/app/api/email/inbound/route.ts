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
 * Auth: the raw request body is verified against Resend's
 * Svix headers using RESEND_WEBHOOK_SECRET. Non-production
 * local testing may fall back to INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { Resend } from "resend";
import { adminDb, adminAuth } from "@/lib/firebase-admin";
import { pauseForReply, type EmailSequenceDoc } from "@/lib/email/sequences";
import { generateReplyDraft, loadMemberKnowledge, type MemberContext } from "@/lib/email/ai-reply";
import { resolveCustomerByEmail, getStoreCreditByCustomerId, getCustomerOrders } from "@/app/api/_lib/shopifyAdmin";

let resendClient: Resend | null = null;

function getResendClient(): Resend {
  resendClient ??= new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

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
 * Verify the request body against Resend's Svix headers.
 *
 * Non-production local testing may still use bearer auth.
 */
function verifyDevFallback(req: NextRequest): boolean {
  if (process.env.NODE_ENV === "production") return false;

  const devSecret = process.env.INTERNAL_API_SECRET;
  if (!devSecret) return false;

  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${devSecret}`;
}

function verifyWebhookPayload(
  req: NextRequest,
  payload: string
): ResendInboundPayload | { data: ResendInboundPayload } {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET ?? process.env.RESEND_WEBHOOK_SECRET;

  if (!secret) {
    if (!verifyDevFallback(req)) {
      throw new Error("Webhook secret not configured");
    }

    return JSON.parse(payload) as ResendInboundPayload | { data: ResendInboundPayload };
  }

  return getResendClient().webhooks.verify({
    payload,
    headers: {
      id: req.headers.get("svix-id") ?? "",
      timestamp: req.headers.get("svix-timestamp") ?? "",
      signature: req.headers.get("svix-signature") ?? "",
    },
    webhookSecret: secret,
  }) as ResendInboundPayload | { data: ResendInboundPayload };
}

// ─── Resend inbound payload ───────────────────────────────────────────────────

interface ResendInboundPayload {
  email_id?: string;
  from: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  plain_text?: string;
  headers?: Record<string, string>;
}

async function fetchEmailBody(emailId: string): Promise<string> {
  const { data, error } = await getResendClient().emails.receiving.get(emailId);
  if (error || !data) throw new Error(`Resend receiving.get failed: ${JSON.stringify(error)}`);
  return data.text ?? "";
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let rawPayload: string;
  try {
    rawPayload = await req.text();
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = verifyWebhookPayload(req, rawPayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    const status =
      message === "Webhook secret not configured" ? 500 : 401;
    return NextResponse.json(
      { error: status === 500 ? message : "Unauthorized" },
      { status }
    );
  }

  // Resend may wrap the email in a `data` field
  const payload = (
    raw && typeof raw === "object" && "data" in raw ? (raw as { data: unknown }).data : raw
  ) as ResendInboundPayload;

  const senderEmail = payload.from?.trim().toLowerCase();

  let rawText = payload.text ?? payload.plain_text ?? "";
  if (!rawText && payload.email_id) {
    try {
      rawText = await fetchEmailBody(payload.email_id);
    } catch (e) {
      console.error("[email/inbound] Failed to fetch email body:", e);
    }
  }

  if (!senderEmail) {
    return NextResponse.json({ error: "Missing from address", payload: raw }, { status: 400 });
  }

  // 1. Find user by email using Firebase Auth (always returns the real uid)
  let uid: string;
  let userData: Record<string, unknown>;
  try {
    const authUser = await adminAuth.getUserByEmail(senderEmail);
    uid = authUser.uid;
    const userSnap = await adminDb.collection("users").doc(uid).get();
    userData = (userSnap.data() ?? {}) as Record<string, unknown>;
  } catch {
    console.warn(`[email/inbound] Unknown sender: ${senderEmail}`);
    return NextResponse.json({ ok: true, note: "unknown_sender" });
  }

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
    firstName: typeof userData.firstName === "string" ? userData.firstName : null,
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
  if (!replyText) {
    console.warn(`[email/inbound] Empty reply body for replyId=${replyRef.id} — skipping AI draft`);
    return NextResponse.json({ ok: true, replyId: replyRef.id, note: "no_body" });
  }

  try {
    const shopifyCustomerId = typeof userData.shopify_customer_id === "string" ? userData.shopify_customer_id : null;

    type StoreCreditResult = { balance_cents: number; currency: string } | null;
    type OrderResult = Array<{ name: string; total_price: string; currency: string; created_at: string; line_items: Array<{ name: string }> }>;

    const [memberNotes, storeCreditBalance, rawOrders] = await Promise.all([
      loadMemberKnowledge(uid),
      shopifyCustomerId
        ? (getStoreCreditByCustomerId(shopifyCustomerId).catch(() => null) as Promise<StoreCreditResult>)
        : Promise.resolve(null as StoreCreditResult),
      shopifyCustomerId
        ? (getCustomerOrders(shopifyCustomerId, 5).catch(() => []) as Promise<OrderResult>)
        : Promise.resolve([] as OrderResult),
    ]);

    const storeCredit = storeCreditBalance?.balance_cents ?? null;

    const recentOrders = rawOrders.map((o) => ({
      name: o.name,
      total: `${o.currency} ${o.total_price}`,
      date: new Date(o.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      items: o.line_items.map((li) => li.name),
    }));

    const onboardingProfile = (userData.onboarding_profile ?? {}) as Record<string, unknown>;
    const fitProfile = (userData.fit_profile ?? null) as Record<string, string> | null;
    const subs = (userData.subscriptions ?? {}) as Record<string, unknown>;

    const ctx: MemberContext = {
      uid,
      email: senderEmail,
      firstName: typeof userData.firstName === "string" ? userData.firstName : null,
      tier: typeof userData.tier === "string" ? userData.tier : "free",
      isLegacy: userData.isLegacy === true,
      legacyPlan: typeof userData.legacyPlan === "string" ? userData.legacyPlan : null,
      flow: seq.flow,
      lastSentStep: seq.lastSentStep,
      tags: seq.tags ?? [],
      memberNotes: memberNotes.length > 0 ? memberNotes : undefined,
      storeCredit: storeCredit ?? null,
      handicap: typeof onboardingProfile.handicap === "string" ? onboardingProfile.handicap : null,
      vibeCheck: typeof onboardingProfile.vibe_check === "string" ? onboardingProfile.vibe_check : null,
      hasPrivateClub: typeof onboardingProfile.private_club_member === "boolean" ? onboardingProfile.private_club_member : null,
      fitProfile: fitProfile ? {
        shirtSize: fitProfile.shirtSize,
        gloveHand: fitProfile.gloveHand,
        gloveSize: fitProfile.gloveSize,
        waistSize: fitProfile.waistSize,
        pantsInseam: fitProfile.pantsInseam,
        shoeSize: fitProfile.shoeSize,
      } : null,
      recentOrders: recentOrders.length > 0 ? recentOrders : undefined,
      emailTags: Array.isArray(userData.emailTags) ? (userData.emailTags as string[]) : undefined,
      segments: Array.isArray(userData.segments) ? (userData.segments as string[]) : undefined,
      subscriptionStatus: typeof subs.status === "string" ? subs.status : undefined,
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
