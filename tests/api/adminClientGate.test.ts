import { describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";
import { clientAdminStatus } from "@/lib/adminClientGate";

const userWith = (email: string | null, claims: Record<string, unknown> | Error) =>
  ({
    email,
    getIdTokenResult: claims instanceof Error ? vi.fn().mockRejectedValue(claims) : vi.fn().mockResolvedValue({ claims }),
  }) as unknown as User;

describe("clientAdminStatus", () => {
  it("authorizes Google / email-link admin sessions", async () => {
    await expect(clientAdminStatus(userWith("drew@mullybox.com", { email_verified: true, firebase: { sign_in_provider: "google.com" } }))).resolves.toBe("authorized");
  });
  it("asks custom-token / email_only admin sessions to sign in again", async () => {
    await expect(clientAdminStatus(userWith("drew@mullybox.com", { email_verified: true, firebase: { sign_in_provider: "custom" } }))).resolves.toBe("reauth");
    await expect(clientAdminStatus(userWith("jack@mullybox.com", { email_verified: false, mully_signup: "email_only", firebase: { sign_in_provider: "custom" } }))).resolves.toBe("reauth");
  });
  it("rejects non-admins without reading claims", async () => {
    const u = userWith("member@example.com", { email_verified: true });
    await expect(clientAdminStatus(u)).resolves.toBe("unauthorized");
    expect(u.getIdTokenResult).not.toHaveBeenCalled();
  });
  it("falls back to the email decision if claims can't be read (never locks admins out of the UI)", async () => {
    await expect(clientAdminStatus(userWith("leo@mullybox.com", new Error("offline")))).resolves.toBe("authorized");
  });
});
