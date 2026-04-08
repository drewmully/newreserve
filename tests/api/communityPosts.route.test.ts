import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyIdTokenMock = vi.fn();
const addMock = vi.fn();
const getMock = vi.fn();
const orderByMock = vi.fn();
const limitMock = vi.fn();
const ensureCommunitySeedPostsMock = vi.fn();

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => "server-ts"),
  },
}));

vi.mock("@/lib/firebase-admin", () => ({
  adminAuth: {
    verifyIdToken: verifyIdTokenMock,
  },
  adminDb: {
    collection: vi.fn((name: string) => {
      if (name !== "communityPosts") {
        throw new Error(`Unexpected collection ${name}`);
      }

      return {
        orderBy: orderByMock,
        add: addMock,
      };
    }),
  },
}));

vi.mock("@/lib/communitySeed", () => ({
  ensureCommunitySeedPosts: ensureCommunitySeedPostsMock,
}));

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/community/posts/route");
}

describe("Community posts routes", () => {
  beforeEach(() => {
    verifyIdTokenMock.mockReset().mockResolvedValue({ uid: "uid_123" });
    addMock.mockReset().mockResolvedValue({ id: "post_123" });
    getMock.mockReset();
    limitMock.mockReset().mockReturnValue({
      get: getMock,
    });
    orderByMock.mockReset().mockReturnValue({
      limit: limitMock,
    });
    ensureCommunitySeedPostsMock.mockReset().mockResolvedValue(undefined);
  });

  it("returns commentCount without hydrating comment bodies in the listing", async () => {
    getMock.mockResolvedValue({
      docs: [
        {
          id: "post_1",
          data: () => ({
            authorId: "uid_123",
            author: "Drew",
            avatar: "D",
            createdAt: { toDate: () => new Date() },
            title: "Hello",
            body: "Body",
            likes: 3,
            commentCount: 4,
            tag: "General",
            images: ["https://cdn.example/image.jpg"],
            videos: ["https://cdn.example/legacy.mp4"],
          }),
        },
      ],
    });

    const { GET } = await loadRoute();
    const res = await GET(
      new NextRequest("http://localhost/api/community/posts", {
        method: "GET",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.posts).toEqual([
      expect.objectContaining({
        id: "post_1",
        commentCount: 4,
        comments: [],
        videos: ["https://cdn.example/legacy.mp4"],
      }),
    ]);
  });

  it("rejects new posts that include videos", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      new NextRequest("http://localhost/api/community/posts", {
        method: "POST",
        headers: {
          Authorization: "Bearer token-123",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: "Video post",
          body: "This should fail",
          videos: ["https://cdn.example/video.mp4"],
        }),
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({
      error: "Community posts currently support images only.",
    });
    expect(addMock).not.toHaveBeenCalled();
  });

  it("creates image-only posts successfully", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      new NextRequest("http://localhost/api/community/posts", {
        method: "POST",
        headers: {
          Authorization: "Bearer token-123",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: "Image post",
          body: "Still works",
          author: "Drew",
          avatar: "D",
          tag: "General",
          images: ["https://cdn.example/image.jpg"],
        }),
      })
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(addMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authorId: "uid_123",
        images: ["https://cdn.example/image.jpg"],
        videos: [],
        commentCount: 0,
      })
    );
    expect(json.post).toEqual(
      expect.objectContaining({
        id: "post_123",
        title: "Image post",
        commentCount: 0,
        comments: [],
      })
    );
  });
});
