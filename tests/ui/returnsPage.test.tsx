import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ membership: {} as Record<string, unknown> }));
vi.mock("@/app/context/MembershipContext", () => ({ useMembership: () => mocks.membership }));
vi.mock("@/app/shop/components/ShopPageShell", () => ({ ShopPageShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

import ReturnsPage from "@/app/returns/page";

const res = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });

const lookupBody = (over: Record<string, unknown> = {}) => ({
  orderId: "11",
  orderName: "#1234",
  orderDate: "November 1, 2026",
  returnToken: "signed.token",
  orderType: "pro_shop",
  policy: { windowDays: 30, resolution: "refund_original_payment", exchangeAllowed: true },
  returnShippingCost: 0,
  items: [
    { lineItemId: "91", sku: "S", title: "Club Polo", variantTitle: "M", quantity: 1, returnableQty: 1, price: 50, image: "https://cdn.shopify.com/polo.jpg", isChildSku: false, isFinalSale: false, alreadyReturned: false, ineligibleReason: null },
    { lineItemId: "92", sku: "T", title: "Old Hat", variantTitle: "", quantity: 1, returnableQty: 0, price: 20, image: "", isChildSku: false, isFinalSale: false, alreadyReturned: false, ineligibleReason: "outside_window" },
  ],
  ...over,
});

async function lookUp() {
  fireEvent.change(screen.getByLabelText(/order number/i), { target: { value: "#1234" } });
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "member@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Look Up Order" }));
  await screen.findByText("Select Items to Return");
}

async function selectAndContinue() {
  fireEvent.click(screen.getByRole("button", { name: /Club Polo/ }));
  expect(screen.getByRole("option", { name: "Too small" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Wrong size" })).toBeNull();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "Too large" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText("Your Return Summary");
}

const user = { getIdToken: vi.fn().mockResolvedValue("firebase-id-token") };

beforeEach(() => {
  mocks.membership = { tier: "black", user };
});

describe("/returns token flow", () => {
  it("passes the lookup token and Firebase ID token to create, never the client tier", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(res(lookupBody()))
      .mockResolvedValueOnce(res({ returnId: "r1", returnStatus: "REQUESTED", itemsCreditAmount: 50, shippingCost: 0, estimatedCreditAmount: 50 }));
    vi.stubGlobal("fetch", fetch);
    render(<ReturnsPage />);
    await lookUp();

    // Images render and ineligible reasons are explained.
    expect(screen.getByAltText("Club Polo")).toHaveAttribute("src", "https://cdn.shopify.com/polo.jpg");
    expect(screen.getByText("Return window closed")).toBeInTheDocument();

    await selectAndContinue();
    expect(screen.getAllByText(/refund/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Submit Return" }));
    await screen.findByText("Return Request Submitted");

    const [lookupUrl, lookupInit] = fetch.mock.calls[0];
    expect(lookupUrl).toBe("/api/returns/lookup");
    expect(lookupInit.headers.Authorization).toBe("Bearer firebase-id-token");
    const [createUrl, createInit] = fetch.mock.calls[1];
    expect(createUrl).toBe("/api/returns/create");
    expect(createInit.headers.Authorization).toBe("Bearer firebase-id-token");
    const body = JSON.parse(createInit.body);
    expect(body).toEqual({ returnToken: "signed.token", orderId: "11", items: [{ lineItemId: "91", quantity: 1, reason: "Too large" }] });
    expect(body.membershipTier).toBeUndefined();
  });

  it("sends guests' requests without an Authorization header", async () => {
    mocks.membership = { tier: "free", user: null };
    const fetch = vi.fn().mockResolvedValueOnce(res(lookupBody()));
    vi.stubGlobal("fetch", fetch);
    render(<ReturnsPage />);
    await lookUp();
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("sends people back to look up the order again when the token expired", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(res(lookupBody()))
      .mockResolvedValueOnce(res({ error: "Your session expired. Please look up your order again.", code: "return_token_expired" }, false, 401));
    vi.stubGlobal("fetch", fetch);
    render(<ReturnsPage />);
    await lookUp();
    await selectAndContinue();
    fireEvent.click(screen.getByRole("button", { name: "Submit Return" }));
    expect(await screen.findByText("Your session expired. Please look up your order again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Look Up Order" })).toBeInTheDocument();
    expect(screen.getByLabelText(/order number/i)).toHaveValue("#1234");
  });

  it("exchange request sends only the token and message", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(res(lookupBody()))
      .mockResolvedValueOnce(res({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    render(<ReturnsPage />);
    await lookUp();
    fireEvent.click(screen.getByRole("button", { name: "Request a free size exchange" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send exchange request" }));
    await screen.findByText("Request sent");
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe("/api/returns/exchange-request");
    const body = JSON.parse(init.body);
    expect(body.returnToken).toBe("signed.token");
    expect(body.customerEmail).toBeUndefined();
    expect(body.message).toContain("#1234");
  });

  it("shows store-credit copy for subscription orders", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(res(lookupBody({ orderType: "subscription", policy: { windowDays: 30, resolution: "store_credit", exchangeAllowed: true } }))));
    render(<ReturnsPage />);
    await lookUp();
    expect(screen.getByText("Estimated store credit")).toBeInTheDocument();
  });
});
