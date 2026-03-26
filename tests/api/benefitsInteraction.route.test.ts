import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyIdTokenMock = vi.fn();
const adminDbCollectionMock = vi.fn();
const getLoopRawSubscriptionsMock = vi.fn();
const resendSendMock = vi.fn();

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => "server-ts"),
  },
}));

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: resendSendMock,
    },
  })),
}));

vi.mock("@/lib/firebase-admin", () => ({
  adminAuth: {
    verifyIdToken: verifyIdTokenMock,
  },
  adminDb: {
    collection: adminDbCollectionMock,
  },
}));

vi.mock("@/app/api/_lib/loopAdmin", () => ({
  getLoopRawSubscriptions: getLoopRawSubscriptionsMock,
}));

function makeRequest(
  body: unknown,
  opts?: { withAuth?: boolean; rawBody?: string }
): NextRequest {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (opts?.withAuth !== false) {
    headers.set("Authorization", "Bearer test-token");
  }

  return new NextRequest("http://localhost/api/benefits/interaction", {
    method: "POST",
    headers,
    body: opts?.rawBody ?? JSON.stringify(body),
  });
}

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/benefits/interaction/route");
}

describe("POST /api/benefits/interaction", () => {
  beforeEach(() => {
    verifyIdTokenMock.mockReset();
    adminDbCollectionMock.mockReset();
    getLoopRawSubscriptionsMock.mockReset();
    resendSendMock.mockReset();
    delete process.env.RESEND_API_KEY;
  });

  it("returns 401 when authorization header is missing", async () => {
    const { POST } = await loadRoute();

    const res = await POST(makeRequest({}, { withAuth: false }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({ error: "Unauthorized" });
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
  });

  it("returns 400 when payload is invalid", async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: "uid_1" });
    const { POST } = await loadRoute();

    const res = await POST(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "benefit and action are required" });
  });

  it("returns 403 when user tier is not allowed for the benefit", async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: "uid_2" });
    getLoopRawSubscriptionsMock.mockResolvedValue([]);

    const userRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          email: "free@example.com",
          tier: "free",
          subscriptions: {
            status: "none",
            mullybox_active: false,
          },
        }),
      }),
      set: vi.fn(),
    };

    adminDbCollectionMock.mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: vi.fn(() => userRef),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({
        benefit: "concierge_support",
        action: "request",
        subject: "Need help",
        message: "Book a fitting",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json).toEqual({ error: "Tier not allowed for this benefit" });
    expect(userRef.set).not.toHaveBeenCalled();
  });

  it("returns 200 and persists event/writes when request is valid", async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: "uid_3" });

    const userRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          email: "member@example.com",
          tier: "member",
        }),
      }),
      set: vi.fn().mockResolvedValue(undefined),
    };

    const eventRef = {
      id: "evt_123",
      set: vi.fn().mockResolvedValue(undefined),
    };

    adminDbCollectionMock.mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: vi.fn(() => userRef),
        };
      }
      if (name === "benefit_actions") {
        return {
          doc: vi.fn(() => eventRef),
        };
      }
      if (name === "concierge_requests") {
        return {
          doc: vi.fn(() => ({
            set: vi.fn().mockResolvedValue(undefined),
          })),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({
        benefit: "v1_virtual_coaching",
        action: "toggle",
        enabled: true,
        source: "dashboard",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, id: "evt_123" });
    expect(eventRef.set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "evt_123",
        user_id: "uid_3",
        benefit: "v1_virtual_coaching",
        action: "toggle",
        enabled: true,
        source: "dashboard",
      })
    );
    expect(userRef.set).toHaveBeenCalledWith(
      {
        benefits: {
          v1_virtual_coaching_enabled: true,
          v1_virtual_coaching_updated_at: "server-ts",
        },
      },
      { merge: true }
    );
  });
});
