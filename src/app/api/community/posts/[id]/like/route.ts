import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, adminAuth } from "@/lib/firebase-admin";

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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const uid = await verifyAuth(req);
  if (!uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const postRef = adminDb.collection("communityPosts").doc(id);
    const post = await postRef.get();

    if (!post.exists) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const likedBy: string[] = (post.data()?.likedBy as string[]) || [];
    const alreadyLiked = likedBy.includes(uid);

    if (alreadyLiked) {
      await postRef.update({
        likes: FieldValue.increment(-1),
        likedBy: FieldValue.arrayRemove(uid),
      });
      return NextResponse.json({ liked: false });
    } else {
      await postRef.update({
        likes: FieldValue.increment(1),
        likedBy: FieldValue.arrayUnion(uid),
      });
      return NextResponse.json({ liked: true });
    }
  } catch (err) {
    console.error("[community/posts/[id]/like POST]", err);
    return NextResponse.json({ error: "Failed to toggle like" }, { status: 500 });
  }
}
