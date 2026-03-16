import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, adminAuth } from "@/lib/firebase-admin";
import { formatRelativeTime } from "@/app/community/posts";

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

export async function PUT(
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
    if (post.data()?.authorId !== uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { title, body, tag, images } = await req.json();
    if (!title?.trim() || !body?.trim()) {
      return NextResponse.json(
        { error: "Title and body are required" },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {
      title: (title as string).trim(),
      body: (body as string).trim(),
      tag: (tag as string) || post.data()!.tag,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (images !== undefined) updates.images = images;

    await postRef.update(updates);

    const updated = await postRef.get();
    const d = updated.data()!;

    return NextResponse.json({
      post: {
        id: updated.id,
        authorId: d.authorId as string,
        author: d.author as string,
        avatar: d.avatar as string,
        timestamp: d.createdAt
          ? formatRelativeTime((d.createdAt as { toDate(): Date }).toDate())
          : "just now",
        title: d.title as string,
        body: d.body as string,
        likes: (d.likes as number) || 0,
        comments: [],
        tag: d.tag as string,
        images: (d.images as string[]) || [],
      },
    });
  } catch (err) {
    console.error("[community/posts/[id] PUT]", err);
    return NextResponse.json({ error: "Failed to update post" }, { status: 500 });
  }
}

export async function DELETE(
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
    if (post.data()?.authorId !== uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Delete all comments in subcollection first
    const commentsSnap = await postRef.collection("comments").get();
    const batch = adminDb.batch();
    commentsSnap.docs.forEach((doc) => batch.delete(doc.ref));
    batch.delete(postRef);
    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[community/posts/[id] DELETE]", err);
    return NextResponse.json({ error: "Failed to delete post" }, { status: 500 });
  }
}
