import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));
vi.mock("@/app/shop/components/ShopSignupPopup", () => ({ ShopSignupPopup: () => <div>legacy-popup</div> }));
vi.mock("@/app/shop/components/takeAShot/TakeAShotTrigger", () => ({ TakeAShotTrigger: () => <div>tas-trigger</div> }));

import { TakeAShotGate } from "@/app/shop/components/takeAShot/TakeAShotGate";

beforeEach(() => { sessionStorage.clear(); });

describe("TakeAShotGate in the root layout", () => {
  it("flag off: the legacy popup stays on /shop pages only", () => {
    for (const [path, shown] of [["/shop", true], ["/shop/some-vest", true], ["/", false], ["/blog", false], ["/dashboard", false]] as const) {
      nav.path = path;
      const { unmount } = render(<TakeAShotGate enabled={false} allowOverride={false} />);
      expect(Boolean(screen.queryByText("legacy-popup")), path).toBe(shown);
      expect(screen.queryByText("tas-trigger")).toBeNull();
      unmount();
    }
  });
  it("flag on: Take a Shot runs on storefront pages and nowhere else", () => {
    for (const [path, shown] of [["/", true], ["/blog", true], ["/lp/editorial", true], ["/shop/gifts", true], ["/shop/some-vest", true],
      ["/subscription", false], ["/dashboard", false], ["/login", false], ["/lp/gift-season", false], ["/faq", false]] as const) {
      nav.path = path;
      const { unmount } = render(<TakeAShotGate enabled allowOverride={false} />);
      expect(Boolean(screen.queryByText("tas-trigger")), path).toBe(shown);
      expect(screen.queryByText("legacy-popup")).toBeNull();
      unmount();
    }
  });
});
