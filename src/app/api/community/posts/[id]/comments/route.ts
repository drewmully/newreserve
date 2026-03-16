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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const commentsSnap = await adminDb
      .collection("communityPosts")
      .doc(id)
      .collection("comments")
      .orderBy("createdAt", "asc")
      .get();

    const comments = commentsSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        author: d.author as string,
        avatar: d.avatar as string,
        timestamp: d.createdAt
          ? formatRelativeTime((d.createdAt as { toDate(): Date }).toDate())
          : "just now",
        body: d.body as string,
        likes: (d.likes as number) || 0,
      };
    });

    return NextResponse.json({ comments });
  } catch (err) {
    console.error("[community/posts/[id]/comments GET]", err);
    return NextResponse.json({ error: "Failed to fetch comments" }, { status: 500 });
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
    const { body, author, avatar } = await req.json();

    if (!body?.trim()) {
      return NextResponse.json({ error: "Comment body is required" }, { status: 400 });
    }

    const postRef = adminDb.collection("communityPosts").doc(id);
    const post = await postRef.get();
    if (!post.exists) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const commentRef = await postRef.collection("comments").add({
      authorId: uid,
      author: (author as string) || "Anonymous",
      avatar: (avatar as string) || "?",
      body: (body as string).trim(),
      likes: 0,
      likedBy: [],
      createdAt: FieldValue.serverTimestamp(),
    });

    // Increment commentCount on parent post
    await postRef.update({ commentCount: FieldValue.increment(1) });

    return NextResponse.json(
      {
        comment: {
          id: commentRef.id,
          author: (author as string) || "Anonymous",
          avatar: (avatar as string) || "?",
          timestamp: "just now",
          body: (body as string).trim(),
          likes: 0,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[community/posts/[id]/comments POST]", err);
    return NextResponse.json({ error: "Failed to add comment" }, { status: 500 });
  }
}
