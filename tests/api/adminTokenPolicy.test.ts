import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verifyIdToken: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/firebase-admin", () => ({
  adminAuth: { verifyIdToken: mocks.verifyIdToken, getUser: mocks.getUser },
  adminDb: {},
}));

import { adminTokenRejection, isAdminIdToken } from "@/lib/adminTokenPolicy";
import { requireAdmin, verifyAdminRequest } from "@/app/api/_lib/adminAuth";

const google = (email = "drew@mullybox.com") => ({
  uid: "admin_uid",
  email,
  email_verified: true,
  firebase: { sign_in_provider: "google.com" },
});
const emailLink = (email = "jack@mullybox.com") => ({
  uid: "admin_uid",
  email,
  email_verified: true,
  firebase: { sign_in_provider: "password" },
});

function req(token = "tok") {
  return new NextRequest("http://localhost/api/admin/x", { headers: { Authorization: `Bearer ${token}` } });
}

beforeEach(() => {
  mocks.verifyIdToken.mockReset();
  mocks.getUser.mockReset();
  delete process.env.ADMIN_EMAIL_ALLOWLIST;
});

describe("adminTokenPolicy", () => {
  it("accepts every default admin via Google or email link", () => {
    for (const email of ["drew@mullybox.com", "leo@mullybox.com", "jack@mullybox.com", "joe@mullybox.com", "Drew@MullyBox.com"]) {
      expect(isAdminIdToken(google(email))).toBe(true);
      expect(isAdminIdToken(emailLink(email))).toBe(true);
    }
  });

  it("rejects custom-token sessions even with a verified admin email", () => {
    expect(adminTokenRejection({ ...google(), firebase: { sign_in_provider: "custom" } })).toBe("custom_token_session");
  });

  it("rejects the start-account email_only claim", () => {
    expect(adminTokenRejection({ ...google(), mully_signup: "email_only" })).toBe("email_only_signup");
  });

  it("rejects anonymous sessions, unverified and missing email_verified", () => {
    expect(adminTokenRejection({ ...google(), firebase: { sign_in_provider: "anonymous" } })).toBe("anonymous_session");
    expect(adminTokenRejection({ ...emailLink(), email_verified: false })).toBe("email_not_verified");
    const noFlag: Record<string, unknown> = { ...google() };
    delete noFlag.email_verified;
    expect(adminTokenRejection(noFlag)).toBe("email_not_verified");
  });

  it("rejects non-allowlisted and missing emails", () => {
    expect(adminTokenRejection(google("member@example.com"))).toBe("not_allowlisted");
    expect(adminTokenRejection({ email_verified: true })).toBe("missing_email");
  });

  it("honours an explicit allowlist", () => {
    expect(isAdminIdToken(google("ops@example.com"), { allowlist: "ops@example.com" })).toBe(true);
    expect(isAdminIdToken(google("drew@mullybox.com"), { allowlist: "ops@example.com" })).toBe(false);
  });
});

describe("verifyAdminRequest / requireAdmin", () => {
  it("accepts a normal admin session", async () => {
    mocks.verifyIdToken.mockResolvedValue(google());
    await expect(verifyAdminRequest(req())).resolves.toEqual({ uid: "admin_uid", email: "drew@mullybox.com" });
    expect(mocks.verifyIdToken).toHaveBeenCalledWith("tok", true);
  });

  it("rejects a custom-provider admin token (start-account session)", async () => {
    mocks.verifyIdToken.mockResolvedValue({
      ...google(),
      mully_signup: "email_only",
      firebase: { sign_in_provider: "custom" },
    });
    await expect(verifyAdminRequest(req())).resolves.toBeNull();
    const guard = await requireAdmin(req());
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.response.status).toBe(401);
  });

  it("rejects an unverified admin email", async () => {
    mocks.verifyIdToken.mockResolvedValue({ ...emailLink(), email_verified: false });
    await expect(verifyAdminRequest(req())).resolves.toBeNull();
  });

  it("still respects ADMIN_EMAIL_ALLOWLIST", async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = "ops@example.com";
    mocks.verifyIdToken.mockResolvedValue(google("ops@example.com"));
    await expect(verifyAdminRequest(req())).resolves.toEqual({ uid: "admin_uid", email: "ops@example.com" });
  });
});

describe("inline /api/admin verifyAdmin copies", () => {
  it("/api/admin/users rejects a custom-token admin before any data access", async () => {
    const { GET } = await import("@/app/api/admin/users/route");
    mocks.verifyIdToken.mockResolvedValue({ ...google(), firebase: { sign_in_provider: "custom" } });
    const denied = await GET(req());
    expect(denied.status).toBe(403);

    // A Google admin passes auth (the mocked adminDb then fails with 500,
    // which proves the request got past the admin check).
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.verifyIdToken.mockResolvedValue(google());
    const allowed = await GET(req());
    expect(allowed.status).not.toBe(401);
    expect(allowed.status).not.toBe(403);
  });

  it("no server or client module checks the admin allowlist without the token policy", () => {
    const root = path.resolve(__dirname, "../..");
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && fs.readFileSync(full, "utf8").includes("isAllowedAdminEmail")) {
          out.push(path.relative(root, full).split(path.sep).join("/"));
        }
      }
    };
    walk(path.join(root, "src"));
    out.sort();
    expect(out).toEqual([
      "src/lib/adminClientGate.ts",
      "src/lib/adminEmailAllowlist.ts",
      "src/lib/adminTokenPolicy.ts",
    ]);
  });
});
