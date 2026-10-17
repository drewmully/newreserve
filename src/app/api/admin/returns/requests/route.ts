/**
 * POST /api/admin/returns/requests  { id, status: "resolved" | "dismissed", note? }
 * Close out a saved customer request without creating a Shopify return.
 */

import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireAdmin } from "@/app/api/_lib/adminAuth";
import { adminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;
  const { id, status, note } = (await req.json().catch(() => ({}))) as { id?: string; status?: string; note?: string };
  if (!id || !["resolved", "dismissed"].includes(status ?? "")) {
    return NextResponse.json({ error: "id and status (resolved|dismissed) required" }, { status: 400 });
  }
  await adminDb.collection("customer_requests").doc(id).set(
    { status, resolvedBy: guard.email, resolvedAt: FieldValue.serverTimestamp(), resolutionNote: note ?? null },
    { merge: true },
  );
  await adminDb.collection("return_decisions").add({
    action: `request_${status}`,
    by: guard.email,
    requestId: id,
    note: note ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return NextResponse.json({ ok: true });
}
