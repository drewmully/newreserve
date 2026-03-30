import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyIdTokenMock = vi.fn();
const adminDbCollectionMock = vi.fn();
const serverTimestampMock = vi.fn(() => "server-ts");
const timestampFromDateMock = vi.fn((date: Date) => ({
  kind: "timestamp",
  iso: date.toISOString(),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: serverTimestampMock,
  },
  Timestamp: {
    fromDate: timestampFromDateMock,
  },
}));

vi.mock("@/lib/firebase-admin", () => ({
  adminAuth: {
    verifyIdToken: verifyIdTokenMock,
  },
  adminDb: {
    collection: adminDbCollectionMock,
  },
}));

function makeRequest(method: "GET" | "POST", options?: { withAuth?: boolean; body?: unknown }) {
  const headers = new Headers();
  if (options?.withAuth !== false) {
    headers.set("Authorization", "Bearer token-123");
  }
  if (options?.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  return new NextRequest("http://localhost/api/golf/rounds", {
    method,
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/golf/rounds/route");
}

describe("golf rounds route", () => {
  beforeEach(() => {
    verifyIdTokenMock.mockReset();
    adminDbCollectionMock.mockReset();
    serverTimestampMock.mockClear();
    timestampFromDateMock.mockClear();
  });

  it("returns 401 when a rounds request is unauthenticated", async () => {
    const { GET } = await loadRoute();
    const res = await GET(makeRequest("GET", { withAuth: false }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({ error: "Unauthorized" });
  });

  it("loads scorecard rounds from the user's Firestore subcollection", async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: "member-123" });

    const getMock = vi.fn().mockResolvedValue({
      docs: [
        { id: "round-2", data: () => ({ date: "2026-03-28", course: "Oakland Hills", score: 79 }) },
        { id: "round-1", data: () => ({ date: "2026-03-20", course: "Detroit Golf Club", score: 82 }) },
      ],
    });
    const limitMock = vi.fn(() => ({ get: getMock }));
    const orderByMock = vi.fn(() => ({ limit: limitMock }));
    const golfRoundsCollection = { orderBy: orderByMock };
    const userDoc = {
      collection: vi.fn((name: string) => {
        if (name === "golfRounds") return golfRoundsCollection;
        throw new Error(`Unexpected subcollection ${name}`);
      }),
    };

    adminDbCollectionMock.mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: vi.fn((uid: string) => {
            expect(uid).toBe("member-123");
            return userDoc;
          }),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    const { GET } = await loadRoute();
    const res = await GET(makeRequest("GET"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(orderByMock).toHaveBeenCalledWith("playedAt", "desc");
    expect(limitMock).toHaveBeenCalledWith(250);
    expect(json).toEqual({
      rounds: [
        { id: "round-2", date: "2026-03-28", course: "Oakland Hills", score: 79 },
        { id: "round-1", date: "2026-03-20", course: "Detroit Golf Club", score: 82 },
      ],
    });
  });

  it("rejects invalid score payloads before writing to Firestore", async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: "member-123" });

    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest("POST", {
        body: { date: "2026-03-30", course: "   ", score: 39 },
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({
      error: "Invalid payload. Expected date (YYYY-MM-DD), course, and score (40-200).",
    });
    expect(adminDbCollectionMock).not.toHaveBeenCalled();
  });

  it("persists a new round for the scorecard in Firestore", async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: "member-456" });

    const addMock = vi.fn().mockResolvedValue({ id: "round-new" });
    const golfRoundsCollection = { add: addMock };
    const userDoc = {
      collection: vi.fn((name: string) => {
        if (name === "golfRounds") return golfRoundsCollection;
        throw new Error(`Unexpected subcollection ${name}`);
      }),
    };

    adminDbCollectionMock.mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: vi.fn((uid: string) => {
            expect(uid).toBe("member-456");
            return userDoc;
          }),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest("POST", {
        body: { date: "2026-03-30", course: "Oakland Hills South", score: 78 },
      })
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(timestampFromDateMock).toHaveBeenCalledTimes(1);
    expect(timestampFromDateMock.mock.calls[0]?.[0]).toBeInstanceOf(Date);
    expect(timestampFromDateMock.mock.calls[0]?.[0].toISOString()).toBe("2026-03-30T12:00:00.000Z");
    expect(serverTimestampMock).toHaveBeenCalledTimes(1);
    expect(addMock).toHaveBeenCalledWith({
      date: "2026-03-30",
      course: "Oakland Hills South",
      score: 78,
      playedAt: {
        kind: "timestamp",
        iso: "2026-03-30T12:00:00.000Z",
      },
      createdAt: "server-ts",
    });
    expect(json).toEqual({
      round: {
        id: "round-new",
        date: "2026-03-30",
        course: "Oakland Hills South",
        score: 78,
      },
    });
  });
});
