import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";

async function verifyAuth(req: NextRequest): Promise<string | null> {
  const header = req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(header.slice(7));
    return decoded.uid;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  // Verify the user is authenticated
  const uid = await verifyAuth(req);
  if (!uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Community uploads currently support images only." },
        { status: 415 }
      );
    }
    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Images must be 8 MB or smaller." },
        { status: 413 }
      );
    }

    const bucketName =
      process.env.FIREBASE_STORAGE_BUCKET ||
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    if (!bucketName) {
      return NextResponse.json({ error: "Storage bucket not configured" }, { status: 500 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const storagePath = `community/posts/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

    // Proxy the upload to Firebase Storage REST API using the user's ID token.
    // This avoids CORS (server-to-server) and doesn't require Storage Admin
    // permissions on the service account — it respects Firebase Storage Rules.
    const idToken = req.headers.get("Authorization")!.slice(7);
    const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o?name=${encodeURIComponent(storagePath)}`;

    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Firebase ${idToken}`,
        "Content-Type": file.type,
      },
      body: await file.arrayBuffer(),
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error("[community/upload] Firebase Storage error:", errText);
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    const result = (await uploadRes.json()) as { downloadTokens?: string };
    const token = result.downloadTokens;
    const encodedPath = encodeURIComponent(storagePath);
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media${token ? `&token=${token}` : ""}`;

    return NextResponse.json({ url });
  } catch (err) {
    console.error("[community/upload POST]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
