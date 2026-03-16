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
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  const uid = await verifyAuth(req);
  if (!uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, commentId } = await params;
    const commentRef = adminDb
      .collection("communityPosts")
      .doc(id)
      .collection("comments")
      .doc(commentId);

    const comment = await commentRef.get();
    if (!comment.exists) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    const likedBy: string[] = (comment.data()?.likedBy as string[]) || [];
    const alreadyLiked = likedBy.includes(uid);

    if (alreadyLiked) {
      await commentRef.update({
        likes: FieldValue.increment(-1),
        likedBy: FieldValue.arrayRemove(uid),
      });
      return NextResponse.json({ liked: false });
    } else {
      await commentRef.update({
        likes: FieldValue.increment(1),
        likedBy: FieldValue.arrayUnion(uid),
      });
      return NextResponse.json({ liked: true });
    }
  } catch (err) {
    console.error("[community/posts/[id]/comments/[commentId]/like POST]", err);
    return NextResponse.json({ error: "Failed to toggle like" }, { status: 500 });
  }
}
