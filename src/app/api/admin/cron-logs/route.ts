/**
 * GET /api/admin/cron-logs
 *
 * Returns the last 20 cron run logs from Firestore.
 * Auth: Firebase Bearer token (admin email allowlist).
 */

import { NextRequest, NextResponse } from "next/server";
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
    .collection("cron_logs")
    .orderBy("ran_at", "desc")
    .limit(20)
    .get();

  const logs = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      cron: d.cron as string,
      ran_at: (d.ran_at as FirebaseFirestore.Timestamp).toDate().toISOString(),
      total: d.total as number,
      processed: (d.processed ?? d.swapped ?? 0) as number,
      skipped: (d.skipped ?? 0) as number,
      failed: (d.failed ?? 0) as number,
    };
  });

  return NextResponse.json({ logs });
}
