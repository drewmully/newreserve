import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fb = vi.hoisted(() => ({ currentUser: null as null | { email: string | null; getIdToken: () => Promise<string> } }));
vi.mock("@/lib/firebase", () => ({ get auth() { return { currentUser: fb.currentUser }; } }));
vi.mock("@/lib/attribution", () => ({ getStoredAttribution: () => ({}), attributionToCartAttributes: () => [] }));
vi.mock("@/lib/shopifyCheckoutOrigin", () => ({ buildCheckoutOriginAttributes: () => [] }));
vi.mock("@/lib/analytics/journeyClient", () => ({ recordJourneyCart: vi.fn().mockResolvedValue(undefined) }));

import { createMembershipCheckout } from "@/lib/shopifyCheckout";
import { getSignedInCheckoutIdentity } from "@/lib/checkoutIdentityClient";

const location = { origin: "https://www.mymully.com", href: "https://www.mymully.com/choose-plan" };
let fetchMock: ReturnType<typeof vi.fn>;
const cartResult = { ok: true, json: async () => ({ data: { cartCreate: { userErrors: [], cart: { id: "gid://shopify/Cart/1", checkoutUrl: "https://checkout.example.test/c" } } } }) };

function identityResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}
function cartPayload() {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("graphql.json"));
  return JSON.parse(call![1].body).variables;
}

beforeEach(() => {
  fb.currentUser = null;
  location.href = "https://www.mymully.com/choose-plan";
  vi.stubEnv("NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN", "example.myshopify.com");
  vi.stubEnv("NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN", "test-public-token");
  vi.stubGlobal("window", { location, localStorage: { setItem: vi.fn(), getItem: vi.fn(() => null) } });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("membership checkout identity", () => {
  it("signed out: unchanged — no identity call, no buyerIdentity, no uid attribute", async () => {
    fetchMock.mockResolvedValue(cartResult);
    await createMembershipCheckout("member");
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/checkout/identity")).toBe(false);
    const vars = cartPayload();
    expect(vars.buyerIdentity).toBeNull();
    expect(vars.attributes.find((a: { key: string }) => a.key === "_mully_uid_token")).toBeUndefined();
  });

  it("signed in: passes the account email and the server-signed uid attribute", async () => {
    fb.currentUser = { email: "Member@Example.com", getIdToken: async () => "id-token" };
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/checkout/identity" ? identityResponse({ email: "member@example.com", uidToken: "uid_1.123.sig" }) : cartResult);
    await createMembershipCheckout("member");
    expect(fetchMock).toHaveBeenCalledWith("/api/checkout/identity", expect.objectContaining({
      method: "POST", headers: { Authorization: "Bearer id-token" },
    }));
    const vars = cartPayload();
    expect(vars.buyerIdentity).toEqual({ email: "member@example.com" });
    expect(vars.attributes).toContainEqual({ key: "_mully_uid_token", value: "uid_1.123.sig" });
    expect(location.href).toContain("checkout%5Bemail%5D=member%40example.com");
  });

  it("an explicit email option wins for buyerIdentity; callers cannot inject the uid attribute", async () => {
    fb.currentUser = { email: "member@example.com", getIdToken: async () => "id-token" };
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/checkout/identity" ? identityResponse({ email: "member@example.com", uidToken: "uid_1.123.sig" }) : cartResult);
    await createMembershipCheckout("member", {
      email: "typed@example.com",
      attributes: [{ key: "_mully_uid_token", value: "spoofed" }, { key: "Gift", value: "no" }],
    });
    const vars = cartPayload();
    expect(vars.buyerIdentity).toEqual({ email: "typed@example.com" });
    const uidAttrs = vars.attributes.filter((a: { key: string }) => a.key === "_mully_uid_token");
    expect(uidAttrs).toEqual([{ key: "_mully_uid_token", value: "uid_1.123.sig" }]);
    expect(vars.attributes).toContainEqual({ key: "Gift", value: "no" });
  });

  it("identity endpoint failure falls back to the Firebase email and still opens checkout", async () => {
    fb.currentUser = { email: "Member@Example.com", getIdToken: async () => "id-token" };
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/checkout/identity" ? identityResponse({ error: "x" }, false) : cartResult);
    await createMembershipCheckout("member");
    const vars = cartPayload();
    expect(vars.buyerIdentity).toEqual({ email: "member@example.com" });
    expect(vars.attributes.find((a: { key: string }) => a.key === "_mully_uid_token")).toBeUndefined();
    expect(location.href).toContain("https://checkout.example.test/c");
  });

  it("getSignedInCheckoutIdentity never throws", async () => {
    fb.currentUser = { email: null, getIdToken: async () => { throw new Error("token refresh failed"); } };
    await expect(getSignedInCheckoutIdentity()).resolves.toEqual({ email: null, attributes: [] });
  });
});
