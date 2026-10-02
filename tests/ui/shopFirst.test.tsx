import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { safeShopReturn, shopReturnFromLogin } from "@/lib/shopLogin";
import { selectShopEdit, shopGiftPicks, shopSelectionNote } from "@/lib/shopMerchandising";
import { ShopNewsletter } from "@/app/shop/components/ShopNewsletter";
import type { ShopifyProduct } from "@/lib/shopify";

afterEach(() => vi.unstubAllGlobals());

describe("shop-aware login", () => {
  it("retains shop paths, query strings and anchors", () => {
    for (const path of ["/shop", "/shop#edit", "/shop/product/polo?size=M"]) {
      expect(safeShopReturn(path)).toBe(path);
      expect(shopReturnFromLogin(`?returnTo=${encodeURIComponent(path)}`)).toBe(path);
    }
  });
  it("rejects external, malformed and out-of-shop redirects", () => {
    for (const path of ["https://evil.test/shop", "//evil.test/shop", "/shop.evil", "/shop/../../account", "/shop\\evil", "/shop/%2f%2fevil", "/shop\n", "/account", ""]) {
      expect(safeShopReturn(path)).toBeNull();
    }
  });
  it("leaves paid onboarding in control", () => {
    expect(shopReturnFromLogin("?paid=1&returnTo=%2Fshop")).toBeNull();
    expect(shopReturnFromLogin("?paid_member=1&returnTo=%2Fshop")).toBeNull();
    expect(shopReturnFromLogin("")).toBe("/");
  });
});

const product = (slug: string, available: boolean, tags: string[] = []) =>
  ({ slug, tags, variants: [{ availableForSale: available }] }) as ShopifyProduct;

describe("shop merchandising", () => {
  it("prioritizes purchasable products without mutating catalog order", () => {
    const products = [product("technically-golf-performance-polo", false), product("new", true)];
    expect(selectShopEdit(products)[0].slug).toBe("new");
    expect(products[0].slug).toBe("technically-golf-performance-polo");
  });
  it("only selects merchant-tagged gifts", () => {
    expect(shopGiftPicks([product("a", true), product("b", true, ["gift"])], "gift").map(p => p.slug)).toEqual(["b"]);
  });
  it("uses merchant copy and suppresses excessively long notes", () => {
    expect(shopSelectionNote({ ...product("a", true), whyWeLikeIt: "<p>Soft cotton.</p> Another sentence." })).toBe("Soft cotton.");
    expect(shopSelectionNote({ ...product("a", true), description: "x".repeat(181) })).toBe("");
    expect(shopSelectionNote(product("a", true))).toBe("");
  });
});

describe("shop email capture", () => {
  it("requires explicit consent and reports successful persistence", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShopNewsletter />);
    const consent = screen.getByRole("checkbox");
    expect(consent).not.toBeChecked();
    expect(consent).toBeRequired();
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "qa@example.com" } });
    fireEvent.click(consent);
    fireEvent.click(screen.getByRole("button", { name: "Get the edit" }));
    await screen.findByRole("status");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ source: "shop-newsletter", consent: true, email: "qa@example.com" });
  });
  it("shows a retryable error, not a false success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "write_failed" }) }));
    render(<ShopNewsletter />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "qa@example.com" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Get the edit" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Please try again"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
