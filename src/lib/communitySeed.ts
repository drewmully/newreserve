import { Timestamp } from "firebase-admin/firestore";
import { posts as seedPosts } from "@/app/community/posts";
import { adminDb } from "@/lib/firebase-admin";

function parseRelativeTimestamp(label: string, fallbackMinutes: number): Date {
  const normalized = label.trim().toLowerCase();
  if (normalized === "just now") return new Date();

  const match = normalized.match(/(\d+)\s*(min|minute|minutes|hour|hours|day|days)/i);
  if (!match) {
    return new Date(Date.now() - fallbackMinutes * 60_000);
  }

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const minutesPerUnit =
    unit.startsWith("day") ? 1_440 : unit.startsWith("hour") ? 60 : 1;
  return new Date(Date.now() - value * minutesPerUnit * 60_000);
}

export async function ensureCommunitySeedPosts(): Promise<void> {
  const postsRef = adminDb.collection("communityPosts");
  const snapshot = await postsRef.limit(1).get();
  if (!snapshot.empty) return;

  const batch = adminDb.batch();

  seedPosts.forEach((post, postIndex) => {
    const postCreatedAt = parseRelativeTimestamp(post.timestamp, (postIndex + 1) * 240);
    const postRef = postsRef.doc(post.id);

    batch.set(postRef, {
      authorId: `seed-post-${post.id}`,
      author: post.author,
      avatar: post.avatar,
      title: post.title,
      body: post.body,
      tag: post.tag,
      images: post.images ?? [],
      videos: post.videos ?? [],
      likes: post.likes,
      likedBy: [],
      commentCount: post.comments.length,
      createdAt: Timestamp.fromDate(postCreatedAt),
      seeded: true,
    });

    post.comments.forEach((comment, commentIndex) => {
      const commentCreatedAt = parseRelativeTimestamp(
        comment.timestamp,
        (postIndex + 1) * 240 - commentIndex * 5
      );
      const commentRef = postRef.collection("comments").doc(comment.id);
      batch.set(commentRef, {
        authorId: `seed-comment-${comment.id}`,
        author: comment.author,
        avatar: comment.avatar,
        body: comment.body,
        likes: comment.likes,
        likedBy: [],
        createdAt: Timestamp.fromDate(commentCreatedAt),
        seeded: true,
      });
    });
  });

  await batch.commit();
}
