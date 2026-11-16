import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserByEmail: vi.fn(),
  createUser: vi.fn(),
  createCustomToken: vi.fn(),
  docGet: vi.fn(),
  docSet: vi.fn(),
  collection: vi.fn(),
  queueKlaviyoContact: vi.fn(),
}));

vi.mock("@/lib/firebase-admin", () => ({
  adminAuth: {
    getUserByEmail: mocks.getUserByEmail,
    createUser: mocks.createUser,
    createCustomToken: mocks.createCustomToken,
  },
  adminDb: { collection: mocks.collection },
}));
vi.mock("@/lib/klaviyo/syncState", () => ({ queueKlaviyoContact: mocks.queueKlaviyoContact }));

import { POST } from "@/app/api/auth/start-account/route";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/auth/start-account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const notFound = Object.assign(new Error("no user"), { code: "auth/user-not-found" });

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.collection.mockReturnValue({ doc: () => ({ get: mocks.docGet, set: mocks.docSet }) });
  mocks.docGet.mockResolvedValue({ exists: false });
  mocks.docSet.mockResolvedValue(undefined);
  mocks.createCustomToken.mockResolvedValue("custom-token");
});

describe("POST /api/auth/start-account", () => {
  it("creates a new user, writes the Firestore profile and returns a custom token", async () => {
    mocks.getUserByEmail.mockRejectedValue(notFound);
    mocks.createUser.mockResolvedValue({ uid: "new_uid" });

    const res = await POST(req({ email: " New@Example.com ", source: "hero_cta", utm: { utm_source: "ig" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uid: "new_uid", customToken: "custom-token", isNewUser: true });

    expect(mocks.createUser).toHaveBeenCalledWith({ email: "new@example.com", emailVerified: false });
    expect(mocks.createCustomToken).toHaveBeenCalledWith("new_uid", { mully_signup: "email_only" });
    expect(mocks.docSet).toHaveBeenCalledWith(expect.objectContaining({
      email: "new@example.com",
      tier: "free",
      password_set: false,
      auth_method: "email_only",
      signup_source: "hero_cta",
      signup_utm: { utm_source: "ig" },
      onboarding_completed: false,
    }));
    expect(mocks.queueKlaviyoContact).toHaveBeenCalledWith(expect.objectContaining({
      source: "account-start",
      email: "new@example.com",
      eventProperties: { signup_source: "hero_cta", is_new_user: true },
    }));
  });

  it("returns { exists: true } for an existing user without minting a token or touching users/*", async () => {
    mocks.getUserByEmail.mockResolvedValue({ uid: "victim_uid", email: "victim@example.com" });

    const res = await POST(req({ email: "victim@example.com" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ exists: true });
    expect(json).not.toHaveProperty("uid");
    expect(json).not.toHaveProperty("customToken");

    expect(mocks.createCustomToken).not.toHaveBeenCalled();
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.collection).not.toHaveBeenCalled();
    expect(mocks.docSet).not.toHaveBeenCalled();
    // Lead signal is preserved (marketing contact queue only).
    expect(mocks.queueKlaviyoContact).toHaveBeenCalledWith(expect.objectContaining({
      eventProperties: { signup_source: "homepage_email_cta", is_new_user: false },
    }));
  });

  it("never issues a token for an admin email", async () => {
    mocks.getUserByEmail.mockResolvedValue({ uid: "admin_uid", email: "drew@mullybox.com" });
    const res = await POST(req({ email: "drew@mullybox.com" }));
    expect(await res.json()).toEqual({ exists: true });
    expect(mocks.createCustomToken).not.toHaveBeenCalled();
  });

  it("treats the createUser race (auth/email-already-exists) as an existing account", async () => {
    mocks.getUserByEmail.mockRejectedValueOnce(notFound).mockResolvedValue({ uid: "raced_uid" });
    mocks.createUser.mockRejectedValue(Object.assign(new Error("exists"), { code: "auth/email-already-exists" }));

    const res = await POST(req({ email: "race@example.com" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ exists: true });
    expect(mocks.createCustomToken).not.toHaveBeenCalled();
    expect(mocks.collection).not.toHaveBeenCalled();
  });

  it("keeps the existing error responses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ email: "not-an-email" }))).status).toBe(400);

    mocks.getUserByEmail.mockRejectedValue(Object.assign(new Error("boom"), { code: "auth/internal-error" }));
    expect((await POST(req({ email: "a@example.com" }))).status).toBe(500);
    expect(mocks.createCustomToken).not.toHaveBeenCalled();

    mocks.getUserByEmail.mockRejectedValue(notFound);
    mocks.createUser.mockRejectedValue(Object.assign(new Error("boom"), { code: "auth/internal-error" }));
    expect((await POST(req({ email: "a@example.com" }))).status).toBe(500);
    expect(mocks.createCustomToken).not.toHaveBeenCalled();
  });

  it("still signs a new user in if the Firestore write fails", async () => {
    mocks.getUserByEmail.mockRejectedValue(notFound);
    mocks.createUser.mockResolvedValue({ uid: "new_uid" });
    mocks.docSet.mockRejectedValue(new Error("firestore down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req({ email: "new@example.com" }));
    expect(await res.json()).toMatchObject({ customToken: "custom-token", isNewUser: true });
  });
});
