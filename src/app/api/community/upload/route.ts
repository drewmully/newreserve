import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminStorage } from "@/lib/firebase-admin";

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

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const storagePath = `community/posts/${fileName}`;

    // Fall back to the public env var since FIREBASE_STORAGE_BUCKET may not be set server-side
    const bucketName =
      process.env.FIREBASE_STORAGE_BUCKET ||
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    if (!bucketName) {
      return NextResponse.json({ error: "Storage bucket not configured" }, { status: 500 });
    }

    const bucket = adminStorage.bucket(bucketName);
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileRef = bucket.file(storagePath);

    // Generate a Firebase download token so the URL works without ACL changes
    // (modern Firebase buckets have uniform bucket-level access enabled,
    //  which prevents per-object makePublic() / ACL calls)
    const downloadToken =
      Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

    await fileRef.save(buffer, {
      contentType: file.type || "image/jpeg",
      metadata: {
        cacheControl: "public, max-age=31536000",
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    });

    // Standard Firebase Storage download URL with token
    const encodedPath = encodeURIComponent(storagePath);
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${downloadToken}`;
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[community/upload POST]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
