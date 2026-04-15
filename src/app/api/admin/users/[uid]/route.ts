/**
 * GET /api/admin/users/[uid]
 *
 * Returns a single user's full profile + timeline for the admin CRM.
 * Timeline includes: email sequence state, email events, analytics events.
 * Auth: Firebase Bearer token (admin email allowlist).
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";

async function verifyAdmin(request: NextRequest): Promise<string> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) {
    throw new Error("Forbidden");
  }
  return decoded.uid;
}

function toMs(val: unknown): number | null {
  if (!val) return null;
  const v = val as { _seconds?: number };
  return v._seconds ? v._seconds * 1000 : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
  }

  const { uid } = await params;

  try {
    // Fetch user doc, email sequence, email events, recent analytics events in parallel
    const [userSnap, seqSnap, emailEventsSnap, analyticsSnap, repliesSnap] =
      await Promise.all([
        adminDb.collection("users").doc(uid).get(),
        adminDb.collection("email_sequences").doc(uid).get(),
        adminDb
          .collection("email_events")
          .where("uid", "==", uid)
          .orderBy("created_at", "desc")
          .limit(50)
          .get(),
        adminDb
          .collection("analytics_events")
          .where("uid", "==", uid)
          .orderBy("stored_at", "desc")
          .limit(50)
          .get(),
        adminDb
          .collection("email_replies")
          .where("uid", "==", uid)
          .orderBy("createdAt", "desc")
          .limit(20)
          .get(),
      ]);

    if (!userSnap.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userData = userSnap.data() as Record<string, unknown>;
    const subs = (userData.subscriptions ?? {}) as Record<string, unknown>;
    const credit = (userData.store_credit ?? {}) as Record<string, unknown>;
    const onboardingProfile = (userData.onboarding_profile ?? {}) as Record<string, unknown>;

    const user = {
      uid,
      email: userData.email ?? null,
      username: userData.username ?? null,
      tier: userData.tier ?? "free",
      created_at: toMs(userData.created_at),
      last_login: toMs(userData.last_login),
      updated_at: toMs(userData.updated_at),
      onboarding_completed: userData.onboarding_completed ?? false,
      onboarding_profile: onboardingProfile,
      subscription_status: subs.status ?? "none",
      mullybox_active: subs.mullybox_active ?? false,
      manage_url: subs.manage_url ?? null,
      store_credit_cents: credit.balance_cents ?? 0,
      segments: userData.segments ?? [],
      messaging_preferences: userData.messaging_preferences ?? {},
      shopify_customer_id: userData.shopify_customer_id ?? null,
    };

    // Email sequence state
    const sequence = seqSnap.exists
      ? (() => {
          const s = seqSnap.data() as Record<string, unknown>;
          return {
            flow: s.flow ?? null,
            status: s.status ?? null,
            nextStep: s.nextStep ?? null,
            lastSentStep: s.lastSentStep ?? null,
            startedAt: toMs(s.startedAt),
            nextSendAt: toMs(s.nextSendAt),
            tags: s.tags ?? [],
            pausedReason: s.pausedReason ?? null,
            skippedSteps: s.skippedSteps ?? [],
          };
        })()
      : null;

    // Email engagement events
    const emailEvents = emailEventsSnap.docs.map((doc) => {
      const d = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        event_type: d.event_type ?? null,
        email_id: d.email_id ?? null,
        subject: d.subject ?? null,
        link_url: d.link_url ?? null,
        created_at: toMs(d.created_at),
      };
    });

    // Analytics / product events
    const analyticsEvents = analyticsSnap.docs.map((doc) => {
      const d = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        event_name: d.event_name ?? null,
        page_url: d.page_url ?? null,
        properties: d.properties ?? {},
        stored_at: toMs(d.stored_at),
      };
    });

    // Email replies
    const replies = repliesSnap.docs.map((doc) => {
      const d = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        subject: d.subject ?? null,
        replyText: d.replyText ?? null,
        status: d.status ?? null,
        toolCalls: d.toolCalls ?? [],
        flow: d.flow ?? null,
        lastSentStep: d.lastSentStep ?? null,
        createdAt: toMs(d.createdAt),
      };
    });

    return NextResponse.json({ user, sequence, emailEvents, analyticsEvents, replies });
  } catch (err) {
    console.error(`[admin/users/${uid}] failed:`, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
