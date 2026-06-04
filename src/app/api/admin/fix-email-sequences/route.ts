/**
 * POST /api/admin/fix-email-sequences
 *
 * Backfill: finds users whose email sequence flow doesn't match their actual
 * tier and corrects them. Paid members (tier=member/black/access) stuck on
 * the wrong drip get switched to the correct flow.
 *
 * Body: { dry_run: boolean }
 * Auth: Firebase Bearer token (admin email allowlist).
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { startFlow, type EmailFlow } from "@/lib/email/sequences";

async function verifyAdmin(request: NextRequest): Promise<void> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) {
    throw new Error("Forbidden");
  }
}

type ActionType =
  | "switched_to_member"
  | "switched_to_access"
  | "already_correct"
  | "skipped_no_user_doc"
  | "skipped_no_email"
  | "skipped_tier_no_drip";

interface ResultRow {
  uid: string;
  email: string | null;
  tier: string;
  is_legacy: boolean;
  current_flow: string;
  current_status: string;
  action: ActionType;
}

export async function POST(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
  }

  let dryRun = true;
  try {
    const body = (await request.json()) as { dry_run?: boolean };
    dryRun = body.dry_run !== false;
  } catch {
    // default to dry_run=true
  }

  const activeSnap = await adminDb
    .collection("email_sequences")
    .where("status", "in", ["active", "paused"])
    .get();

  const results: ResultRow[] = [];

  for (const seqDoc of activeSnap.docs) {
    const uid = seqDoc.id;
    const seqData = seqDoc.data() as Record<string, unknown>;
    const currentFlow = (seqData.flow as string) ?? "";
    const currentStatus = (seqData.status as string) ?? "active";

    const userSnap = await adminDb.collection("users").doc(uid).get();
    if (!userSnap.exists) {
      results.push({
        uid,
        email: (seqData.email as string) ?? null,
        tier: "unknown",
        is_legacy: false,
        current_flow: currentFlow,
        current_status: currentStatus,
        action: "skipped_no_user_doc",
      });
      continue;
    }

    const userData = userSnap.data()!;
    const email = (userData.email as string | undefined) ?? (seqData.email as string | undefined) ?? null;
    const tier = (userData.tier as string | undefined) ?? "free";
    const isLegacy = (userData.isLegacy as boolean | undefined) ?? false;
    const firstName = (userData.username as string | undefined) ?? null;

    // Determine correct flow from tier. Anything without a drip (free, legacy,
    // unknown) is skipped — no drip campaign to enroll them in.
    const correctFlow: EmailFlow | null =
      tier === "member" || tier === "black"
        ? "member"
        : tier === "access"
        ? "access"
        : null;

    if (!correctFlow) {
      results.push({
        uid,
        email,
        tier,
        is_legacy: isLegacy,
        current_flow: currentFlow,
        current_status: currentStatus,
        action: "skipped_tier_no_drip",
      });
      continue;
    }

    if (correctFlow === currentFlow) {
      results.push({
        uid,
        email,
        tier,
        is_legacy: isLegacy,
        current_flow: currentFlow,
        current_status: currentStatus,
        action: "already_correct",
      });
      continue;
    }

    if (!email) {
      results.push({
        uid,
        email: null,
        tier,
        is_legacy: isLegacy,
        current_flow: currentFlow,
        current_status: currentStatus,
        action: "skipped_no_email",
      });
      continue;
    }

    results.push({
      uid,
      email,
      tier,
      is_legacy: isLegacy,
      current_flow: currentFlow,
      current_status: currentStatus,
      action: correctFlow === "member" ? "switched_to_member" : "switched_to_access",
    });

    if (!dryRun) {
      await startFlow(uid, email, firstName, correctFlow);
    }
  }

  const summary = {
    total_checked: activeSnap.docs.length,
    switched_to_member: results.filter((r) => r.action === "switched_to_member").length,
    switched_to_access: results.filter((r) => r.action === "switched_to_access").length,
    already_correct: results.filter((r) => r.action === "already_correct").length,
    skipped: results.filter((r) => r.action.startsWith("skipped")).length,
  };

  return NextResponse.json({ dry_run: dryRun, summary, results });
}
