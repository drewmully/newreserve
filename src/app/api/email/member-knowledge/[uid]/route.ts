/**
 * GET  /api/email/member-knowledge/[uid]  — returns notes array
 * POST /api/email/member-knowledge/[uid]  — adds a note or replaces all notes
 *
 * Body for POST:
 *   { note: string }               — append one note
 *   { notes: string[], replace: true } — replace the full notes array
 *   { deleteNote: string }          — remove a specific note
 */

import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { verifyAdminRequest } from "@/app/api/_lib/adminAuth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  if (!(await verifyAdminRequest(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { uid } = await params;
  const snap = await adminDb.collection("member_knowledge").doc(uid).get();
  const notes = snap.exists ? ((snap.data()?.notes as string[]) ?? []) : [];

  return NextResponse.json({ uid, notes });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  if (!(await verifyAdminRequest(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { uid } = await params;
  const ref = adminDb.collection("member_knowledge").doc(uid);

  let body: { note?: string; notes?: string[]; replace?: boolean; deleteNote?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.deleteNote) {
    await ref.set(
      { notes: FieldValue.arrayRemove(body.deleteNote), updatedAt: Timestamp.now() },
      { merge: true }
    );
    return NextResponse.json({ ok: true });
  }

  if (body.replace && Array.isArray(body.notes)) {
    await ref.set({ notes: body.notes, updatedAt: Timestamp.now() });
    return NextResponse.json({ ok: true });
  }

  if (body.note?.trim()) {
    await ref.set(
      { notes: FieldValue.arrayUnion(body.note.trim()), updatedAt: Timestamp.now() },
      { merge: true }
    );
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Provide note, notes+replace, or deleteNote" }, { status: 400 });
}
