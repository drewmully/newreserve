import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminDb } from "@/lib/firebase-admin";
import { formatRelativeTime, type ForumPost } from "../../posts";
import PostPageClient from "./PostPageClient";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

async function getPost(id: string): Promise<ForumPost | null> {
  try {
    const doc = await adminDb.collection("communityPosts").doc(id).get();
    if (!doc.exists) return null;

    const d = doc.data()!;
    const commentsSnap = await doc.ref
      .collection("comments")
      .orderBy("createdAt", "asc")
      .get();

    const comments = commentsSnap.docs.map((c) => {
      const cd = c.data();
      return {
        id: c.id,
        author: cd.author as string,
        avatar: cd.avatar as string,
        timestamp: cd.createdAt
          ? formatRelativeTime((cd.createdAt as { toDate(): Date }).toDate())
          : "just now",
        body: cd.body as string,
        likes: (cd.likes as number) || 0,
      };
    });

    return {
      id: doc.id,
      author: d.author as string,
      avatar: d.avatar as string,
      timestamp: d.createdAt
        ? formatRelativeTime((d.createdAt as { toDate(): Date }).toDate())
        : "just now",
      title: d.title as string,
      body: d.body as string,
      likes: (d.likes as number) || 0,
      comments,
      tag: d.tag as string,
      images: (d.images as string[]) || [],
    };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const post = await getPost(id);
  if (!post) return {};
  return {
    title: `${post.title} by ${post.author} | Mully Reserve Community`,
    description: post.body.slice(0, 160),
    openGraph: {
      title: post.title,
      description: post.body.slice(0, 160),
      type: "article",
      authors: [post.author],
    },
  };
}

export default async function PostPage({ params }: Props) {
  const { id } = await params;
  const post = await getPost(id);
  if (!post) notFound();

  return (
    <>
      <PostPageClient post={post} />

      {/* JSON-LD structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "DiscussionForumPosting",
            "headline": post.title,
            "text": post.body,
            "author": { "@type": "Person", "name": post.author },
            "interactionStatistic": [
              { "@type": "InteractionCounter", "interactionType": "https://schema.org/LikeAction", "userInteractionCount": post.likes },
              { "@type": "InteractionCounter", "interactionType": "https://schema.org/CommentAction", "userInteractionCount": post.comments.length },
            ],
            "comment": post.comments.map((c) => ({
              "@type": "Comment",
              "text": c.body,
              "author": { "@type": "Person", "name": c.author },
            })),
          }),
        }}
      />
    </>
  );
}
