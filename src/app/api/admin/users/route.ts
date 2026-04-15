/**
 * GET /api/admin/users
 *
 * Returns paginated user list for the admin CRM.
 * Auth: Firebase Bearer token (admin email allowlist enforced server-side).
 *
 * Query params:
 *   tier     — filter by tier (free | access | member | black)
 *   status   — filter by subscription status (active | paused | cancelled | none)
 *   limit    — max results (default 50, max 200)
 *   after    — cursor (last uid from previous page)
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

export async function GET(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    const status = msg === "Forbidden" ? 403 : 401;
    return NextResponse.json({ error: msg }, { status });
  }

  const params = request.nextUrl.searchParams;
  const tierFilter = params.get("tier") ?? null;
  const statusFilter = params.get("status") ?? null;
  const limitN = Math.min(parseInt(params.get("limit") ?? "50", 10), 200);
  const after = params.get("after") ?? null;

  try {
    let query = adminDb.collection("users").orderBy("created_at", "desc");

    if (tierFilter) query = query.where("tier", "==", tierFilter) as typeof query;
    if (statusFilter) query = query.where("subscriptions.status", "==", statusFilter) as typeof query;
    if (after) {
      const cursorDoc = await adminDb.collection("users").doc(after).get();
      if (cursorDoc.exists) query = query.startAfter(cursorDoc) as typeof query;
    }

    query = query.limit(limitN) as typeof query;

    const snap = await query.get();

    const users = snap.docs.map((doc) => {
      const d = doc.data() as Record<string, unknown>;
      const subs = (d.subscriptions ?? {}) as Record<string, unknown>;
      const credit = (d.store_credit ?? {}) as Record<string, unknown>;
      return {
        uid: doc.id,
        email: d.email ?? null,
        username: d.username ?? null,
        tier: d.tier ?? "free",
        created_at: (d.created_at as { _seconds?: number } | null)?._seconds
          ? (d.created_at as { _seconds: number })._seconds * 1000
          : null,
        last_login: (d.last_login as { _seconds?: number } | null)?._seconds
          ? (d.last_login as { _seconds: number })._seconds * 1000
          : null,
        onboarding_completed: d.onboarding_completed ?? false,
        subscription_status: subs.status ?? "none",
        mullybox_active: subs.mullybox_active ?? false,
        store_credit_cents: credit.balance_cents ?? 0,
        segments: d.segments ?? [],
      };
    });

    return NextResponse.json({
      users,
      count: users.length,
      hasMore: users.length === limitN,
      nextCursor: users.length === limitN ? users[users.length - 1].uid : null,
    });
  } catch (err) {
    console.error("[admin/users] query failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
