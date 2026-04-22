import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb, adminAuth } from "@/lib/firebase-admin";
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

  const status = request.nextUrl.searchParams.get("status") ?? "pending";

  const snap =
    status === "all"
      ? await adminDb.collection("registry_applications").get()
      : await adminDb.collection("registry_applications").where("status", "==", status).get();

  const applications = await Promise.all(
    snap.docs.map(async (doc) => {
      const data = doc.data();
      const uid = doc.id;

      const userSnap = await adminDb.collection("users").doc(uid).get();
      const userData = userSnap.data() ?? {};

      const createdAt = data.created_at instanceof Timestamp
        ? data.created_at.toMillis()
        : null;
      const reviewedAt = data.reviewed_at
        ? new Date(data.reviewed_at as string).getTime()
        : null;

      return {
        uid,
        status: data.status as string,
        metadata: (data.metadata ?? {}) as Record<string, unknown>,
        created_at: createdAt,
        reviewed_at: reviewedAt,
        user_email: (userData.email as string | undefined) ?? null,
        user_name: (userData.username as string | undefined) ?? null,
        tier: (userData.tier as string | undefined) ?? "free",
      };
    })
  );

  applications.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));

  return NextResponse.json({ applications });
}

export async function POST(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
  }

  let body: { uid: string; action: "approve" | "reject" };
  try {
    body = (await request.json()) as { uid: string; action: "approve" | "reject" };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { uid, action } = body;
  if (!uid || (action !== "approve" && action !== "reject")) {
    return NextResponse.json({ error: "uid and action (approve|reject) required" }, { status: 400 });
  }

  const ref = adminDb.collection("registry_applications").doc(uid);
  const snap = await ref.get();

  if (!snap.exists) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  const newStatus = action === "approve" ? "approved" : "rejected";
  await ref.update({ status: newStatus, reviewed_at: new Date().toISOString() });

  return NextResponse.json({ ok: true, uid, status: newStatus });
}
