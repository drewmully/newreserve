/**
 * GET  /api/admin/review-tasks        — list open tasks (latest 50)
 * POST /api/admin/review-tasks        — resolve a task  { id: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";

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

  const snap = await adminDb
    .collection("review_tasks")
    .where("source", "==", "cron")
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  const tasks = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      cron: d.cron as string,
      email: d.email as string,
      reason: d.reason as string,
      status: d.status as string,
      createdAt: (d.createdAt as FirebaseFirestore.Timestamp).toDate().toISOString(),
    };
  });

  return NextResponse.json({ tasks });
}

export async function POST(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
  }

  const { id } = (await request.json()) as { id: string };
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await adminDb.collection("review_tasks").doc(id).update({
    status: "resolved",
    resolvedAt: Timestamp.now(),
  });

  return NextResponse.json({ ok: true });
}
