import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

vi.mock("@/app/context/MembershipContext", () => ({
  MembershipProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/app/components/EmailLinkHandler", () => ({
  EmailLinkHandler: () => null,
}));

vi.mock("@/app/components/PageViewTracker", () => ({
  PageViewTracker: () => null,
}));

describe("shouldUseMembershipProvider", () => {
  it("keeps the provider for public pages that render auth-aware controls", async () => {
    const { shouldUseMembershipProvider } = await import("@/app/context/Providers");

    expect(shouldUseMembershipProvider("/affiliates")).toBe(true);
    expect(shouldUseMembershipProvider("/blog")).toBe(true);
    expect(shouldUseMembershipProvider("/influencers")).toBe(true);
  });

  it("skips the provider only on truly static public routes", async () => {
    const { shouldUseMembershipProvider } = await import("@/app/context/Providers");

    expect(shouldUseMembershipProvider("/faq")).toBe(false);
    expect(shouldUseMembershipProvider("/handoff")).toBe(false);
    expect(shouldUseMembershipProvider("/policies/privacy")).toBe(false);
    expect(shouldUseMembershipProvider("/reservecard")).toBe(false);
    expect(shouldUseMembershipProvider("/shop")).toBe(true);
  });
});
