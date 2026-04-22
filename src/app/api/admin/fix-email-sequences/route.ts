/**
 * POST /api/admin/fix-email-sequences
 *
 * Backfill: finds users whose email sequence flow doesn't match their actual
 * tier and corrects them. Handles two cases:
 *   1. Legacy members (isLegacy=true) stuck in any active flow → mark completed
 *   2. Paid members (tier=member/black/access) stuck in free flow → switch to correct flow
 *
 * Body: { dry_run: boolean }
 * Auth: Firebase Bearer token (admin email allowlist).
 */

import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
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
  | "legacy_marked_completed"
  | "switched_to_member"
  | "switched_to_access"
  | "already_correct"
  | "skipped_no_user_doc"
  | "skipped_no_email";

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

  // Fetch all non-completed sequences
  const seqSnap = await adminDb
    .collection("email_sequences")
    .where("status", "in", ["active", "paused"])
    .get();

  const results: ResultRow[] = [];

  for (const seqDoc of seqSnap.docs) {
    const uid = seqDoc.id;
    const seqData = seqDoc.data() as Record<string, unknown>;
    const currentFlow = (seqData.flow as string) ?? "free";
    const currentStatus = (seqData.status as string) ?? "active";

    // Fetch user doc for tier info
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

    // Case 1: legacy member in any active flow → mark completed
    if (isLegacy) {
      results.push({
        uid,
        email,
        tier,
        is_legacy: true,
        current_flow: currentFlow,
        current_status: currentStatus,
        action: "legacy_marked_completed",
      });

      if (!dryRun) {
        await seqDoc.ref.update({
          flow: "member",
          status: "completed",
          nextSendAt: null,
          tags: ["legacy_skip"],
          updatedAt: Timestamp.now(),
        });
      }
      continue;
    }

    // Case 2: paid member stuck in free flow
    const correctFlow: EmailFlow =
      tier === "member" || tier === "black"
        ? "member"
        : tier === "access"
        ? "access"
        : "free";

    if (correctFlow === currentFlow) {
      results.push({
        uid,
        email,
        tier,
        is_legacy: false,
        current_flow: currentFlow,
        current_status: currentStatus,
        action: "already_correct",
      });
      continue;
    }

    if (correctFlow !== "free") {
      if (!email) {
        results.push({
          uid,
          email: null,
          tier,
          is_legacy: false,
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
        is_legacy: false,
        current_flow: currentFlow,
        current_status: currentStatus,
        action: correctFlow === "member" ? "switched_to_member" : "switched_to_access",
      });

      if (!dryRun) {
        await startFlow(uid, email, firstName, correctFlow);
      }
    } else {
      // tier=free stuck in member/access — shouldn't happen, flag as already_correct
      results.push({
        uid,
        email,
        tier,
        is_legacy: false,
        current_flow: currentFlow,
        current_status: currentStatus,
        action: "already_correct",
      });
    }
  }

  const summary = {
    total_checked: seqSnap.size,
    legacy_marked_completed: results.filter((r) => r.action === "legacy_marked_completed").length,
    switched_to_member: results.filter((r) => r.action === "switched_to_member").length,
    switched_to_access: results.filter((r) => r.action === "switched_to_access").length,
    already_correct: results.filter((r) => r.action === "already_correct").length,
    skipped: results.filter((r) => r.action.startsWith("skipped")).length,
  };

  return NextResponse.json({ dry_run: dryRun, summary, results });
}
