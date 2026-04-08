import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setMock = vi.fn();
const adminDbCollectionMock = vi.fn();

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: {
    now: vi.fn(() => "server-ts"),
  },
}));

vi.mock("@/lib/firebase-admin", () => ({
  adminDb: {
    collection: adminDbCollectionMock,
  },
}));

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/reserve-card", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/reserve-card/route");
}

describe("POST /api/reserve-card", () => {
  beforeEach(() => {
    setMock.mockReset().mockResolvedValue(undefined);
    adminDbCollectionMock.mockReset().mockReturnValue({
      doc: vi.fn(() => ({
        set: setMock,
      })),
    });
  });

  it("rejects invalid emails", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({
        email: "not-an-email",
        selected_plan: "member",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "Valid email is required" });
    expect(setMock).not.toHaveBeenCalled();
  });

  it("persists normalized reserve-card submissions", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({
        email: "Member@Example.com",
        gender: "Menswear",
        fit: {
          shirt_size: "XL",
          glove_hand: "Left",
          glove_size: "ML",
          waist_size: "34",
          pants_inseam: '32"',
          shorts_inseam: '9"',
          shoe_size: "10.5",
        },
        style: {
          vibe: "Modern / Athletic",
          color_preference: "Neutrals",
          putter_type: "Blade",
          brand_interest: ["Nike", "  ", "adidas"],
        },
        selected_plan: "member",
        source: "reserve_card_qr",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(setMock).toHaveBeenCalledWith(
      {
        email: "member@example.com",
        gender: "Menswear",
        fit: {
          shirt_size: "XL",
          glove_hand: "Left",
          glove_size: "ML",
          waist_size: "34",
          pants_inseam: '32"',
          shorts_inseam: '9"',
          shoe_size: "10.5",
        },
        style: {
          vibe: "Modern / Athletic",
          color_preference: "Neutrals",
          putter_type: "Blade",
          brand_interest: ["Nike", "adidas"],
        },
        selected_plan: "member",
        submitted_at: "server-ts",
        source: "reserve_card_qr",
      },
      { merge: true }
    );
  });
});
