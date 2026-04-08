import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyIdTokenMock = vi.fn();
const getUserMock = vi.fn();
const adminDbCollectionMock = vi.fn();

vi.mock("@/lib/firebase-admin", () => ({
  adminAuth: {
    verifyIdToken: verifyIdTokenMock,
    getUser: getUserMock,
  },
  adminDb: {
    collection: adminDbCollectionMock,
  },
}));

function makeRequest(withAuth = true): NextRequest {
  const headers = new Headers();
  if (withAuth) {
    headers.set("Authorization", "Bearer admin-token");
  }

  return new NextRequest("http://localhost/api/email/replies", {
    method: "GET",
    headers,
  });
}

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/email/replies/route");
}

describe("GET /api/email/replies", () => {
  beforeEach(() => {
    verifyIdTokenMock.mockReset();
    getUserMock.mockReset();
    adminDbCollectionMock.mockReset();
    delete process.env.ADMIN_EMAIL_ALLOWLIST;
  });

  it("returns 401 when the admin bearer token is missing", async () => {
    const { GET } = await loadRoute();
    const res = await GET(makeRequest(false));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({ error: "Unauthorized" });
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the caller email is not on the admin allowlist", async () => {
    verifyIdTokenMock.mockResolvedValue({
      uid: "user_1",
      email: "member@example.com",
    });

    const { GET } = await loadRoute();
    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({ error: "Unauthorized" });
    expect(adminDbCollectionMock).not.toHaveBeenCalled();
  });

  it("returns pending replies for allowlisted Firebase admins", async () => {
    verifyIdTokenMock.mockResolvedValue({
      uid: "admin_1",
      email: "drew@mullybox.com",
    });

    const getMock = vi.fn().mockResolvedValue({
      docs: [
        {
          id: "reply_1",
          data: () => ({
            uid: "uid_123",
            email: "member@example.com",
            status: "pending_approval",
            createdAt: { toMillis: () => 1710000000000 },
            draftedAt: { toMillis: () => 1710003600000 },
          }),
        },
      ],
    });

    adminDbCollectionMock.mockImplementation((name: string) => {
      if (name !== "email_replies") {
        throw new Error(`Unexpected collection ${name}`);
      }

      return {
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => ({
              get: getMock,
            })),
          })),
        })),
      };
    });

    const { GET } = await loadRoute();
    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(verifyIdTokenMock).toHaveBeenCalledWith("admin-token", true);
    expect(json).toEqual({
      replies: [
        {
          id: "reply_1",
          uid: "uid_123",
          email: "member@example.com",
          status: "pending_approval",
          createdAt: 1710000000000,
          draftedAt: 1710003600000,
        },
      ],
    });
  });
});
