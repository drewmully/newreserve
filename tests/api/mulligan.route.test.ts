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
  return new NextRequest("http://localhost/api/mulligan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/mulligan/route");
}

describe("POST /api/mulligan", () => {
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
        first_name: "Jordan",
        last_name: "Spieth",
        reactivation_choice: "member",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "Valid email is required" });
    expect(setMock).not.toHaveBeenCalled();
  });

  it("rejects missing names", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({
        email: "member@example.com",
        first_name: "",
        last_name: "Spieth",
        reactivation_choice: "member",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "First and last name are required" });
    expect(setMock).not.toHaveBeenCalled();
  });

  it("rejects unknown re-activation choices", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({
        email: "member@example.com",
        first_name: "Jordan",
        last_name: "Spieth",
        reactivation_choice: "legacy",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "A re-activation choice is required" });
    expect(setMock).not.toHaveBeenCalled();
  });

  it("persists normalized mulligan submissions", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({
        email: "Comebacker@Example.com",
        first_name: "  Jordan ",
        last_name: " Spieth ",
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
        reactivation_choice: "member",
        source: "mulligan",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(adminDbCollectionMock).toHaveBeenCalledWith("mulligan_submissions");
    expect(setMock).toHaveBeenCalledWith(
      {
        email: "comebacker@example.com",
        first_name: "Jordan",
        last_name: "Spieth",
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
        reactivation_choice: "member",
        status: "pending_reactivation",
        submitted_at: "server-ts",
        source: "mulligan",
      },
      { merge: true }
    );
  });

  it("marks not_now choices with declined status", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({
        email: "later@example.com",
        first_name: "Sam",
        last_name: "Burns",
        reactivation_choice: "not_now",
      })
    );

    expect(res.status).toBe(200);
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reactivation_choice: "not_now",
        status: "declined",
      }),
      { merge: true }
    );
  });
});
