import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyAdminRequestMock = vi.fn();
const runTransactionMock = vi.fn();
const adminDbCollectionMock = vi.fn();
const sendPlainTextMock = vi.fn();
const resumeSequenceMock = vi.fn();
const executeToolCallsMock = vi.fn();

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: {
    now: vi.fn(() => "server-ts"),
  },
}));

vi.mock("@/app/api/_lib/adminAuth", () => ({
  verifyAdminRequest: verifyAdminRequestMock,
}));

vi.mock("@/lib/firebase-admin", () => ({
  adminDb: {
    collection: adminDbCollectionMock,
    runTransaction: runTransactionMock,
  },
}));

vi.mock("@/lib/email/resend", () => ({
  sendPlainText: sendPlainTextMock,
}));

vi.mock("@/lib/email/sequences", () => ({
  resumeSequence: resumeSequenceMock,
}));

vi.mock("@/lib/email/ai-reply", () => ({
  executeToolCalls: executeToolCallsMock,
}));

function makeRequest(body?: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/email/replies/reply_123/approve", {
    method: "POST",
    headers: {
      Authorization: "Bearer admin-token",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/email/replies/[id]/approve/route");
}

describe("POST /api/email/replies/[id]/approve", () => {
  beforeEach(() => {
    verifyAdminRequestMock.mockReset().mockResolvedValue(true);
    adminDbCollectionMock.mockReset();
    runTransactionMock.mockReset();
    sendPlainTextMock.mockReset().mockResolvedValue("provider-msg-1");
    resumeSequenceMock.mockReset().mockResolvedValue(undefined);
    executeToolCallsMock.mockReset().mockResolvedValue(undefined);
  });

  it("persists an idempotency key before sending and finalizes side effects once", async () => {
    const replyRef = {
      update: vi.fn().mockResolvedValue(undefined),
    };
    const transactionUpdateMock = vi.fn();
    const reply = {
      uid: "uid_123",
      email: "member@example.com",
      subject: "Need help",
      draft: "Approved draft",
      toolCalls: [{ name: "tag_member" }],
      status: "pending_approval",
    };

    adminDbCollectionMock.mockImplementation((name: string) => {
      if (name !== "email_replies") throw new Error(`Unexpected collection ${name}`);
      return {
        doc: vi.fn(() => replyRef),
      };
    });

    runTransactionMock.mockImplementation(async (fn: (tx: { get: typeof vi.fn; update: typeof vi.fn }) => Promise<unknown>) =>
      fn({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => reply,
        }),
        update: transactionUpdateMock,
      })
    );

    const { POST } = await loadRoute();
    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: "reply_123" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, alreadySent: false });
    expect(transactionUpdateMock).toHaveBeenCalledTimes(1);
    const transactionPayload = transactionUpdateMock.mock.calls[0][1] as Record<string, unknown>;
    expect(transactionPayload).toEqual(
      expect.objectContaining({
        approvedDraft: "Approved draft",
        toolCallsCompleted: false,
        sequenceResumed: false,
        updatedAt: "server-ts",
      })
    );
    expect(typeof transactionPayload.sendAttemptId).toBe("string");
    expect(sendPlainTextMock).toHaveBeenCalledWith({
      to: "member@example.com",
      subject: "Re: Need help",
      text: "Approved draft",
      idempotencyKey: transactionPayload.sendAttemptId,
    });
    expect(replyRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "sent",
        sentAt: "server-ts",
        finalDraft: "Approved draft",
        approvedDraft: "Approved draft",
        providerMessageId: "provider-msg-1",
      })
    );
    expect(executeToolCallsMock).toHaveBeenCalledWith("uid_123", "reply_123", [
      { name: "tag_member" },
    ]);
    expect(replyRef.update).toHaveBeenCalledWith({ toolCallsCompleted: true });
    expect(resumeSequenceMock).toHaveBeenCalledWith("uid_123");
    expect(replyRef.update).toHaveBeenCalledWith({ sequenceResumed: true });
  });

  it("treats already-sent replies as idempotent and does not resend", async () => {
    const replyRef = {
      update: vi.fn().mockResolvedValue(undefined),
    };

    adminDbCollectionMock.mockImplementation((name: string) => {
      if (name !== "email_replies") throw new Error(`Unexpected collection ${name}`);
      return {
        doc: vi.fn(() => replyRef),
      };
    });

    runTransactionMock.mockImplementation(async (fn: (tx: { get: typeof vi.fn; update: typeof vi.fn }) => Promise<unknown>) =>
      fn({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            uid: "uid_123",
            email: "member@example.com",
            subject: "Need help",
            finalDraft: "Already sent",
            status: "sent",
            toolCallsCompleted: true,
            sequenceResumed: true,
          }),
        }),
        update: vi.fn(),
      })
    );

    const { POST } = await loadRoute();
    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: "reply_123" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, alreadySent: true });
    expect(sendPlainTextMock).not.toHaveBeenCalled();
    expect(executeToolCallsMock).not.toHaveBeenCalled();
    expect(resumeSequenceMock).not.toHaveBeenCalled();
    expect(replyRef.update).not.toHaveBeenCalled();
  });
});
