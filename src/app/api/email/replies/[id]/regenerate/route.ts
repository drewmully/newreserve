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
import { resolveCustomerByEmail, getStoreCreditByCustomerId, getCustomerOrders, getCustomerFirstNameById } from "@/app/api/_lib/shopifyAdmin";
import { getSentEmailText } from "@/lib/email/sequences";
import { getLoopSubscriptionStatus } from "@/app/api/_lib/loopAdmin";
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

  const shopifyIdForEmail = await resolveCustomerByEmail(email).catch(() => null);

  const [userSnap, seqSnap, memberNotes, storeCreditBalance, rawOrders, loopSubs, shopifyFirstName] = await Promise.all([
    adminDb.collection("users").doc(uid).get(),
    adminDb.collection("email_sequences").doc(uid).get(),
    loadMemberKnowledge(uid),
    shopifyIdForEmail ? getStoreCreditByCustomerId(shopifyIdForEmail).catch(() => null) : Promise.resolve(null),
    shopifyIdForEmail ? getCustomerOrders(shopifyIdForEmail, 5).catch(() => []) : Promise.resolve([]),
    getLoopSubscriptionStatus(email).catch(() => null),
    shopifyIdForEmail ? getCustomerFirstNameById(shopifyIdForEmail).catch(() => null) : Promise.resolve(null),
  ]);
  const storeCredit = storeCreditBalance?.balance_cents ?? null;

  const recentOrders = (rawOrders as any[]).map((o) => ({
    name: o.name,
    total: `${o.currency} ${o.total_price}`,
    date: new Date(o.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    items: o.line_items.map((li: any) => li.name),
  }));

  const userData = (userSnap.data() ?? {}) as Record<string, unknown>;
  const seq = seqSnap.data() ?? {};
  const onboardingProfile = (userData.onboarding_profile ?? {}) as Record<string, unknown>;
  const fitProfile = (userData.fit_profile ?? null) as Record<string, string> | null;

  // Resolve firstName: Firestore username → saved reply firstName → Shopify → null
  const resolvedFirstName: string | null =
    (typeof userData.username === "string" ? userData.username : null) ??
    (reply.firstName as string | null) ??
    shopifyFirstName ??
    null;

  const ctx: MemberContext = {
    uid,
    email,
    firstName: resolvedFirstName,
    tier: typeof userData.tier === "string" ? userData.tier : "free",
    isLegacy: userData.isLegacy === true,
    legacyPlan: typeof userData.legacyPlan === "string" ? userData.legacyPlan : null,
    flow: (seq.flow as EmailFlow) ?? "access",
    lastSentStep: (seq.lastSentStep as number) ?? 0,
    tags: (seq.tags as string[]) ?? [],
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
    subscriptionStatus: loopSubs?.status ?? undefined,
    nextBillingDate: loopSubs?.nextBillingDate ?? null,
    billingInterval: loopSubs?.billingInterval ?? null,
    memberSince: loopSubs?.memberSince ?? null,
    successfulPayments: loopSubs?.successfulPayments ?? null,
    lastPaymentStatus: loopSubs?.lastPaymentStatus ?? null,
    planPrice: loopSubs?.planPrice ?? null,
    planName: loopSubs?.planName ?? null,
    isPrepaid: loopSubs?.isPrepaid ?? null,
    shippingCity: loopSubs?.shippingCity ?? null,
    shippingState: loopSubs?.shippingState ?? null,
    loopFitProfile: loopSubs?.loopFitProfile ?? null,
  };

  // Use stored drewEmailText if available, otherwise reconstruct from template
  const drewEmailText: string | undefined =
    (reply.drewEmailText as string | undefined) ??
    getSentEmailText(
      (reply.flow as string) as import("@/lib/email/sequences").EmailFlow,
      (reply.lastSentStep as number) ?? 0,
      resolvedFirstName
    ) ??
    undefined;

  const { draft, toolCalls } = await generateReplyDraft(
    ctx,
    reply.replyText as string,
    { drewEmailText, previousDraft, feedback }
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
