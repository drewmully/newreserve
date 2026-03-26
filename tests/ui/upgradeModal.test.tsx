import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  SHOPIFY_CHECKOUT_ORIGIN_APP_KEY,
  SHOPIFY_CHECKOUT_RETURN_URL_KEY,
} from "@/lib/shopifyCheckoutOrigin";
import { SHOPIFY_MEMBERSHIP_PLANS } from "@/lib/membershipConfig";
import { UpgradeModal } from "@/app/components/UpgradeModal";

describe("UpgradeModal", () => {
  it("renders plan cards conditionally by current tier", () => {
    const noop = vi.fn();

    const { rerender } = render(
      <UpgradeModal
        open
        onClose={noop}
        currentTier="free"
        onSelectPlan={noop}
      />
    );

    expect(screen.getByText("Join Reserve Access")).toBeInTheDocument();
    expect(screen.getByText("Join Reserve Member")).toBeInTheDocument();

    rerender(
      <UpgradeModal
        open
        onClose={noop}
        currentTier="member"
        onSelectPlan={noop}
      />
    );

    expect(screen.queryByText("Join Reserve Access")).not.toBeInTheDocument();
    expect(screen.queryByText("Join Reserve Member")).not.toBeInTheDocument();
  });

  it("sends checkout request using configured plan IDs and callback attributes", async () => {
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN = "store.myshopify.com";
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN = "token_123";

    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        data: { cartCreate: { cart: null, userErrors: [] } },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <UpgradeModal
        open
        onClose={vi.fn()}
        currentTier="free"
        onSelectPlan={vi.fn()}
      />
    );

    await user.click(screen.getByText("Join Reserve Access"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://store.myshopify.com/api/2024-10/graphql.json");

    const body = JSON.parse(String(requestInit.body));
    expect(body.variables.merchandiseId).toBe(
      SHOPIFY_MEMBERSHIP_PLANS.access.merchandiseId
    );
    expect(body.variables.sellingPlanId).toBe(
      SHOPIFY_MEMBERSHIP_PLANS.access.sellingPlanGid
    );
    expect(body.variables.attributes).toEqual(
      expect.arrayContaining([
        {
          key: SHOPIFY_CHECKOUT_ORIGIN_APP_KEY,
          value: "newreserve",
        },
        {
          key: SHOPIFY_CHECKOUT_RETURN_URL_KEY,
          value: `${window.location.origin}/auth/callback`,
        },
      ])
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[UpgradeModal] no checkoutUrl"),
      [],
      undefined
    );
  });

  it("does not call checkout API when storefront env is missing", async () => {
    delete process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
    delete process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN;

    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <UpgradeModal
        open
        onClose={vi.fn()}
        currentTier="free"
        onSelectPlan={vi.fn()}
      />
    );

    await user.click(screen.getByText("Join Reserve Member"));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[UpgradeModal] missing Shopify storefront config"
    );
  });
});
