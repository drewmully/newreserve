import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, adminAuth } from "@/lib/firebase-admin";
import { formatRelativeTime } from "@/app/community/posts";
import { ensureCommunitySeedPosts } from "@/lib/communitySeed";

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

export async function GET(req: NextRequest) {
  try {
    await ensureCommunitySeedPosts();

    const { searchParams } = new URL(req.url);
    const tag = searchParams.get("tag");

    // Fetch all posts sorted by createdAt, then filter by tag in-app.
    // This avoids requiring a Firestore composite index on (tag, createdAt).
    const snapshot = await adminDb
      .collection("communityPosts")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    const allDocs = tag && tag !== "All"
      ? snapshot.docs.filter((doc) => doc.data().tag === tag)
      : snapshot.docs;

    const posts = await Promise.all(
      allDocs.map(async (doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          authorId: d.authorId as string,
          author: d.author as string,
          avatar: d.avatar as string,
          timestamp: d.createdAt
            ? formatRelativeTime((d.createdAt as { toDate(): Date }).toDate())
            : "just now",
          title: d.title as string,
          body: d.body as string,
          likes: (d.likes as number) || 0,
          commentCount: (d.commentCount as number) || 0,
          comments: [],
          tag: d.tag as string,
          images: (d.images as string[]) || [],
          videos: (d.videos as string[]) || [],
        };
      })
    );

    return NextResponse.json({ posts });
  } catch (err) {
    console.error("[community/posts GET]", err);
    return NextResponse.json({ error: "Failed to fetch posts" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const uid = await verifyAuth(req);
  if (!uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { title, body, tag, author, avatar, images, videos } = await req.json();
    if (!title?.trim() || !body?.trim()) {
      return NextResponse.json(
        { error: "Title and body are required" },
        { status: 400 }
      );
    }
    if (Array.isArray(videos) && videos.length > 0) {
      return NextResponse.json(
        { error: "Community posts currently support images only." },
        { status: 400 }
      );
    }

    const ref = await adminDb.collection("communityPosts").add({
      authorId: uid,
      author: (author as string) || "Anonymous",
      avatar: (avatar as string) || "?",
      title: (title as string).trim(),
      body: (body as string).trim(),
      tag: (tag as string) || "General",
      images: (images as string[]) || [],
      videos: (videos as string[]) || [],
      likes: 0,
      likedBy: [],
      commentCount: 0,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json(
      {
        post: {
          id: ref.id,
          authorId: uid,
          author: (author as string) || "Anonymous",
          avatar: (avatar as string) || "?",
          timestamp: "just now",
          title: (title as string).trim(),
          body: (body as string).trim(),
          likes: 0,
          commentCount: 0,
          comments: [],
          tag: (tag as string) || "General",
          images: (images as string[]) || [],
          videos: (videos as string[]) || [],
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[community/posts POST]", err);
    return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
  }
}
