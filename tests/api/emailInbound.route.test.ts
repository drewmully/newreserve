import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyWebhookMock = vi.fn();
const receivingGetMock = vi.fn();
const getUserByEmailMock = vi.fn();
const adminDbCollectionMock = vi.fn();
const pauseForReplyMock = vi.fn();
const generateReplyDraftMock = vi.fn();

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: {
    now: vi.fn(() => "server-ts"),
  },
}));

vi.mock("resend", () => ({
  Resend: vi.fn(function Resend() {
    return {
      webhooks: {
        verify: verifyWebhookMock,
      },
      emails: {
        receiving: {
          get: receivingGetMock,
        },
      },
    };
  }),
}));

vi.mock("@/lib/firebase-admin", () => ({
  adminAuth: {
    getUserByEmail: getUserByEmailMock,
  },
  adminDb: {
    collection: adminDbCollectionMock,
  },
}));

vi.mock("@/lib/email/sequences", () => ({
  pauseForReply: pauseForReplyMock,
}));

vi.mock("@/lib/email/ai-reply", () => ({
  generateReplyDraft: generateReplyDraftMock,
}));

function makeRequest(body: string, url = "http://localhost/api/email/inbound") {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": "msg_123",
      "svix-timestamp": "1710000000",
      "svix-signature": "v1,test-signature",
    },
    body,
  });
}

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/email/inbound/route");
}

describe("POST /api/email/inbound", () => {
  beforeEach(() => {
    verifyWebhookMock.mockReset();
    receivingGetMock.mockReset();
    getUserByEmailMock.mockReset();
    adminDbCollectionMock.mockReset();
    pauseForReplyMock.mockReset().mockResolvedValue(undefined);
    generateReplyDraftMock.mockReset();
    process.env.RESEND_WEBHOOK_SECRET = "whsec_test";
  });

  it("rejects requests whose Svix signature does not verify, even with a legacy query secret", async () => {
    verifyWebhookMock.mockImplementation(() => {
      throw new Error("invalid signature");
    });

    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest(
        JSON.stringify({ from: "member@example.com" }),
        "http://localhost/api/email/inbound?secret=legacy"
      )
    );
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({ error: "Unauthorized" });
    expect(getUserByEmailMock).not.toHaveBeenCalled();
  });

  it("verifies the raw payload with Resend and persists the drafted reply", async () => {
    const rawPayload = JSON.stringify({
      data: {
        from: "member@example.com",
        subject: "Need help",
        plain_text: "First line\n> quoted history",
      },
    });

    verifyWebhookMock.mockReturnValue(JSON.parse(rawPayload));
    getUserByEmailMock.mockResolvedValue({ uid: "uid_123" });
    generateReplyDraftMock.mockResolvedValue({
      draft: "Thanks for reaching out.",
      toolCalls: [],
    });

    const replyRef = {
      id: "reply_123",
      set: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    };

    adminDbCollectionMock.mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({
              data: () => ({
                firstName: "Drew",
                tier: "member",
              }),
            }),
          })),
        };
      }

      if (name === "email_sequences") {
        return {
          doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({
                flow: "member",
                lastSentStep: 1,
                tags: ["vip"],
              }),
            }),
          })),
        };
      }

      if (name === "email_replies") {
        return {
          doc: vi.fn(() => replyRef),
        };
      }

      throw new Error(`Unexpected collection ${name}`);
    });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest(rawPayload));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, replyId: "reply_123" });
    expect(verifyWebhookMock).toHaveBeenCalledWith({
      payload: rawPayload,
      headers: {
        id: "msg_123",
        timestamp: "1710000000",
        signature: "v1,test-signature",
      },
      webhookSecret: "whsec_test",
    });
    expect(pauseForReplyMock).toHaveBeenCalledWith("uid_123");
    expect(replyRef.set).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: "uid_123",
        email: "member@example.com",
        subject: "Need help",
        rawText: "First line\n> quoted history",
        replyText: "First line",
        status: "pending_draft",
      })
    );
    expect(replyRef.update).toHaveBeenCalledWith({
      draft: "Thanks for reaching out.",
      toolCalls: [],
      status: "pending_approval",
      draftedAt: "server-ts",
    });
  });
});
