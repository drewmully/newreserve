import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyIdTokenMock = vi.fn();
const fetchMock = vi.fn();

vi.mock("@/lib/firebase-admin", () => ({
  adminAuth: {
    verifyIdToken: verifyIdTokenMock,
  },
}));

function makeRequest(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  return new NextRequest("http://localhost/api/community/upload", {
    method: "POST",
    headers: {
      Authorization: "Bearer token-123",
    },
    body: formData,
  });
}

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/community/upload/route");
}

describe("POST /api/community/upload", () => {
  beforeEach(() => {
    verifyIdTokenMock.mockReset().mockResolvedValue({ uid: "uid_123" });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.FIREBASE_STORAGE_BUCKET = "bucket-test";
  });

  it("rejects non-image community uploads", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest(new File(["video"], "clip.mp4", { type: "video/mp4" }))
    );
    const json = await res.json();

    expect(res.status).toBe(415);
    expect(json).toEqual({
      error: "Community uploads currently support images only.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized images", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest(
        new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.jpg", {
          type: "image/jpeg",
        })
      )
    );
    const json = await res.json();

    expect(res.status).toBe(413);
    expect(json).toEqual({
      error: "Images must be 8 MB or smaller.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads valid images to Firebase storage", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        downloadTokens: "token-abc",
      }),
    });

    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest(new File(["image"], "photo.jpg", { type: "image/jpeg" }))
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://firebasestorage.googleapis.com/v0/b/bucket-test/o?name="
      ),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Firebase token-123",
          "Content-Type": "image/jpeg",
        }),
      })
    );
    expect(json.url).toContain(
      "https://firebasestorage.googleapis.com/v0/b/bucket-test/o/"
    );
  });
});
