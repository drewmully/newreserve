import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/_lib/supabaseService", () => ({ getSupabaseService: () => { throw new Error("db should not be touched"); } }));
vi.mock("@/lib/firebase-admin", () => ({ adminDb: {} }));

import { gatedSend, resendMarketingDisabled } from "@/lib/email/gate";

describe("RESEND_MARKETING_DISABLED", () => {
  afterEach(() => { delete process.env.RESEND_MARKETING_DISABLED; });

  it("is off unless exactly 'true'", () => {
    expect(resendMarketingDisabled()).toBe(false);
    process.env.RESEND_MARKETING_DISABLED = "1";
    expect(resendMarketingDisabled()).toBe(false);
    process.env.RESEND_MARKETING_DISABLED = "true";
    expect(resendMarketingDisabled()).toBe(true);
  });

  it("skips lifecycle and campaign sends without calling the provider", async () => {
    process.env.RESEND_MARKETING_DISABLED = "true";
    for (const sendClass of ["lifecycle", "campaign"] as const) {
      const send = vi.fn(async () => "msg");
      await expect(gatedSend({ to: "a@example.com", sendClass, flow: "member" }, send)).resolves.toBeNull();
      expect(send).not.toHaveBeenCalled();
    }
  });
});
