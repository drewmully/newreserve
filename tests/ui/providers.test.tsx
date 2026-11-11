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

describe("page_view tracking", () => {
  it("has exactly one route-level page_view tracker site-wide", async () => {
    // PageViewTracker (Providers) and AnalyticsTracker (layout) both fired
    // page_view on every route, doubling PostHog page_view counts.
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
    });
    const callers = walk(join(process.cwd(), "src")).filter((f) =>
      /trackEvent\(\s*"page_view"/.test(readFileSync(f, "utf8"))
    );
    // mulligan and reservecard add a page-tagged page_view of their own
    // (left as is, reported separately).
    expect(callers.map((f) => f.replace(process.cwd() + "/", "")).sort()).toEqual([
      "src/app/components/AnalyticsTracker.tsx",
      "src/app/mulligan/page.tsx",
      "src/app/reservecard/page.tsx",
    ]);
  });
});

describe("shouldUseMembershipProvider", () => {
  it("keeps the provider for public pages that render auth-aware controls", async () => {
    const { shouldUseMembershipProvider } = await import("@/app/context/Providers");

    expect(shouldUseMembershipProvider("/affiliates")).toBe(true);
    expect(shouldUseMembershipProvider("/blog")).toBe(true);
    expect(shouldUseMembershipProvider("/influencers")).toBe(true);
    expect(shouldUseMembershipProvider("/login")).toBe(true);
  });

  it("skips the provider only on truly static public routes", async () => {
    const { shouldUseMembershipProvider } = await import("@/app/context/Providers");

    expect(shouldUseMembershipProvider("/")).toBe(true);
    expect(shouldUseMembershipProvider("/subscription")).toBe(false);
    expect(shouldUseMembershipProvider("/faq")).toBe(true);
    expect(shouldUseMembershipProvider("/handoff")).toBe(false);
    expect(shouldUseMembershipProvider("/policies/privacy")).toBe(true);
    expect(shouldUseMembershipProvider("/reservecard")).toBe(false);
    expect(shouldUseMembershipProvider("/mulligan")).toBe(false);
    expect(shouldUseMembershipProvider("/shop")).toBe(true);
  });
});
