/**
 * GET /api/admin/sequence-users
 *
 * Returns all users in email_sequences with their current state.
 * Auth: Firebase Bearer token (admin email allowlist).
 *
 * POST /api/admin/sequence-users
 * Body: { uid, action: "pause" | "resume" | "reset" }
 */

import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import {
  FLOW_STEPS,
  pauseForReply,
  resumeSequence,
  startFlow,
  type EmailSequenceDoc,
} from "@/lib/email/sequences";

async function verifyAdmin(request: NextRequest): Promise<void> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) {
    throw new Error("Forbidden");
  }
}

export async function GET(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
  }

  try {
    const seqSnap = await adminDb.collection("email_sequences").get();

    const users = seqSnap.docs.map((doc) => {
      const d = doc.data() as EmailSequenceDoc;
      const totalSteps = FLOW_STEPS[d.flow]?.length ?? 0;
      return {
        uid: doc.id,
        email: d.email,
        firstName: d.firstName,
        flow: d.flow,
        status: d.status,
        nextStep: d.nextStep,
        lastSentStep: d.lastSentStep,
        totalSteps,
        nextSendAt: d.nextSendAt ? (d.nextSendAt as unknown as Timestamp).toMillis() : null,
        startedAt: (d.startedAt as unknown as Timestamp).toMillis(),
        pausedReason: d.pausedReason ?? null,
      };
    });

    const statusOrder: Record<string, number> = { active: 0, paused: 1, completed: 2 };
    users.sort((a, b) => {
      const so = (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3);
      if (so !== 0) return so;
      return b.startedAt - a.startedAt;
    });

    return NextResponse.json({ users });
  } catch (err) {
    console.error("[admin/sequence-users] GET failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
  }

  try {
    const body = await request.json() as { uid: string; action: string };
    const { uid, action } = body;
    if (!uid || !action) {
      return NextResponse.json({ error: "Missing uid or action" }, { status: 400 });
    }

    const docSnap = await adminDb.collection("email_sequences").doc(uid).get();
    if (!docSnap.exists) {
      return NextResponse.json({ error: "No sequence found for this user" }, { status: 404 });
    }
    const seq = docSnap.data() as EmailSequenceDoc;

    switch (action) {
      case "pause":
        await pauseForReply(uid);
        break;
      case "resume":
        await resumeSequence(uid);
        break;
      case "reset":
        await startFlow(uid, seq.email, seq.firstName, seq.flow);
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/sequence-users] POST failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
