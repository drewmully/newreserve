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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  const uid = await verifyAuth(req);
  if (!uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, commentId } = await params;
    const postRef = adminDb.collection("communityPosts").doc(id);
    const commentRef = postRef.collection("comments").doc(commentId);

    const comment = await commentRef.get();
    if (!comment.exists) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    // Only the comment author can delete it
    if (comment.data()?.authorId !== uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await commentRef.delete();

    // Decrement commentCount on parent post
    await postRef.update({ commentCount: FieldValue.increment(-1) });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[community/posts/[id]/comments/[commentId] DELETE]", err);
    return NextResponse.json({ error: "Failed to delete comment" }, { status: 500 });
  }
}
